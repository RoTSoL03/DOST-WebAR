import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  AmbientLight,
  AnimationMixer,
  Box3,
  BufferGeometry,
  CircleGeometry,
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
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Material
} from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { MascotId, MascotManifestEntry } from "../config/mascots";
import { useSessionStore } from "../state/sessionStore";

interface WebXRSessionProps {
  mascots: readonly MascotManifestEntry[];
  domOverlayRoot: HTMLElement | null;
  session: XRSession;
  onEnd: () => void;
  onError: (message: string) => void;
}

type WebXRStatus = "loading" | "scanning" | "surface-found" | "placed" | "error";
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

interface ScannerStats {
  xrSessionStarted: boolean;
  referenceSpaceType: PlacementReferenceSpaceType | "pending";
  hitTestSourceReady: boolean;
  frameCount: number;
  hitFrameCount: number;
  patchCount: number;
  loadedCount: number;
  placedCount: number;
}

const initialScannerStats: ScannerStats = {
  xrSessionStarted: false,
  referenceSpaceType: "pending",
  hitTestSourceReady: false,
  frameCount: 0,
  hitFrameCount: 0,
  patchCount: 0,
  loadedCount: 0,
  placedCount: 0
};

interface MascotRuntime {
  mascot: MascotManifestEntry;
  root: Group;
  model: Group;
  mixer: AnimationMixer | null;
  loaded: boolean;
  placed: boolean;
}

interface CapturedPhoto {
  blob: Blob;
  fileName: string;
  url: string;
}

