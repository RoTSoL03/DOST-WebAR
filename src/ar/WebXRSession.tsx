import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AmbientLight,
  AnimationMixer,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
  type Camera
} from "three";

import type { MascotId, MascotManifestEntry } from "../config/mascots";
import { instantiateMascotModel } from "../rendering/modelCache";
import { resolveQualityProfile, type QualityProfile } from "../services/deviceProfile";
import { useSessionStore } from "../state/sessionStore";
import {
  canvasToBlob,
  createCaptureFileName,
  get2DContext,
  type CapturedPhoto
} from "./captureUtils";
import {
  FloorHitPoseSmoother,
  getCameraFacingYaw,
  offsetFloorHitAwayFromViewer
} from "./floorHitSmoothing";
import { getScanHint, MascotOverlayControls, type ScanStatus } from "./MascotOverlayControls";
import {
  createMascotVfx,
  disposeMascotVfx,
  startMascotAppear,
  startMascotDisappear,
  updateMascotVfx,
  type MascotVfx
} from "./mascotVfx";
import {
  alignModelBottomToFloor,
  applyMascotForwardCorrection,
  createMascotContactShadow,
  createReticle,
  disposeObjectResources,
  MASCOT_TARGET_HEIGHT_METERS
} from "./mascotSceneUtils";
import { PersonSegmentationClient } from "./personSegmentation";
import { WebXROcclusionController } from "./webxrOcclusion";
import { XRCameraFrameSampler } from "./xrCameraFrameSampler";

interface WebXRSessionProps {
  mascots: readonly MascotManifestEntry[];
  domOverlayRoot: HTMLElement | null;
  session: XRSession;
  onEnd: () => void;
  onError: (message: string) => void;
}

type PlacementReferenceSpaceType = "local-floor" | "local";
type CaptureStatus = "idle" | "capturing" | "ready" | "failed";
type CameraCaptureState = "checking" | "available" | "unavailable";
type CaptureFailureReason =
  | "Camera view missing"
  | "Camera texture unavailable"
  | "Camera framebuffer unavailable"
  | "Camera framebuffer incomplete"
  | "Camera pixel read failed"
  | "Camera image was blank"
  | "Capture image encoding failed";

interface MascotRuntime {
  mascot: MascotManifestEntry;
  root: Group;
  contentRoot: Group;
  model: Group;
  vfx: MascotVfx;
  mixer: AnimationMixer | null;
  anchor: XRAnchor | null;
  anchorRequestVersion: number;
  anchorOffset: Vector3;
  facingYaw: number;
  loaded: boolean;
  placed: boolean;
  visible: boolean;
  modelVisible: boolean;
  appearStartedAt: number | null;
  disappearStartedAt: number | null;
}

interface CaptureFrameOptions {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  hiddenObjects: Object3D[];
  frame?: XRFrame;
  referenceSpace: XRReferenceSpace | null;
  xrWebGLBinding: XRWebGLBindingCameraAccess | null;
  cameraFrameSampler: XRCameraFrameSampler | null;
  occlusionController: WebXROcclusionController;
  acquireVirtualRenderer: (width: number, height: number) => WebGLRenderer | null;
}

interface CaptureResult {
  blob: Blob;
}

interface CameraReadbackResult {
  image: ReadableFrameImage | null;
  failureReason?: CaptureFailureReason;
}

interface ReadableFrameImage {
  imageData: ImageData;
  width: number;
  height: number;
}

