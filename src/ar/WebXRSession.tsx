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
import { getScanHint, MascotOverlayControls, type ScanStatus } from "./MascotOverlayControls";
import {
  alignModelBottomToFloor,
  applyMascotForwardCorrection,
  createMascotContactShadow,
  createReticle,
  disposeObjectResources,
  MASCOT_TARGET_HEIGHT_METERS
} from "./mascotSceneUtils";

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
  model: Group;
  mixer: AnimationMixer | null;
  loaded: boolean;
  placed: boolean;
}

interface CaptureFrameOptions {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  hiddenObjects: Object3D[];
  frame?: XRFrame;
  referenceSpace: XRReferenceSpace | null;
  xrWebGLBinding: XRWebGLBindingCameraAccess | null;
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
    let placementReferenceSpace: XRReferenceSpace | null = null;
    let lastSurfaceStatus: ScanStatus = "loading";
    let lastSurfaceSampleTime = 0;
    let previousFrameTime = performance.now();
    let referenceSpaceType: PlacementReferenceSpaceType = "local";
    let placedCount = 0;
    let captureRequested = false;
    let captureInProgress = false;
    let captureAttemptCount = 0;
    let xrWebGLBinding: XRWebGLBindingCameraAccess | null = null;
    let cameraCaptureStateSnapshot: CameraCaptureState = "checking";
    let cameraReadbackProbeCount = 0;
    let cameraReadyFrameCount = 0;
    let surfacePreviewStartedAt = 0;
    const lastSurfaceSamplePosition = new Vector3(Number.POSITIVE_INFINITY, 0, 0);
    const surfaceSamplePosition = new Vector3();
    const latestHitMatrix = new Float32Array(16);
    const scene = new Scene();
    const camera = new PerspectiveCamera();
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
          const model = new Group();
          const contactShadow = createMascotContactShadow();
          root.visible = false;
          root.matrixAutoUpdate = false;
          root.add(contactShadow, model);
          scene.add(root);
          mascotRuntimes.set(manifestEntry.id, {
            mascot: manifestEntry,
            root,
            model,
            mixer: null,
            loaded: false,
            placed: false
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

          activeMascotIdRef.current = mascotId;
          setActiveMascotId(mascotId);
          movingMascotIdRef.current = runtime?.placed ? mascotId : null;
          setMovingMascotId(runtime?.placed ? mascotId : null);
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
          // Only animate mascots that are actually visible in the scene.
          mascotRuntimes.forEach((runtime) => {
            if (runtime.placed) {
              runtime.mixer?.update(delta);
            }
          });
          fadeScannedSurfacePatches(scannedSurfaces, frameTime, releaseScannedPatch);

          const needsPlacementSurface =
            placedCount < mascots.length || movingMascotIdRef.current !== null;

          if (frame && hitTestSource && placementReferenceSpace && needsPlacementSurface) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            const hit = hitTestResults[0];
            const pose = hit?.getPose(placementReferenceSpace);

            if (pose) {
              latestHitMatrix.set(pose.transform.matrix);
              reticle.visible = true;
              reticle.matrix.fromArray(pose.transform.matrix);
              markObjectMatrixDirty(reticle);

              if (surfacePreviewStartedAt === 0) {
                surfacePreviewStartedAt = frameTime;
              }

              surfacePreview.matrix.fromArray(pose.transform.matrix);
              updateSurfacePatchFade(surfacePreview, frameTime - surfacePreviewStartedAt);
              markObjectMatrixDirty(surfacePreview);
              if (
                sampleScannedSurfacePatch(
                  scannedSurfaces,
                  pose.transform.matrix,
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
            } else {
              reticle.visible = false;
              surfacePreview.visible = false;
              surfacePreviewStartedAt = 0;
              updateSurfaceState(false);
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

    const handleSelect = () => {
      const selectedMascotId = activeMascotIdRef.current;
      const runtime = mascotRuntimes.get(selectedMascotId);

      if (!runtime || !runtime.loaded || !reticle.visible) {
        return;
      }

      const wasPlaced = runtime.placed || placedMascotIdsRef.current.includes(selectedMascotId);
      placeMascotAtHit(runtime.root, latestHitMatrix);
      runtime.root.visible = true;
      runtime.placed = true;
      movingMascotIdRef.current = null;
      setMovingMascotId(null);

      if (wasPlaced) {
        if (placedCount === mascots.length) {
          reticle.visible = false;
          surfacePreview.visible = false;
          lastSurfaceStatus = "placed";
        } else {
          lastSurfaceStatus = "surface-found";
        }

        setStatus(lastSurfaceStatus);
        return;
      }

      placedCount += 1;
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
      renderer?.setAnimationLoop(null);
      hitTestSource?.cancel();
      mascotRuntimes.forEach((runtime) => {
        runtime.mixer?.stopAllAction();
        // Cached model instances share geometry/materials with the model
        // cache; detach them so scene disposal only frees session resources.
        runtime.model.clear();
      });
      surfacePatchPool.forEach(disposeSurfacePatchMaterials);
      surfacePatchPool.length = 0;
      disposeObjectResources(scene);
      patchGeometries.fill.dispose();
      patchGeometries.grid.dispose();
      captureRenderer?.dispose();
      renderer?.dispose();
    }

    session.addEventListener("select", handleSelect);
    session.addEventListener("end", handleEnd);
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
  acquireVirtualRenderer
}: CaptureFrameOptions): Promise<CaptureResult> {
  const previousVisibility = hiddenObjects.map((object) => object.visible);

  hiddenObjects.forEach((object) => {
    object.visible = false;
  });

  renderer.render(scene, camera);

  try {
    const gl = renderer.getContext();
    const { image: cameraImage, failureReason } = readRawCameraImage(
      frame,
      referenceSpace,
      xrWebGLBinding,
      gl
    );

    if (!cameraImage) {
      throw createCaptureError(failureReason ?? "Camera texture unavailable");
    }

    const virtualImage = renderVirtualSceneImage(
      acquireVirtualRenderer,
      scene,
      getCurrentXRCaptureCamera(renderer, camera),
      cameraImage.width,
      cameraImage.height
    );

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

function placeMascotAtHit(mascotRoot: Group, hitMatrix: Float32Array) {
  mascotRoot.matrix.fromArray(hitMatrix);
  markObjectMatrixDirty(mascotRoot);
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

const SURFACE_PATCH_SIZE_METERS = 1.2;
const SURFACE_PATCH_DIVISIONS = 6;
const SURFACE_SAMPLE_DISTANCE_METERS = 0.28;
const SURFACE_PATTERN_HOLD_MS = 1000;
const SURFACE_PATTERN_FADE_MS = 500;
const CAMERA_READBACK_PROBE_FRAME_LIMIT = 90;
const CAMERA_READY_FRAME_THRESHOLD = 4;
const CAPTURE_RETRY_FRAME_LIMIT = 45;
const CAPTURE_FAILURE_REASONS: readonly CaptureFailureReason[] = [
  "Camera view missing",
  "Camera texture unavailable",
  "Camera framebuffer unavailable",
  "Camera framebuffer incomplete",
  "Camera pixel read failed",
  "Camera image was blank",
  "Capture image encoding failed"
];

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