interface CaptureFrameOptions {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  hiddenObjects: Object3D[];
  frame?: XRFrame;
  referenceSpace: XRReferenceSpace | null;
  xrWebGLBinding: XRWebGLBindingCameraAccess | null;
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

type MascotButtonStyle = CSSProperties & {
  "--mascot-accent": string;
};

export function WebXRSession({
  mascots,
  domOverlayRoot,
  session,
  onEnd,
  onError
}: WebXRSessionProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [, setStatus] = useState<WebXRStatus>("loading");
  const [, setReticleAvailable] = useState(false);
  const [scannerStats, setScannerStats] = useState<ScannerStats>(initialScannerStats);
  const [activeMascotId, setActiveMascotId] = useState<MascotId>(() => getInitialMascotId(mascots));
  const [loadedMascotIds, setLoadedMascotIds] = useState<MascotId[]>([]);
  const [placedMascotIds, setPlacedMascotIds] = useState<MascotId[]>([]);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [cameraCaptureState, setCameraCaptureState] =
    useState<CameraCaptureState>("checking");
  const [captureFailureReason, setCaptureFailureReason] = useState<CaptureFailureReason | null>(
    null
  );
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const activeMascotIdRef = useRef<MascotId>(getInitialMascotId(mascots));
  const placedMascotIdsRef = useRef<MascotId[]>([]);
  const captureStillRef = useRef<() => void>(() => undefined);
  const removePlacedMascotRef = useRef<(mascotId: MascotId) => void>(() => undefined);
  const enterPlacement = useSessionStore((state) => state.enterPlacement);
  const markMascotPlaced = useSessionStore((state) => state.markMascotPlaced);

  useEffect(() => {
    activeMascotIdRef.current = activeMascotId;
  }, [activeMascotId]);

  useEffect(() => {
    placedMascotIdsRef.current = placedMascotIds;
  }, [placedMascotIds]);

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
    let disposed = false;
    let sessionEnded = false;
    let renderer: WebGLRenderer | null = null;
    let hitTestSource: XRHitTestSource | null = null;
    let placementReferenceSpace: XRReferenceSpace | null = null;
    let lastReticleAvailable = false;
    let lastSurfaceStatus: "scanning" | "surface-found" = "scanning";
    let lastSurfaceSampleTime = 0;
    let lastStatsUpdateTime = 0;
    let previousFrameTime = performance.now();
    let frameCount = 0;
    let hitFrameCount = 0;
    let referenceSpaceType: PlacementReferenceSpaceType = "local";
    let loadedCount = 0;
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
    const surfacePreview = createSurfacePatch(0.28, 0.85);
    const scannedSurfaces = new Group();

    async function startWebXR() {
      let startupStep = "creating renderer";

      try {
        const glContext = createXRCompatibleWebGL2Context(xrCanvas);

        if (!glContext) {
          throw new Error("WebGL context creation failed.");
        }

        renderer = new WebGLRenderer({
          canvas: xrCanvas,
          context: glContext as unknown as WebGLRenderingContext,
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true
        });
        renderer.xr.enabled = true;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(window.innerWidth, window.innerHeight, false);

        scene.add(new AmbientLight(0xffffff, 1.5));

        const keyLight = new DirectionalLight(0xffffff, 2);
        keyLight.position.set(2, 4, 2);
        scene.add(keyLight);

        mascots.forEach((manifestEntry) => {
          const root = new Group();
          const model = new Group();
          root.visible = false;
          root.matrixAutoUpdate = false;
          root.add(model);
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
        const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

        await Promise.all(
          mascots.map(async (manifestEntry) => {
            const runtime = mascotRuntimes.get(manifestEntry.id);

            if (!runtime) {
              return;
            }

            const gltf = await loader.loadAsync(manifestEntry.modelUrl);

            if (disposed) {
              disposeObjectResources(gltf.scene);
              return;
            }

            runtime.model.add(gltf.scene);
            alignModelBottomToFloor(
              runtime.model,
              manifestEntry,
              WEBXR_MODEL_TARGET_HEIGHT_METERS
            );
            applyMascotForwardCorrection(runtime.model);

            const firstAnimation = gltf.animations[0];

            if (firstAnimation) {
              runtime.mixer = new AnimationMixer(gltf.scene);
              runtime.mixer.clipAction(firstAnimation).play();
            }

            runtime.loaded = true;
            loadedCount += 1;
            setLoadedMascotIds((ids) =>
              ids.includes(manifestEntry.id) ? ids : [...ids, manifestEntry.id]
            );
          })
        );

        startupStep = "requesting reference space";
        referenceSpaceType = await requestPlacementReferenceSpaceType(session);
        renderer.xr.setReferenceSpaceType(referenceSpaceType);

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
        setStatus("scanning");
        lastSurfaceStatus = "scanning";
        setScannerStats({
          xrSessionStarted: true,
          referenceSpaceType,
          hitTestSourceReady: true,
          frameCount,
          hitFrameCount,
          patchCount: scannedSurfaces.children.length,
          loadedCount,
          placedCount
        });

        const updateSurfaceState = (surfaceFound: boolean) => {
          if (lastReticleAvailable !== surfaceFound) {
            lastReticleAvailable = surfaceFound;
            setReticleAvailable(surfaceFound);
          }

          const nextStatus = surfaceFound ? "surface-found" : "scanning";

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

        removePlacedMascotRef.current = (mascotId) => {
          const runtime = mascotRuntimes.get(mascotId);

          if (!runtime?.placed) {
            activeMascotIdRef.current = mascotId;
            setActiveMascotId(mascotId);
            return;
          }

          runtime.root.visible = false;
          runtime.placed = false;
          placedCount = Math.max(0, placedCount - 1);

          const nextPlacedIds = placedMascotIdsRef.current.filter((id) => id !== mascotId);
          placedMascotIdsRef.current = nextPlacedIds;
          setPlacedMascotIds(nextPlacedIds);
          activeMascotIdRef.current = mascotId;
          setActiveMascotId(mascotId);
          setStatus(reticle.visible ? "surface-found" : "scanning");
          enterPlacement();
          setScannerStats((stats) => ({
            ...stats,
            placedCount
          }));
        };

        renderer.setAnimationLoop((frameTime, frame) => {
          if (!renderer || disposed) {
            return;
          }

          const delta = (frameTime - previousFrameTime) / 1000;
          previousFrameTime = frameTime;
          mascotRuntimes.forEach((runtime) => runtime.mixer?.update(delta));
          fadeScannedSurfacePatches(scannedSurfaces, frameTime);
          frameCount += 1;

          if (frame && hitTestSource && placementReferenceSpace && placedCount < mascots.length) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            const hit = hitTestResults[0];
            const pose = hit?.getPose(placementReferenceSpace);

            if (pose) {
              hitFrameCount += 1;
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
              if (sampleScannedSurfacePatch(
                scannedSurfaces,
                pose.transform.matrix,
                frameTime,
                surfaceSamplePosition,
                lastSurfaceSamplePosition,
                lastSurfaceSampleTime
              )) {
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

          if (frameTime - lastStatsUpdateTime > SCANNER_STATS_INTERVAL_MS) {
            lastStatsUpdateTime = frameTime;
            setScannerStats({
              xrSessionStarted: true,
              referenceSpaceType,
              hitTestSourceReady: Boolean(hitTestSource),
              frameCount,
              hitFrameCount,
              patchCount: scannedSurfaces.children.length,
              loadedCount,
              placedCount
            });
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
              xrWebGLBinding
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
              error instanceof Error ? error.message : "Try Android Chrome on an ARCore-capable phone over HTTPS."
            }`
          );
        }
      }
    }

    const handleSelect = () => {
      const selectedMascotId = activeMascotIdRef.current;
      const runtime = mascotRuntimes.get(selectedMascotId);

      if (
        !runtime ||
        runtime.placed ||
        placedMascotIdsRef.current.includes(selectedMascotId) ||
        !runtime.loaded ||
        !reticle.visible
      ) {
        return;
      }

      placeMascotAtHit(runtime.root, latestHitMatrix);
      runtime.root.visible = true;
      runtime.placed = true;
      placedCount += 1;
      markMascotPlaced();
      setReticleAvailable(false);

      const nextPlacedIds = [...placedMascotIdsRef.current, selectedMascotId];
      placedMascotIdsRef.current = nextPlacedIds;
      setPlacedMascotIds(nextPlacedIds);

      const nextMascot = mascots.find((candidate) => !nextPlacedIds.includes(candidate.id));

      if (nextMascot) {
        activeMascotIdRef.current = nextMascot.id;
        setActiveMascotId(nextMascot.id);
        setStatus(reticle.visible ? "surface-found" : "scanning");
      } else {
        reticle.visible = false;
        surfacePreview.visible = false;
        setStatus("placed");
      }

      setScannerStats((stats) => ({
        ...stats,
        placedCount
      }));
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
      removePlacedMascotRef.current = () => undefined;
      session.removeEventListener("select", handleSelect);
      session.removeEventListener("end", handleEnd);
      renderer?.setAnimationLoop(null);
      hitTestSource?.cancel();
      disposeObjectResources(scene);
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

  const overlayControls = (
    <div className="webxr-overlay-controls">
      <div className="webxr-mascot-picker" aria-label="Mascots to place">
        {mascots.map((entry) => {
          const isLoaded = loadedMascotIds.includes(entry.id);
          const isPlaced = placedMascotIds.includes(entry.id);
          const isActive = activeMascotId === entry.id;

          return (
            <button
              key={entry.id}
              className="webxr-mascot-choice"
              type="button"
              aria-pressed={isActive}
              data-placed={isPlaced ? "true" : "false"}
              style={getMascotButtonStyle(entry.id)}
              disabled={!isLoaded}
              onClick={() => {
                if (isPlaced) {
                  removePlacedMascotRef.current(entry.id);
                  return;
                }

                activeMascotIdRef.current = entry.id;
                setActiveMascotId(entry.id);
              }}
            >
              <span className="webxr-mascot-avatar" aria-hidden="true">
                <img src={entry.thumbnailUrl} alt="" draggable="false" />
              </span>
              <span>{entry.displayName}</span>
              <small>{getMascotButtonStatus(isLoaded, isPlaced, isActive)}</small>
            </button>
          );
        })}
      </div>
      <div className="webxr-capture-row">
        <button
          className="webxr-capture-button"
          type="button"
          disabled={
            Boolean(capturedPhoto) ||
            captureStatus === "capturing" ||
            cameraCaptureState !== "available" ||
            scannerStats.placedCount === 0
          }
          onClick={() => captureStillRef.current()}
        >
          {getCaptureButtonLabel(captureStatus, cameraCaptureState)}
        </button>
        {cameraCaptureState === "unavailable" ? (
          <p className="webxr-capture-warning" role="status">
            Browser camera capture is unavailable in this WebXR session.
          </p>
        ) : null}
        {captureStatus === "failed" && captureFailureReason ? (
          <p className="webxr-capture-warning" role="status">
            {captureFailureReason}
          </p>
        ) : null}
      </div>
      {capturedPhoto ? (
        <div className="webxr-capture-preview" role="dialog" aria-label="Captured photo preview">
          <div className="webxr-capture-preview-frame">
            <img src={capturedPhoto.url} alt="Captured AR frame preview" />
          </div>
          <div className="webxr-capture-actions">
            <button
              className="webxr-download-button"
              type="button"
              onClick={() => downloadCapturedPhoto(capturedPhoto)}
            >
              Download
            </button>
            <button
              className="webxr-retake-button"
              type="button"
              onClick={() => {
                setCapturedPhoto(null);
                setCaptureStatus("idle");
              }}
            >
              Retake
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="webxr-session" data-testid="webxr-session">
      <canvas
        ref={canvasRef}
        className="webxr-canvas"
        aria-label="WebXR surface scanner"
      />
      {domOverlayRoot ? createPortal(overlayControls, domOverlayRoot) : overlayControls}
    </section>
  );
}

function getMascotButtonStatus(isLoaded: boolean, isPlaced: boolean, isActive: boolean) {
  if (isPlaced) {
    return "Move";
  }
  if (!isLoaded) {
    return "Loading";
  }
  return isActive ? "Tap floor" : "Select";
}

function getMascotButtonStyle(mascotId: MascotId): MascotButtonStyle {
  return {
    "--mascot-accent": getMascotAccentColor(mascotId)
  } as MascotButtonStyle;
}

function getMascotAccentColor(mascotId: MascotId) {
  switch (mascotId) {
    case "mascot-alpha":
      return "#ff8a1c";
    case "mascot-amihan":
      return "#62cfff";
    case "mascot-ulan":
      return "#1d4ed8";
    case "mascot-apoy":
      return "#ef4444";
  }
}

function getCaptureButtonLabel(captureStatus: CaptureStatus, cameraCaptureState: CameraCaptureState) {
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

function createReticle() {
  const reticle = new Group();
  const platformGeometry = new CircleGeometry(0.38, 64).rotateX(-Math.PI / 2);
  const platformMaterial = new MeshBasicMaterial({
    color: 0x8ee4d1,
    side: DoubleSide,
    transparent: true,
    opacity: 0.34,
    depthTest: false,
    depthWrite: false
  });
  const platform = new Mesh(platformGeometry, platformMaterial);
  const geometry = new RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({
    color: 0xffdf6e,
    side: DoubleSide,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false
  });
  const ring = new Mesh(geometry, material);
  reticle.add(platform, ring);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;

  return reticle;
}

function createSurfacePatch(fillOpacity: number, lineOpacity: number) {
  const patch = new Group();
  const fillGeometry = new PlaneGeometry(SURFACE_PATCH_SIZE_METERS, SURFACE_PATCH_SIZE_METERS).rotateX(
    -Math.PI / 2
  );
  const fillMaterial = new MeshBasicMaterial({
    color: 0x35f3cf,
    side: DoubleSide,
    transparent: true,
    opacity: fillOpacity,
    depthTest: false,
    depthWrite: false
  });
  const fill = new Mesh(fillGeometry, fillMaterial);
  const grid = new LineSegments(
    createSurfaceGridGeometry(SURFACE_PATCH_SIZE_METERS, SURFACE_PATCH_DIVISIONS),
    new LineBasicMaterial({
      color: 0xf9f871,
      transparent: true,
      opacity: lineOpacity,
      depthTest: false,
      depthWrite: false
    })
  );
  grid.position.y = 0.004;
  patch.add(fill, grid);
  patch.matrixAutoUpdate = false;
  patch.userData.fillOpacity = fillOpacity;
  patch.userData.lineOpacity = lineOpacity;

  return patch;
}

function sampleScannedSurfacePatch(
  scannedSurfaces: Group,
  matrix: Float32Array,
  frameTime: number,
  samplePosition: Vector3,
  lastSamplePosition: Vector3,
  lastSampleTime: number
): boolean {
  samplePosition.set(matrix[12] ?? 0, matrix[13] ?? 0, matrix[14] ?? 0);

  if (
    frameTime - lastSampleTime < SURFACE_SAMPLE_INTERVAL_MS ||
    samplePosition.distanceTo(lastSamplePosition) < SURFACE_SAMPLE_DISTANCE_METERS
  ) {
    return false;
  }

  const patch = createSurfacePatch(0.14, 0.52);
  patch.matrix.fromArray(matrix);
  patch.userData.createdAt = frameTime;
  markObjectMatrixDirty(patch);
  scannedSurfaces.add(patch);
  lastSamplePosition.copy(samplePosition);

  while (scannedSurfaces.children.length > MAX_SCANNED_SURFACE_PATCHES) {
    const oldestPatch = scannedSurfaces.children[0];
    if (!oldestPatch) {
      break;
    }

    scannedSurfaces.remove(oldestPatch);
    disposeObjectResources(oldestPatch);
  }

  return true;
}

function updateSurfacePatchFade(patch: Group, ageMs: number) {
  const opacityScale = getSurfacePatternOpacityScale(ageMs);
  setSurfacePatchOpacity(patch, opacityScale);
  patch.visible = opacityScale > 0;
}

function fadeScannedSurfacePatches(scannedSurfaces: Group, frameTime: number) {
  [...scannedSurfaces.children].forEach((patch) => {
    const createdAt = typeof patch.userData.createdAt === "number" ? patch.userData.createdAt : 0;
    const ageMs = frameTime - createdAt;
    const opacityScale = getSurfacePatternOpacityScale(ageMs);

    if (opacityScale <= 0) {
      scannedSurfaces.remove(patch);
      disposeObjectResources(patch);
      return;
    }

    setSurfacePatchOpacity(patch, opacityScale);
  });
}

function getSurfacePatternOpacityScale(ageMs: number) {
  if (ageMs <= SURFACE_PATTERN_HOLD_MS) {
    return 1;
  }

  const fadeProgress = (ageMs - SURFACE_PATTERN_HOLD_MS) / SURFACE_PATTERN_FADE_MS;
  return Math.max(0, 1 - fadeProgress);
}

function setSurfacePatchOpacity(patch: Object3D, opacityScale: number) {
  const fillOpacity =
    typeof patch.userData.fillOpacity === "number" ? patch.userData.fillOpacity : 0.14;
  const lineOpacity =
    typeof patch.userData.lineOpacity === "number" ? patch.userData.lineOpacity : 0.52;
  let materialIndex = 0;

  patch.traverse((child) => {
    const mesh = child as Mesh | LineSegments;
    const material = mesh.material;

    if (!material || Array.isArray(material)) {
      return;
    }

    material.opacity = (materialIndex === 0 ? fillOpacity : lineOpacity) * opacityScale;
    material.transparent = true;
    material.needsUpdate = true;
    materialIndex += 1;
  });
}

async function captureCleanFrame({
  renderer,
  scene,
  camera,
  hiddenObjects,
  frame,
  referenceSpace,
  xrWebGLBinding
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

function createXRCompatibleWebGL2Context(canvas: HTMLCanvasElement) {
  const attributes: WebGLContextAttributes & { xrCompatible: boolean } = {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
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
  scene: Scene,
  camera: Camera,
  width: number,
  height: number
): ReadableFrameImage | null {
  const canvas = document.createElement("canvas");
  const glContext = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true
  });

  if (!glContext) {
    return null;
  }

  const virtualRenderer = new WebGLRenderer({
    canvas,
    context: glContext as unknown as WebGLRenderingContext,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true
  });

  try {
    virtualRenderer.xr.enabled = false;
    virtualRenderer.setPixelRatio(1);
    virtualRenderer.setSize(width, height, false);
    virtualRenderer.setClearColor(0x000000, 0);
    virtualRenderer.clear(true, true, true);
    virtualRenderer.render(scene, camera);

    return readCurrentFramebufferImage(virtualRenderer.getContext(), canvas);
  } finally {
    virtualRenderer.dispose();
  }
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
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      cameraTexture,
      0
    );

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

function get2DContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("2D canvas is unavailable.");
  }

  return context;
}

function createCaptureError(reason: CaptureFailureReason) {
  const error = new Error(reason);
  error.name = "CaptureFailure";

  return error;
}

function getCaptureFailureReason(error: unknown): CaptureFailureReason {
  if (
    error instanceof Error &&
    isCaptureFailureReason(error.message)
  ) {
    return error.message;
  }

  return "Capture image encoding failed";
}

function isCaptureFailureReason(reason: string): reason is CaptureFailureReason {
  return CAPTURE_FAILURE_REASONS.includes(reason as CaptureFailureReason);
}

function shouldRetryCapture(reason: CaptureFailureReason, attemptCount: number) {
  return (
    attemptCount < CAPTURE_RETRY_FRAME_LIMIT &&
    reason !== "Capture image encoding failed"
  );
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("Canvas capture failed."));
    }, "image/png");
  });
}

function downloadCapturedPhoto(photo: CapturedPhoto) {
  const link = document.createElement("a");
  link.href = photo.url;
  link.download = photo.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function createCaptureFileName() {
  return `dost-webar-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
}

function placeMascotAtHit(mascotRoot: Group, hitMatrix: Float32Array) {
  mascotRoot.matrix.fromArray(hitMatrix);
  markObjectMatrixDirty(mascotRoot);
}

function alignModelBottomToFloor(root: Group, mascot: MascotManifestEntry, targetHeight: number) {
  root.position.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);

  const bounds = new Box3().setFromObject(root);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const largestAxis = Math.max(size.x, size.y, size.z, 1);
  const normalizedScale = (targetHeight / largestAxis) * mascot.defaultScale;

  root.scale.setScalar(normalizedScale);
  root.position.set(
    -center.x * normalizedScale,
    -bounds.min.y * normalizedScale + mascot.defaultVerticalOffset,
    -center.z * normalizedScale
  );
}

function applyMascotForwardCorrection(root: Group) {
  root.rotation.y = MASCOT_FORWARD_YAW_OFFSET;
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
const SURFACE_SAMPLE_INTERVAL_MS = 220;
const SURFACE_SAMPLE_DISTANCE_METERS = 0.28;
const MAX_SCANNED_SURFACE_PATCHES = 16;
const SURFACE_PATTERN_HOLD_MS = 1000;
const SURFACE_PATTERN_FADE_MS = 500;
const SCANNER_STATS_INTERVAL_MS = 450;
const CAMERA_READBACK_PROBE_FRAME_LIMIT = 90;
const CAMERA_READY_FRAME_THRESHOLD = 4;
const CAPTURE_RETRY_FRAME_LIMIT = 45;
const WEBXR_MODEL_TARGET_HEIGHT_METERS = 1.4;
const MASCOT_FORWARD_YAW_OFFSET = -Math.PI / 2;
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

function disposeObjectResources(object: Object3D) {
  object.traverse((child: Object3D) => {
    const mesh = child as Mesh;
    mesh.geometry?.dispose();

    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(disposeMaterial);
    } else if (mesh.material) {
      disposeMaterial(mesh.material);
    }
  });
}

function disposeMaterial(material: Material) {
  material.dispose();
}