export function WebXRSession({
  mascots,
  domOverlayRoot,
  session,
  onEnd,
  onError
}: WebXRSessionProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<ScanStatus>("loading");
  const [activeMascotId, setActiveMascotId] = useState<MascotId>(() => getInitialMascotId(mascots));
  const [loadedMascotIds, setLoadedMascotIds] = useState<MascotId[]>([]);
  const [placedMascotIds, setPlacedMascotIds] = useState<MascotId[]>([]);
  const [movingMascotId, setMovingMascotId] = useState<MascotId | null>(null);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [cameraCaptureState, setCameraCaptureState] = useState<CameraCaptureState>("checking");
  const [captureFailureReason, setCaptureFailureReason] = useState<CaptureFailureReason | null>(
    null
  );
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const activeMascotIdRef = useRef<MascotId>(getInitialMascotId(mascots));
  const placedMascotIdsRef = useRef<MascotId[]>([]);
  const movingMascotIdRef = useRef<MascotId | null>(null);
  const captureStillRef = useRef<() => void>(() => undefined);
  const selectMascotForPlacementRef = useRef<(mascotId: MascotId) => void>(() => undefined);
  const enterPlacement = useSessionStore((state) => state.enterPlacement);
  const markMascotPlaced = useSessionStore((state) => state.markMascotPlaced);

  useEffect(() => {
    activeMascotIdRef.current = activeMascotId;
  }, [activeMascotId]);

  useEffect(() => {
    placedMascotIdsRef.current = placedMascotIds;
  }, [placedMascotIds]);

  useEffect(() => {
    movingMascotIdRef.current = movingMascotId;
  }, [movingMascotId]);

  useEffect(() => {
    return () => {
      if (capturedPhoto) {
        URL.revokeObjectURL(capturedPhoto.url);
      }
    };
  }, [capturedPhoto]);

  useEffect(() => {
    if (!domOverlayRoot) {
      return;
    }

    const preventOverlayXRSelect = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.closest("button")) {
        event.preventDefault();
      }
    };

    domOverlayRoot.addEventListener("beforexrselect", preventOverlayXRSelect);

    return () => {
      domOverlayRoot.removeEventListener("beforexrselect", preventOverlayXRSelect);
    };
  }, [domOverlayRoot]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !canUseWebGL()) {
      setStatus("error");
      onError("WebXR needs WebGL support on this browser.");
      return;
    }

    const xrCanvas = canvas;
    const profile = resolveQualityProfile();
    let disposed = false;
    let sessionEnded = false;
    let renderer: WebGLRenderer | null = null;
    let captureRenderer: WebGLRenderer | null = null;
    let hitTestSource: XRHitTestSource | null = null;
    let floorHitTestSource: XRHitTestSource | null = null;
    let placementReferenceSpace: XRReferenceSpace | null = null;
    let lastSurfaceStatus: ScanStatus = "loading";
    let lastSurfaceSampleTime = 0;
    let previousFrameTime = performance.now();
    let referenceSpaceType: PlacementReferenceSpaceType = "local";
    let captureRequested = false;
    let captureInProgress = false;
    let captureAttemptCount = 0;
    let xrWebGLBinding: XRWebGLBindingCameraAccess | null = null;
    let cameraFrameSampler: XRCameraFrameSampler | null = null;
    let personSegmentation: PersonSegmentationClient | null = null;
    let segmentationStartTimer: number | null = null;
    let placementFallbackTimer: number | null = null;
    let lastPlacementTime = Number.NEGATIVE_INFINITY;
    let occlusionActive = false;
    let lastDepthFrameTime = Number.NEGATIVE_INFINITY;
    let lastSegmentationFrameTime = Number.NEGATIVE_INFINITY;
    let cameraCaptureStateSnapshot: CameraCaptureState = "checking";
    let cameraReadbackProbeCount = 0;
    let cameraReadyFrameCount = 0;
    let surfacePreviewStartedAt = 0;
    let lastValidFloorHitTime = Number.NEGATIVE_INFINITY;
    const lastSurfaceSamplePosition = new Vector3(Number.POSITIVE_INFINITY, 0, 0);
    const surfaceSamplePosition = new Vector3();
    const latestHitMatrix = new Float32Array(16);
    const biasedFloorHitMatrix = new Float32Array(16);
    const floorPlacementMatrix = new Float32Array(16);
    const viewerPosition = new Vector3();
    const floorPoseSmoother = new FloorHitPoseSmoother();
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const occlusionController = new WebXROcclusionController(session);
    const mascotRuntimes = new Map<MascotId, MascotRuntime>();
    const reticle = createReticle();
    // All surface patches share the same geometry; only materials (opacity)
    // are per-patch. Expired patches return to a pool instead of being
    // recreated, so steady-state scanning allocates nothing per frame.
    const patchGeometries = {
      fill: new PlaneGeometry(SURFACE_PATCH_SIZE_METERS, SURFACE_PATCH_SIZE_METERS).rotateX(
        -Math.PI / 2
      ),
      grid: createSurfaceGridGeometry(SURFACE_PATCH_SIZE_METERS, SURFACE_PATCH_DIVISIONS)
    };
    const surfacePatchPool: Group[] = [];
    const surfacePreview = createSurfacePatch(patchGeometries, 0.28, 0.85);
    const scannedSurfaces = new Group();

    const acquireScannedPatch = () =>
      surfacePatchPool.pop() ?? createSurfacePatch(patchGeometries, 0.14, 0.52);

    const releaseScannedPatch = (patch: Group) => {
      scannedSurfaces.remove(patch);

      if (surfacePatchPool.length < profile.maxScannedSurfacePatches) {
        surfacePatchPool.push(patch);
      } else {
        disposeSurfacePatchMaterials(patch);
      }
    };

    const schedulePersonSegmentation = (delayMs: number) => {
      if (segmentationStartTimer !== null || disposed || personSegmentation) {
        return;
      }

      segmentationStartTimer = window.setTimeout(startPersonSegmentation, delayMs);
    };

    const startPersonSegmentation = () => {
      segmentationStartTimer = null;

      if (disposed || personSegmentation || !xrWebGLBinding || !renderer) {
        return;
      }

      const hasPlacedMascot = Array.from(mascotRuntimes.values()).some(
        (runtime) => runtime.placed
      );
      if (!hasPlacedMascot) {
        schedulePersonSegmentation(PERSON_SEGMENTATION_RETRY_DELAY_MS);
        return;
      }

      try {
        cameraFrameSampler ??= new XRCameraFrameSampler(
          renderer.getContext() as WebGL2RenderingContext
        );
      } catch {
        cameraFrameSampler?.dispose();
        cameraFrameSampler = null;
        return;
      }

      personSegmentation = new PersonSegmentationClient({
        onMask: ({ mask, width, height }) => {
          occlusionController.updatePersonMask(new Uint8Array(mask), width, height);
        },
        onUnavailable: () => occlusionController.clearPersonMask()
      });
    };

    const activateOcclusionAfterPlacement = () => {
      if (occlusionActive || disposed) {
        return;
      }

      occlusionActive = true;

      if (!xrWebGLBinding) {
        return;
      }

      // Native depth and semantic segmentation solve different problems. Keep
      // the person mask available even on depth-capable phones so thin limbs,
      // clothing, and noisy depth pixels still occlude the mascot reliably.
      schedulePersonSegmentation(PERSON_SEGMENTATION_START_DELAY_MS);
    };

    const acquireVirtualRenderer = (width: number, height: number): WebGLRenderer | null => {
      if (!captureRenderer) {
        const captureCanvas = document.createElement("canvas");
        const captureContext = captureCanvas.getContext("webgl2", {
          alpha: true,
          antialias: profile.antialias,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true
        });

        if (!captureContext) {
          return null;
        }

        captureRenderer = new WebGLRenderer({
          canvas: captureCanvas,
          context: captureContext as unknown as WebGLRenderingContext,
          alpha: true,
          antialias: profile.antialias,
          preserveDrawingBuffer: true
        });
        captureRenderer.xr.enabled = false;
        captureRenderer.setPixelRatio(1);
        captureRenderer.setClearColor(0x000000, 0);
      }

      captureRenderer.setSize(width, height, false);

      return captureRenderer;
    };

    async function startWebXR() {
      let startupStep = "creating renderer";

      try {
        const glContext = createXRCompatibleWebGL2Context(xrCanvas, profile);

        if (!glContext) {
          throw new Error("WebGL context creation failed.");
        }

        renderer = new WebGLRenderer({
          canvas: xrCanvas,
          context: glContext as unknown as WebGLRenderingContext,
          alpha: true,
          antialias: profile.antialias
        });
        renderer.xr.enabled = true;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio));
        renderer.setSize(window.innerWidth, window.innerHeight, false);

        scene.add(new AmbientLight(0xffffff, 1.5));

        const keyLight = new DirectionalLight(0xffffff, 2);
        keyLight.position.set(2, 4, 2);
        scene.add(keyLight);

        mascots.forEach((manifestEntry) => {
          const root = new Group();
          const contentRoot = new Group();
          const model = new Group();
          const vfx = createMascotVfx();
          const contactShadow = createMascotContactShadow();
          root.visible = false;
          root.matrixAutoUpdate = false;
          contentRoot.add(contactShadow, model);
          root.add(contentRoot, vfx.group);
          occlusionController.patchObject(root);
          scene.add(root);
          mascotRuntimes.set(manifestEntry.id, {
            mascot: manifestEntry,
            root,
            contentRoot,
            model,
            vfx,
            mixer: null,
            anchor: null,
            anchorRequestVersion: 0,
            anchorOffset: new Vector3(),
            facingYaw: 0,
            loaded: false,
            placed: false,
            visible: false,
            modelVisible: false,
            appearStartedAt: null,
            disappearStartedAt: null
          });
        });

        surfacePreview.visible = false;
        scene.add(scannedSurfaces);
        scene.add(surfacePreview);
        scene.add(reticle);

        startupStep = "loading mascot models";

        await Promise.all(
          mascots.map(async (manifestEntry) => {
            const runtime = mascotRuntimes.get(manifestEntry.id);

            if (!runtime) {
              return;
            }

            const instance = await instantiateMascotModel(manifestEntry.modelUrl);

            if (disposed) {
              return;
            }

            runtime.model.add(instance.scene);
            // Cached model instances share materials. Clone only this WebXR
            // instance's materials before adding the session-specific shader.
            occlusionController.patchObject(instance.scene, { cloneMaterials: true });
            alignModelBottomToFloor(runtime.model, manifestEntry, MASCOT_TARGET_HEIGHT_METERS);
            applyMascotForwardCorrection(runtime.model);

            const firstAnimation = instance.animations[0];

            if (firstAnimation) {
              runtime.mixer = new AnimationMixer(instance.scene);
              runtime.mixer.clipAction(firstAnimation).play();
            }

            runtime.loaded = true;
            setLoadedMascotIds((ids) =>
              ids.includes(manifestEntry.id) ? ids : [...ids, manifestEntry.id]
            );
          })
        );

        startupStep = "requesting reference space";
        referenceSpaceType = await requestPlacementReferenceSpaceType(session);
        renderer.xr.setReferenceSpaceType(referenceSpaceType);
        renderer.xr.setFramebufferScaleFactor(profile.xrFramebufferScale);

        startupStep = "binding WebXR session";
        await renderer.xr.setSession(session);
        xrWebGLBinding = createXRWebGLBinding(session, renderer);
        if (!xrWebGLBinding) {
          cameraCaptureStateSnapshot = "unavailable";
          setCameraCaptureState("unavailable");
        }

        if (disposed) {
          return;
        }

        placementReferenceSpace = renderer.xr.getReferenceSpace();

        if (!placementReferenceSpace) {
          throw new Error("WebXR reference space was not available.");
        }

        if (!session.requestHitTestSource) {
          throw new Error("Hit testing was not available.");
        }

        startupStep = "requesting viewer space";
        const viewerSpace = await session.requestReferenceSpace("viewer");
        startupStep = "requesting hit-test source";
        hitTestSource = (await session.requestHitTestSource({ space: viewerSpace })) ?? null;

        if (!hitTestSource) {
          throw new Error("Hit testing was not available.");
        }

        // A second ray aimed toward the lower part of the camera view finds
        // floors sooner when the user is holding the phone near the horizon.
        // The centered source remains the compatibility fallback.
        try {
          floorHitTestSource =
            (await session.requestHitTestSource({
              space: viewerSpace,
              offsetRay: new XRRay(
                { x: 0, y: 0, z: 0, w: 1 },
                { x: 0, y: FLOOR_SCAN_RAY_Y, z: -1, w: 0 }
              )
            })) ?? null;
        } catch {
          floorHitTestSource = null;
        }

        enterPlacement();
        startupStep = "running scanner";
        lastSurfaceStatus = "scanning";
        setStatus("scanning");

        const updateSurfaceState = (surfaceFound: boolean) => {
          const nextStatus: ScanStatus = surfaceFound ? "surface-found" : "scanning";

          if (lastSurfaceStatus !== nextStatus) {
            lastSurfaceStatus = nextStatus;
            setStatus(nextStatus);
          }
        };

        captureStillRef.current = () => {
          if (captureInProgress) {
            return;
          }

          setCaptureFailureReason(null);
          captureAttemptCount = 0;
          captureRequested = true;
          setCaptureStatus("capturing");
        };

        selectMascotForPlacementRef.current = (mascotId) => {
          const runtime = mascotRuntimes.get(mascotId);
          const isRepositioning = placedMascotIdsRef.current.includes(mascotId);

          activeMascotIdRef.current = mascotId;
          setActiveMascotId(mascotId);
          movingMascotIdRef.current = isRepositioning ? mascotId : null;
          setMovingMascotId(isRepositioning ? mascotId : null);

          if (runtime && isRepositioning) {
            runtime.anchorRequestVersion += 1;
            runtime.anchor?.delete();
            runtime.anchor = null;
            runtime.placed = false;
            runtime.visible = false;
            startMascotDisappear(runtime, performance.now());
          }

          lastSurfaceStatus = reticle.visible ? "surface-found" : "scanning";
          setStatus(lastSurfaceStatus);
          enterPlacement();
        };

        renderer.setAnimationLoop((frameTime, frame) => {
          if (!renderer || disposed) {
            return;
          }

          const delta = (frameTime - previousFrameTime) / 1000;
          previousFrameTime = frameTime;
          const activePlacementRuntime = mascotRuntimes.get(activeMascotIdRef.current);
          const needsPlacementSurface = !activePlacementRuntime?.placed;
          let hasPlacedMascot = false;

          for (const runtime of mascotRuntimes.values()) {
            if (runtime.placed) {
              hasPlacedMascot = true;
              break;
            }
          }

          // Floor scanning keeps priority, but already placed mascots continue
          // receiving lower-rate occlusion updates while another is positioned.
          const occlusionThrottleMultiplier = needsPlacementSurface ? 2 : 1;

          if (
            occlusionActive &&
            hasPlacedMascot &&
            frame &&
            placementReferenceSpace &&
            frameTime - lastDepthFrameTime >=
              getDepthIntervalMs(profile) * occlusionThrottleMultiplier
          ) {
            occlusionController.updateDepth(frame, placementReferenceSpace);
            lastDepthFrameTime = frameTime;
          }

          // Only animate mascots that are actually visible in the scene.
          mascotRuntimes.forEach((runtime) => {
            if (runtime.anchor && frame && placementReferenceSpace) {
              const anchorPose = frame.getPose(runtime.anchor.anchorSpace, placementReferenceSpace);

              if (anchorPose) {
                placeMascotAtHit(
                  runtime.root,
                  anchorPose.transform.matrix,
                  runtime.facingYaw,
                  runtime.anchorOffset
                );
              }
            }

            const hasActiveVfx = updateMascotVfx(runtime, frameTime);

            if (runtime.placed || hasActiveVfx) {
              runtime.mixer?.update(delta);
            }

            if (!runtime.placed && !hasActiveVfx && runtime.disappearStartedAt === null) {
              runtime.root.visible = false;
            }
          });
          fadeScannedSurfacePatches(scannedSurfaces, frameTime, releaseScannedPatch);

          if (frame && hitTestSource && placementReferenceSpace && needsPlacementSurface) {
            const floorHit = getCurrentFloorHit(
              frame,
              hitTestSource,
              floorHitTestSource,
              placementReferenceSpace,
              referenceSpaceType,
              reticle.visible ? floorPoseSmoother.position : null
            );
            const pose = floorHit?.pose;

            if (pose) {
              lastValidFloorHitTime = frameTime;
              if (getViewerPosition(frame, placementReferenceSpace, viewerPosition)) {
                offsetFloorHitAwayFromViewer(
                  pose.transform.matrix,
                  viewerPosition,
                  FLOOR_FORWARD_BIAS_METERS,
                  biasedFloorHitMatrix
                );
              } else {
                biasedFloorHitMatrix.set(pose.transform.matrix);
              }
              floorPoseSmoother.update(biasedFloorHitMatrix, frameTime, floorPlacementMatrix);
              latestHitMatrix.set(floorPlacementMatrix);
              reticle.visible = true;
              reticle.matrix.fromArray(floorPlacementMatrix);
              markObjectMatrixDirty(reticle);

              if (surfacePreviewStartedAt === 0) {
                surfacePreviewStartedAt = frameTime;
              }

              surfacePreview.matrix.fromArray(floorPlacementMatrix);
              updateSurfacePatchFade(surfacePreview, frameTime - surfacePreviewStartedAt);
              markObjectMatrixDirty(surfacePreview);
              if (
                sampleScannedSurfacePatch(
                  scannedSurfaces,
                  floorPlacementMatrix,
                  frameTime,
                  surfaceSamplePosition,
                  lastSurfaceSamplePosition,
                  lastSurfaceSampleTime,
                  profile,
                  acquireScannedPatch,
                  releaseScannedPatch
                )
              ) {
                lastSurfaceSampleTime = frameTime;
              }
              updateSurfaceState(true);
            } else if (frameTime - lastValidFloorHitTime > FLOOR_HIT_GRACE_MS) {
              reticle.visible = false;
              surfacePreview.visible = false;
              surfacePreviewStartedAt = 0;
              floorPoseSmoother.reset();
              updateSurfaceState(false);
            }
          }

          if (
            frame &&
            occlusionActive &&
            hasPlacedMascot &&
            placementReferenceSpace &&
            xrWebGLBinding &&
            cameraFrameSampler &&
            personSegmentation &&
            frameTime - lastSegmentationFrameTime >=
              getSegmentationIntervalMs(profile) * occlusionThrottleMultiplier
          ) {
            const image = cameraFrameSampler.sample(
              frame,
              placementReferenceSpace,
              xrWebGLBinding,
              getSegmentationResolution(profile),
              getSegmentationResolution(profile)
            );

            if (image && personSegmentation.tryProcess(image, frameTime)) {
              lastSegmentationFrameTime = frameTime;
            }
          }

          if (
            frame &&
            placementReferenceSpace &&
            xrWebGLBinding &&
            cameraCaptureStateSnapshot !== "available"
          ) {
            if (hasRawCameraView(frame, placementReferenceSpace)) {
              cameraReadyFrameCount += 1;
              cameraReadbackProbeCount = 0;

              if (cameraReadyFrameCount >= CAMERA_READY_FRAME_THRESHOLD) {
                cameraCaptureStateSnapshot = "available";
                setCameraCaptureState("available");
              }
            } else {
              cameraReadyFrameCount = 0;
              cameraReadbackProbeCount += 1;

              if (cameraReadbackProbeCount > CAMERA_READBACK_PROBE_FRAME_LIMIT) {
                cameraCaptureStateSnapshot = "unavailable";
                setCameraCaptureState("unavailable");
              }
            }
          }

          if (captureRequested && !captureInProgress) {
            captureRequested = false;

            if (cameraCaptureStateSnapshot !== "available") {
              setCaptureFailureReason("Camera view missing");
              captureAttemptCount = 0;
              setCaptureStatus("failed");
              return;
            }

            if (!cameraFrameSampler && xrWebGLBinding) {
              try {
                cameraFrameSampler = new XRCameraFrameSampler(
                  renderer.getContext() as WebGL2RenderingContext
                );
              } catch {
                cameraFrameSampler?.dispose();
                cameraFrameSampler = null;
              }
            }

            captureInProgress = true;
            captureAttemptCount += 1;
            void captureCleanFrame({
              renderer,
              scene,
              camera,
              hiddenObjects: [reticle, surfacePreview, scannedSurfaces],
              frame,
              referenceSpace: placementReferenceSpace,
              xrWebGLBinding,
              cameraFrameSampler,
              occlusionController,
              acquireVirtualRenderer
            })
              .then((result) => {
                const fileName = createCaptureFileName();
                const url = URL.createObjectURL(result.blob);
                setCapturedPhoto((previousPhoto) => {
                  if (previousPhoto) {
                    URL.revokeObjectURL(previousPhoto.url);
                  }

                  return {
                    ...result,
                    fileName,
                    url
                  };
                });
                setCaptureFailureReason(null);
                captureAttemptCount = 0;
                setCaptureStatus("ready");
              })
              .catch((error) => {
                const failureReason = getCaptureFailureReason(error);

                if (shouldRetryCapture(failureReason, captureAttemptCount)) {
                  captureRequested = true;
                  setCaptureStatus("capturing");
                  return;
                }

                captureAttemptCount = 0;
                setCaptureFailureReason(failureReason);
                setCaptureStatus("failed");
              })
              .finally(() => {
                captureInProgress = false;
              });
          }

          renderer.render(scene, camera);
        });
      } catch (error) {
        if (!disposed) {
          setStatus("error");
          onError(
            `WebXR scanner failed while ${startupStep}. ${
              error instanceof Error
                ? error.message
                : "Try Android Chrome on an ARCore-capable phone over HTTPS."
            }`
          );
        }
      }
    }

    const placeActiveMascot = (frame: XRFrame | null) => {
      const selectedMascotId = activeMascotIdRef.current;
      const runtime = mascotRuntimes.get(selectedMascotId);
      const placementTime = performance.now();

      if (
        !runtime ||
        !runtime.loaded ||
        !reticle.visible ||
        placementTime - lastPlacementTime < PLACEMENT_DEBOUNCE_MS
      ) {
        return;
      }

      lastPlacementTime = placementTime;
      const wasPlaced = runtime.placed || placedMascotIdsRef.current.includes(selectedMascotId);
      runtime.anchorRequestVersion += 1;
      const anchorRequestVersion = runtime.anchorRequestVersion;
      runtime.anchor?.delete();
      runtime.anchor = null;
      runtime.anchorOffset.set(0, 0, 0);
      if (
        (frame && getViewerPosition(frame, placementReferenceSpace, viewerPosition)) ||
        getRendererCameraPosition(renderer, viewerPosition)
      ) {
        runtime.facingYaw = getCameraFacingYaw(latestHitMatrix, viewerPosition, runtime.facingYaw);
      }
      placeMascotAtHit(runtime.root, latestHitMatrix, runtime.facingYaw);
      runtime.root.visible = true;
      runtime.placed = true;
      startMascotAppear(runtime, performance.now());
      activateOcclusionAfterPlacement();
      movingMascotIdRef.current = null;
      setMovingMascotId(null);

      const selectedFloorHit =
        frame && hitTestSource && placementReferenceSpace
          ? getCurrentFloorHit(
              frame,
              hitTestSource,
              floorHitTestSource,
              placementReferenceSpace,
              referenceSpaceType,
              floorPoseSmoother.position
            )
          : undefined;
      const selectedHit = selectedFloorHit?.hit;

      if (selectedFloorHit) {
        const anchorMatrix = selectedFloorHit.pose.transform.matrix;
        runtime.anchorOffset.set(
          (latestHitMatrix[12] ?? 0) - (anchorMatrix[12] ?? 0),
          (latestHitMatrix[13] ?? 0) - (anchorMatrix[13] ?? 0),
          (latestHitMatrix[14] ?? 0) - (anchorMatrix[14] ?? 0)
        );
      }

      if (selectedHit?.createAnchor) {
        void selectedHit
          .createAnchor()
          .then((anchor) => {
            if (
              disposed ||
              !runtime.placed ||
              runtime.anchorRequestVersion !== anchorRequestVersion
            ) {
              anchor.delete();
              return;
            }

            runtime.anchor?.delete();
            runtime.anchor = anchor;
          })
          .catch(() => {
            // Matrix placement remains active when anchors are unsupported or
            // the runtime loses tracking during asynchronous creation.
          });
      }

      if (wasPlaced) {
        if (placedMascotIdsRef.current.length === mascots.length) {
          reticle.visible = false;
          surfacePreview.visible = false;
          lastSurfaceStatus = "placed";
        } else {
          lastSurfaceStatus = "surface-found";
        }

        setStatus(lastSurfaceStatus);
        return;
      }

      markMascotPlaced();

      const nextPlacedIds = [...placedMascotIdsRef.current, selectedMascotId];
      placedMascotIdsRef.current = nextPlacedIds;
      setPlacedMascotIds(nextPlacedIds);

      const nextMascot = mascots.find((candidate) => !nextPlacedIds.includes(candidate.id));

      if (nextMascot) {
        activeMascotIdRef.current = nextMascot.id;
        setActiveMascotId(nextMascot.id);
        lastSurfaceStatus = reticle.visible ? "surface-found" : "scanning";
        setStatus(lastSurfaceStatus);
      } else {
        reticle.visible = false;
        surfacePreview.visible = false;
        lastSurfaceStatus = "placed";
        setStatus("placed");
      }
    };

    const handleSelect = (event: XRInputSourceEvent) => {
      if (placementFallbackTimer !== null) {
        window.clearTimeout(placementFallbackTimer);
        placementFallbackTimer = null;
      }

      placeActiveMascot(event.frame);
    };

    const handlePointerPlacement = () => {
      if (placementFallbackTimer !== null || disposed || !reticle.visible) {
        return;
      }

      // Chrome normally emits an XR `select` for an AR screen tap. Some
      // DOM-overlay/device combinations emit only the canvas pointer event, so
      // use it as a delayed fallback and let `select` win when both arrive.
      placementFallbackTimer = window.setTimeout(() => {
        placementFallbackTimer = null;
        placeActiveMascot(null);
      }, POINTER_PLACEMENT_FALLBACK_DELAY_MS);
    };

    const handleEnd = () => {
      sessionEnded = true;
      cleanup();
      onEnd();
    };

    function cleanup() {
      if (disposed) {
        return;
      }

      disposed = true;
      captureStillRef.current = () => undefined;
      selectMascotForPlacementRef.current = () => undefined;
      session.removeEventListener("select", handleSelect);
      session.removeEventListener("end", handleEnd);
      xrCanvas.removeEventListener("pointerup", handlePointerPlacement);
      renderer?.setAnimationLoop(null);
      hitTestSource?.cancel();
      floorHitTestSource?.cancel();
      if (segmentationStartTimer !== null) {
        window.clearTimeout(segmentationStartTimer);
        segmentationStartTimer = null;
      }
      if (placementFallbackTimer !== null) {
        window.clearTimeout(placementFallbackTimer);
        placementFallbackTimer = null;
      }
      mascotRuntimes.forEach((runtime) => {
        runtime.anchorRequestVersion += 1;
        runtime.anchor?.delete();
        runtime.anchor = null;
        runtime.mixer?.stopAllAction();
        // Cached model instances share geometry/materials with the model
        // cache; detach them so scene disposal only frees session resources.
        runtime.model.clear();
        disposeMascotVfx(runtime.vfx);
      });
      surfacePatchPool.forEach(disposeSurfacePatchMaterials);
      surfacePatchPool.length = 0;
      disposeObjectResources(scene);
      patchGeometries.fill.dispose();
      patchGeometries.grid.dispose();
      personSegmentation?.dispose();
      cameraFrameSampler?.dispose();
      occlusionController.dispose();
      captureRenderer?.dispose();
      renderer?.dispose();
    }

    session.addEventListener("select", handleSelect);
    session.addEventListener("end", handleEnd);
    xrCanvas.addEventListener("pointerup", handlePointerPlacement);
    void startWebXR();

    return () => {
      cleanup();

      if (!sessionEnded) {
        void session.end().catch(() => undefined);
      }
    };
  }, [enterPlacement, markMascotPlaced, mascots, onEnd, onError, session]);

  const allPlaced = placedMascotIds.length === mascots.length;
  const isMovingPlacedMascot = movingMascotId !== null;
  const activeMascotName =
    mascots.find((entry) => entry.id === activeMascotId)?.displayName ?? "mascot";
  const captureWarnings = [
    ...(cameraCaptureState === "unavailable"
      ? ["Browser camera capture is unavailable in this WebXR session."]
      : []),
    ...(captureStatus === "failed" && captureFailureReason ? [captureFailureReason] : [])
  ];

  const overlayControls = (
    <MascotOverlayControls
      mascots={mascots}
      activeMascotId={activeMascotId}
      loadedMascotIds={loadedMascotIds}
      placedMascotIds={placedMascotIds}
      onMascotButton={(mascotId) => {
        selectMascotForPlacementRef.current(mascotId);
      }}
      captureButtonLabel={getCaptureButtonLabel(captureStatus, cameraCaptureState)}
      captureDisabled={
        Boolean(capturedPhoto) ||
        captureStatus === "capturing" ||
        cameraCaptureState !== "available" ||
        placedMascotIds.length === 0
      }
      onCapture={() => captureStillRef.current()}
      captureWarnings={captureWarnings}
      capturedPhoto={capturedPhoto}
      onRetake={() => {
        setCapturedPhoto(null);
        setCaptureStatus("idle");
      }}
    >
      <button className="camera-end-button" type="button" onClick={() => void session.end()}>
        ← Back
      </button>
      <p className="camera-scan-hint" role="status">
        {getScanHint(status, allPlaced && !isMovingPlacedMascot, activeMascotName)}
      </p>
    </MascotOverlayControls>
  );

  return (
    <section className="webxr-session" data-testid="webxr-session">
      <canvas ref={canvasRef} className="webxr-canvas" aria-label="WebXR surface scanner" />
      {domOverlayRoot ? createPortal(overlayControls, domOverlayRoot) : overlayControls}
    </section>
  );
}

function getCaptureButtonLabel(
  captureStatus: CaptureStatus,
  cameraCaptureState: CameraCaptureState
) {
  if (cameraCaptureState === "checking") {
    return "Preparing Capture...";
  }
  if (cameraCaptureState === "unavailable") {
    return "Capture Unavailable";
  }
  if (captureStatus === "capturing") {
    return "Capturing...";
  }
  if (captureStatus === "ready") {
    return "Captured";
  }
  if (captureStatus === "failed") {
    return "Try Capture Again";
  }
  return "Capture";
}

function getInitialMascotId(mascots: readonly MascotManifestEntry[]) {
  const mascot = mascots[0];

  if (!mascot) {
    throw new Error("At least one mascot must be configured.");
  }

  return mascot.id;
}

interface SurfacePatchGeometries {
  fill: PlaneGeometry;
  grid: BufferGeometry;
}

interface SurfacePatchMaterials {
  fill: MeshBasicMaterial;
  line: LineBasicMaterial;
  fillOpacity: number;
  lineOpacity: number;
}

function createSurfacePatch(
  geometries: SurfacePatchGeometries,
  fillOpacity: number,
  lineOpacity: number
) {
  const patch = new Group();
  const fillMaterial = new MeshBasicMaterial({
    color: 0x35f3cf,
    side: DoubleSide,
    transparent: true,
    opacity: fillOpacity,
    depthTest: false,
    depthWrite: false
  });
  const lineMaterial = new LineBasicMaterial({
    color: 0xf9f871,
    transparent: true,
    opacity: lineOpacity,
    depthTest: false,
    depthWrite: false
  });
  const fill = new Mesh(geometries.fill, fillMaterial);
  const grid = new LineSegments(geometries.grid, lineMaterial);
  grid.position.y = 0.004;
  patch.add(fill, grid);
  patch.matrixAutoUpdate = false;
  const patchMaterials: SurfacePatchMaterials = {
    fill: fillMaterial,
    line: lineMaterial,
    fillOpacity,
    lineOpacity
  };
  patch.userData.materials = patchMaterials;

  return patch;
}

function getSurfacePatchMaterials(patch: Object3D): SurfacePatchMaterials | null {
  return (patch.userData.materials as SurfacePatchMaterials | undefined) ?? null;
}

function disposeSurfacePatchMaterials(patch: Group) {
  const materials = getSurfacePatchMaterials(patch);
  materials?.fill.dispose();
  materials?.line.dispose();
}

function sampleScannedSurfacePatch(
  scannedSurfaces: Group,
  matrix: Float32Array,
  frameTime: number,
  samplePosition: Vector3,
  lastSamplePosition: Vector3,
  lastSampleTime: number,
  profile: QualityProfile,
  acquirePatch: () => Group,
  releasePatch: (patch: Group) => void
): boolean {
  samplePosition.set(matrix[12] ?? 0, matrix[13] ?? 0, matrix[14] ?? 0);

  if (
    frameTime - lastSampleTime < profile.surfaceSampleIntervalMs ||
    samplePosition.distanceTo(lastSamplePosition) < SURFACE_SAMPLE_DISTANCE_METERS
  ) {
    return false;
  }

  const patch = acquirePatch();
  patch.matrix.fromArray(matrix);
  patch.userData.createdAt = frameTime;
  patch.visible = true;
  setSurfacePatchOpacity(patch, 1);
  markObjectMatrixDirty(patch);
  scannedSurfaces.add(patch);
  lastSamplePosition.copy(samplePosition);

  while (scannedSurfaces.children.length > profile.maxScannedSurfacePatches) {
    const oldestPatch = scannedSurfaces.children[0];
    if (!oldestPatch) {
      break;
    }

    releasePatch(oldestPatch as Group);
  }

  return true;
}

function updateSurfacePatchFade(patch: Group, ageMs: number) {
  const opacityScale = getSurfacePatternOpacityScale(ageMs);
  setSurfacePatchOpacity(patch, opacityScale);
  patch.visible = opacityScale > 0;
}

function fadeScannedSurfacePatches(
  scannedSurfaces: Group,
  frameTime: number,
  releasePatch: (patch: Group) => void
) {
  for (let index = scannedSurfaces.children.length - 1; index >= 0; index -= 1) {
    const patch = scannedSurfaces.children[index] as Group;
    const createdAt = typeof patch.userData.createdAt === "number" ? patch.userData.createdAt : 0;
    const opacityScale = getSurfacePatternOpacityScale(frameTime - createdAt);

    if (opacityScale <= 0) {
      releasePatch(patch);
      continue;
    }

    setSurfacePatchOpacity(patch, opacityScale);
  }
}

function getSurfacePatternOpacityScale(ageMs: number) {
  if (ageMs <= SURFACE_PATTERN_HOLD_MS) {
    return 1;
  }

  const fadeProgress = (ageMs - SURFACE_PATTERN_HOLD_MS) / SURFACE_PATTERN_FADE_MS;
  return Math.max(0, 1 - fadeProgress);
}

function setSurfacePatchOpacity(patch: Object3D, opacityScale: number) {
  const materials = getSurfacePatchMaterials(patch);

  if (!materials) {
    return;
  }

  // Opacity is a uniform update; never set material.needsUpdate here — that
  // forces shader program rebuilds and causes frame spikes on slow GPUs.
  materials.fill.opacity = materials.fillOpacity * opacityScale;
  materials.line.opacity = materials.lineOpacity * opacityScale;
}

async function captureCleanFrame({
  renderer,
  scene,
  camera,
  hiddenObjects,
  frame,
  referenceSpace,
  xrWebGLBinding,
  cameraFrameSampler,
  occlusionController,
  acquireVirtualRenderer
}: CaptureFrameOptions): Promise<CaptureResult> {
  const previousVisibility = hiddenObjects.map((object) => object.visible);

  hiddenObjects.forEach((object) => {
    object.visible = false;
  });

  renderer.render(scene, camera);

  try {
    const gl = renderer.getContext();
    const captureSize = getCaptureCameraSize(frame, referenceSpace, CAPTURE_MAX_EDGE_PIXELS);
    const sampledCameraImage =
      frame && referenceSpace && xrWebGLBinding
        ? cameraFrameSampler?.sample(
            frame,
            referenceSpace,
            xrWebGLBinding,
            captureSize?.width,
            captureSize?.height
          )
        : null;
    const { image: fallbackCameraImage, failureReason } = sampledCameraImage
      ? { image: null, failureReason: undefined }
      : readRawCameraImage(frame, referenceSpace, xrWebGLBinding, gl);
    const cameraImage = sampledCameraImage
      ? {
          imageData: sampledCameraImage,
          width: sampledCameraImage.width,
          height: sampledCameraImage.height
        }
      : fallbackCameraImage;

    if (!cameraImage) {
      throw createCaptureError(failureReason ?? "Camera texture unavailable");
    }

    let virtualImage: ReadableFrameImage | null = null;
    occlusionController.setEnabled(false);
    try {
      // Live XR occlusion UVs are not guaranteed to match the offscreen photo
      // framebuffer. Render a complete mascot layer for capture rather than
      // allowing mismatched depth/mask pixels to erase parts of the model.
      virtualImage = renderVirtualSceneImage(
        acquireVirtualRenderer,
        scene,
        getCurrentXRCaptureCamera(renderer, camera),
        cameraImage.width,
        cameraImage.height
      );
    } finally {
      occlusionController.setEnabled(true);
    }

    return {
      blob: await composeCaptureBlob(cameraImage, virtualImage)
    };
  } finally {
    hiddenObjects.forEach((object, index) => {
      object.visible = previousVisibility[index] ?? object.visible;
    });
  }
}

function createXRCompatibleWebGL2Context(canvas: HTMLCanvasElement, profile: QualityProfile) {
  const attributes: WebGLContextAttributes & { xrCompatible: boolean } = {
    alpha: true,
    antialias: profile.antialias,
    premultipliedAlpha: true,
    // The XR framebuffer is captured through camera-access + an offscreen
    // renderer, so the main canvas never needs preserveDrawingBuffer.
    preserveDrawingBuffer: false,
    xrCompatible: true
  };

  return canvas.getContext("webgl2", attributes);
}

function getCurrentXRCaptureCamera(renderer: WebGLRenderer, fallbackCamera: Camera): Camera {
  const xrCamera = renderer.xr.getCamera();
  const firstSubCamera = (xrCamera as unknown as { cameras?: Camera[] }).cameras?.[0];

  return firstSubCamera ?? xrCamera ?? fallbackCamera;
}

function getCaptureCameraSize(
  frame: XRFrame | undefined,
  referenceSpace: XRReferenceSpace | null,
  maximumEdge: number
) {
  if (!frame || !referenceSpace) {
    return null;
  }

  try {
    const camera = frame.getViewerPose(referenceSpace)?.views.find((view) => view.camera)?.camera;

    if (!camera || camera.width <= 0 || camera.height <= 0) {
      return null;
    }

    const scale = Math.min(1, maximumEdge / Math.max(camera.width, camera.height));
    return {
      width: Math.max(1, Math.round(camera.width * scale)),
      height: Math.max(1, Math.round(camera.height * scale))
    };
  } catch {
    return null;
  }
}

function renderVirtualSceneImage(
  acquireVirtualRenderer: (width: number, height: number) => WebGLRenderer | null,
  scene: Scene,
  camera: Camera,
  width: number,
  height: number
): ReadableFrameImage | null {
  const virtualRenderer = acquireVirtualRenderer(width, height);

  if (!virtualRenderer) {
    return null;
  }

  virtualRenderer.clear(true, true, true);
  virtualRenderer.render(scene, camera);

  return readCurrentFramebufferImage(virtualRenderer.getContext(), virtualRenderer.domElement);
}

function hasRawCameraView(frame: XRFrame, referenceSpace: XRReferenceSpace) {
  return Boolean(frame.getViewerPose(referenceSpace)?.views.some((view) => view.camera));
}

function createXRWebGLBinding(session: XRSession, renderer: WebGLRenderer) {
  const BindingConstructor = (globalThis as { XRWebGLBinding?: XRWebGLBindingConstructor })
    .XRWebGLBinding;

  if (!BindingConstructor) {
    return null;
  }

  try {
    return new BindingConstructor(session, renderer.getContext());
  } catch {
    return null;
  }
}

function readRawCameraImage(
  frame: XRFrame | undefined,
  referenceSpace: XRReferenceSpace | null,
  xrWebGLBinding: XRWebGLBindingCameraAccess | null,
  gl: WebGLRenderingContext | WebGL2RenderingContext
): CameraReadbackResult {
  if (!frame || !referenceSpace || !xrWebGLBinding) {
    return { image: null, failureReason: "Camera view missing" };
  }

  const viewerPose = frame.getViewerPose(referenceSpace);
  const view = viewerPose?.views.find((candidate) => candidate.camera);
  const xrCamera = view?.camera;

  if (!xrCamera) {
    return { image: null, failureReason: "Camera view missing" };
  }

  clearWebGLErrors(gl);

  let cameraTexture: WebGLTexture | null = null;

  try {
    cameraTexture = xrWebGLBinding.getCameraImage(xrCamera);
  } catch {
    return { image: null, failureReason: "Camera texture unavailable" };
  }

  if (!cameraTexture) {
    return { image: null, failureReason: "Camera texture unavailable" };
  }

  const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const framebuffer = gl.createFramebuffer();

  if (!framebuffer) {
    return { image: null, failureReason: "Camera framebuffer unavailable" };
  }

  try {
    const width = Math.max(1, xrCamera.width);
    const height = Math.max(1, xrCamera.height);
    const pixels = new Uint8Array(width * height * 4);
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cameraTexture, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      return { image: null, failureReason: "Camera framebuffer incomplete" };
    }

    clearWebGLErrors(gl);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    if (gl.getError() !== gl.NO_ERROR) {
      return { image: null, failureReason: "Camera pixel read failed" };
    }

    if (!hasMeaningfulPixels(pixels)) {
      return { image: null, failureReason: "Camera image was blank" };
    }

    return {
      image: {
        imageData: bottomLeftPixelsToImageData(pixels, width, height),
        width,
        height
      }
    };
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
    gl.bindTexture(gl.TEXTURE_2D, previousTexture);
    gl.deleteFramebuffer(framebuffer);
  }
}

function readCurrentFramebufferImage(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  canvas: HTMLCanvasElement
): ReadableFrameImage | null {
  const width = Math.max(1, gl.drawingBufferWidth || canvas.width);
  const height = Math.max(1, gl.drawingBufferHeight || canvas.height);
  const pixels = new Uint8Array(width * height * 4);

  try {
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    if (gl.getError() !== gl.NO_ERROR || !hasMeaningfulPixels(pixels)) {
      return null;
    }

    return {
      imageData: normalizeVirtualFrameAlpha(bottomLeftPixelsToImageData(pixels, width, height)),
      width,
      height
    };
  } catch {
    return null;
  }
}

function bottomLeftPixelsToImageData(pixels: Uint8Array, width: number, height: number) {
  const flippedPixels = new Uint8ClampedArray(pixels.length);
  const rowLength = width * 4;

  for (let row = 0; row < height; row += 1) {
    const sourceStart = (height - row - 1) * rowLength;
    const targetStart = row * rowLength;
    flippedPixels.set(pixels.subarray(sourceStart, sourceStart + rowLength), targetStart);
  }

  return new ImageData(flippedPixels, width, height);
}

function normalizeVirtualFrameAlpha(imageData: ImageData) {
  const data = imageData.data;
  let opaqueBlackPixels = 0;
  const pixelCount = data.length / 4;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    const alpha = data[index + 3] ?? 0;

    if (red < 6 && green < 6 && blue < 6 && alpha > 245) {
      opaqueBlackPixels += 1;
    }
  }

  if (opaqueBlackPixels / pixelCount < 0.6) {
    return imageData;
  }

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;

    if (red < 6 && green < 6 && blue < 6) {
      data[index + 3] = 0;
    }
  }

  return imageData;
}

function hasMeaningfulPixels(pixels: Uint8Array) {
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    const alpha = pixels[index + 3] ?? 0;

    if (red > 2 || green > 2 || blue > 2 || alpha > 2) {
      return true;
    }
  }

  return false;
}

function clearWebGLErrors(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  while (gl.getError() !== gl.NO_ERROR) {
    // Drain stale WebGL errors so capture checks only inspect their own operations.
  }
}

async function composeCaptureBlob(
  cameraImage: ReadableFrameImage,
  virtualImage: ReadableFrameImage | null
) {
  const canvas = document.createElement("canvas");
  canvas.width = cameraImage.width;
  canvas.height = cameraImage.height;
  const context = get2DContext(canvas);

  context.putImageData(cameraImage.imageData, 0, 0);

  if (virtualImage) {
    const virtualCanvas = document.createElement("canvas");
    virtualCanvas.width = virtualImage.width;
    virtualCanvas.height = virtualImage.height;
    get2DContext(virtualCanvas).putImageData(virtualImage.imageData, 0, 0);
    context.drawImage(virtualCanvas, 0, 0, canvas.width, canvas.height);
  }

  return canvasToBlob(canvas);
}

function createCaptureError(reason: CaptureFailureReason) {
  const error = new Error(reason);
  error.name = "CaptureFailure";

  return error;
}

function getCaptureFailureReason(error: unknown): CaptureFailureReason {
  if (error instanceof Error && isCaptureFailureReason(error.message)) {
    return error.message;
  }

  return "Capture image encoding failed";
}

function isCaptureFailureReason(reason: string): reason is CaptureFailureReason {
  return CAPTURE_FAILURE_REASONS.includes(reason as CaptureFailureReason);
}

function shouldRetryCapture(reason: CaptureFailureReason, attemptCount: number) {
  return attemptCount < CAPTURE_RETRY_FRAME_LIMIT && reason !== "Capture image encoding failed";
}

function placeMascotAtHit(
  mascotRoot: Group,
  hitMatrix: ArrayLike<number>,
  facingYaw: number,
  positionOffset?: Vector3
) {
  // World-placement mascots always stand upright. Hit-test and anchor normals
  // can be noisy or inverted even when their position correctly lies on the
  // floor, so preserve only the tracked translation and camera-facing yaw.
  mascotRoot.matrix.makeRotationY(facingYaw);
  mascotRoot.matrix.setPosition(
    (hitMatrix[12] ?? 0) + (positionOffset?.x ?? 0),
    (hitMatrix[13] ?? 0) + (positionOffset?.y ?? 0),
    (hitMatrix[14] ?? 0) + (positionOffset?.z ?? 0)
  );
  markObjectMatrixDirty(mascotRoot);
}

function getViewerPosition(
  frame: XRFrame,
  referenceSpace: XRReferenceSpace | null,
  target: Vector3
) {
  if (!referenceSpace) {
    return false;
  }

  let viewerMatrix: Float32Array | undefined;

  try {
    viewerMatrix = frame.getViewerPose(referenceSpace)?.views[0]?.transform.matrix;
  } catch {
    return false;
  }

  if (!viewerMatrix) {
    return false;
  }

  target.set(viewerMatrix[12] ?? 0, viewerMatrix[13] ?? 0, viewerMatrix[14] ?? 0);
  return true;
}

function getRendererCameraPosition(renderer: WebGLRenderer | null, target: Vector3) {
  if (!renderer) {
    return false;
  }

  try {
    renderer.xr.getCamera().getWorldPosition(target);
  } catch {
    return false;
  }
  return Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z);
}

function markObjectMatrixDirty(object: Object3D) {
  object.matrixWorldNeedsUpdate = true;
}

function createSurfaceGridGeometry(size: number, divisions: number) {
  const half = size / 2;
  const positions: number[] = [];

  for (let index = 0; index <= divisions; index += 1) {
    const offset = -half + (size * index) / divisions;
    positions.push(-half, 0, offset, half, 0, offset);
    positions.push(offset, 0, -half, offset, 0, half);
  }

  positions.push(-half, 0, -half, half, 0, half);
  positions.push(-half, 0, half, half, 0, -half);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

  return geometry;
}

function getCurrentFloorHit(
  frame: XRFrame,
  centeredSource: XRHitTestSource,
  floorSource: XRHitTestSource | null,
  referenceSpace: XRReferenceSpace,
  referenceSpaceType: PlacementReferenceSpaceType,
  preferredPosition: Vector3 | null
) {
  try {
    return findBestFloorHit(
      [
        ...(floorSource ? frame.getHitTestResults(floorSource) : []),
        ...frame.getHitTestResults(centeredSource)
      ],
      referenceSpace,
      referenceSpaceType,
      preferredPosition
    );
  } catch {
    return null;
  }
}

function findBestFloorHit(
  hitTestResults: readonly XRHitTestResult[],
  referenceSpace: XRReferenceSpace,
  referenceSpaceType: PlacementReferenceSpaceType,
  preferredPosition: Vector3 | null
): { hit: XRHitTestResult; pose: XRPose } | null {
  let bestHit: { hit: XRHitTestResult; pose: XRPose } | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const hit of hitTestResults) {
    const pose = hit.getPose(referenceSpace);

    if (!pose) {
      continue;
    }

    const matrix = pose.transform.matrix;
    // The hit-test pose's local Y axis is the estimated surface normal. Depth
    // and feature-point normals can be noisy, and some runtimes flip the sign,
    // so compare the absolute up component instead of demanding near-perfect
    // +Y alignment.
    const upwardAlignment = Math.abs(matrix[5] ?? 0);
    const floorHeight = Math.abs(matrix[13] ?? 0);

    const nearKnownFloor =
      referenceSpaceType === "local-floor" && floorHeight <= FLOOR_MAX_HEIGHT_METERS;

    if (!nearKnownFloor && upwardAlignment < FLOOR_MINIMUM_NORMAL_ALIGNMENT) {
      continue;
    }

    const continuityDistance = preferredPosition
      ? Math.hypot(
          (matrix[12] ?? 0) - preferredPosition.x,
          (matrix[13] ?? 0) - preferredPosition.y,
          (matrix[14] ?? 0) - preferredPosition.z
        )
      : 0;
    const score =
      upwardAlignment * 2 +
      (nearKnownFloor ? 2 - floorHeight : 0) -
      Math.min(continuityDistance, 2) * FLOOR_CONTINUITY_WEIGHT;

    if (score > bestScore) {
      bestScore = score;
      bestHit = { hit, pose };
    }
  }

  return bestHit;
}

const SURFACE_PATCH_SIZE_METERS = 1.2;
const SURFACE_PATCH_DIVISIONS = 6;
const SURFACE_SAMPLE_DISTANCE_METERS = 0.28;
const SURFACE_PATTERN_HOLD_MS = 1000;
const SURFACE_PATTERN_FADE_MS = 500;
const FLOOR_SCAN_RAY_Y = -0.35;
const FLOOR_MINIMUM_NORMAL_ALIGNMENT = 0.6;
const FLOOR_MAX_HEIGHT_METERS = 0.45;
const FLOOR_CONTINUITY_WEIGHT = 2.5;
const FLOOR_HIT_GRACE_MS = 350;
const FLOOR_FORWARD_BIAS_METERS = 0.35;
const POINTER_PLACEMENT_FALLBACK_DELAY_MS = 90;
const PLACEMENT_DEBOUNCE_MS = 300;
const PERSON_SEGMENTATION_START_DELAY_MS = 350;
const PERSON_SEGMENTATION_RETRY_DELAY_MS = 500;
const CAMERA_READBACK_PROBE_FRAME_LIMIT = 90;
const CAMERA_READY_FRAME_THRESHOLD = 4;
const CAPTURE_RETRY_FRAME_LIMIT = 45;
const CAPTURE_MAX_EDGE_PIXELS = 1280;
const CAPTURE_FAILURE_REASONS: readonly CaptureFailureReason[] = [
  "Camera view missing",
  "Camera texture unavailable",
  "Camera framebuffer unavailable",
  "Camera framebuffer incomplete",
  "Camera pixel read failed",
  "Camera image was blank",
  "Capture image encoding failed"
];

function getSegmentationIntervalMs(profile: QualityProfile) {
  if (profile.tier === "high") {
    return 1000 / 6;
  }

  if (profile.tier === "mid") {
    return 1000 / 4;
  }

  return 1000 / 3;
}

function getSegmentationResolution(profile: QualityProfile) {
  if (profile.tier === "high") {
    return 224;
  }

  return profile.tier === "mid" ? 176 : 144;
}

function getDepthIntervalMs(profile: QualityProfile) {
  if (profile.tier === "high") {
    return 1000 / 20;
  }

  if (profile.tier === "mid") {
    return 1000 / 15;
  }

  return 1000 / 10;
}

async function requestPlacementReferenceSpaceType(
  session: XRSession
): Promise<PlacementReferenceSpaceType> {
  try {
    await session.requestReferenceSpace("local-floor");
    return "local-floor";
  } catch {
    await session.requestReferenceSpace("local");
    return "local";
  }
}

function canUseWebGL() {
  return (
    typeof window !== "undefined" &&
    (typeof window.WebGLRenderingContext !== "undefined" ||
      typeof window.WebGL2RenderingContext !== "undefined")
  );
}
