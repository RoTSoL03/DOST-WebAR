import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  AmbientLight,
  AnimationMixer,
  Box3,
  DirectionalLight,
  Group,
  Mesh,
  Object3D,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material
} from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { MascotId, MascotManifestEntry } from "../config/mascots";
import { useSessionStore } from "../state/sessionStore";

interface CameraARSessionProps {
  mascots: readonly MascotManifestEntry[];
  stream: MediaStream;
  onEnd: () => void;
}

type CameraSessionStatus = "loading" | "ready" | "error";
type CaptureStatus = "idle" | "capturing" | "ready" | "failed";

interface CameraMascotRuntime {
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

interface WorldPoint {
  x: number;
  y: number;
}

type MascotButtonStyle = CSSProperties & {
  "--mascot-accent": string;
};

export function CameraARSession({ mascots, stream, onEnd }: CameraARSessionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<CameraSessionStatus>("loading");
  const [activeMascotId, setActiveMascotId] = useState<MascotId>(() => getInitialMascotId(mascots));
  const [loadedMascotIds, setLoadedMascotIds] = useState<MascotId[]>([]);
  const [placedMascotIds, setPlacedMascotIds] = useState<MascotId[]>([]);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
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
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.srcObject = stream;
    video.muted = true;
    video.setAttribute("playsinline", "true");

    const startVideo = async () => {
      try {
        await waitForVideoMetadata(video);
        await video.play();
      } catch {
        setStatus("error");
      }
    };

    void startVideo();

    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const glContext = createTransparentWebGL2Context(canvas);

    if (!glContext) {
      setStatus("error");
      return;
    }

    let disposed = false;
    let captureInProgress = false;
    let previousFrameTime = performance.now();
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    const renderer = new WebGLRenderer({
      canvas,
      context: glContext as unknown as WebGLRenderingContext,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true
    });
    const mascotRuntimes = new Map<MascotId, CameraMascotRuntime>();

    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;

    scene.add(new AmbientLight(0xffffff, 1.6));

    const keyLight = new DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(2, 4, 4);
    scene.add(keyLight);

    mascots.forEach((manifestEntry) => {
      const root = new Group();
      const model = new Group();
      root.visible = false;
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

    const resizeRenderer = () => {
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      const aspect = width / height;

      camera.left = -aspect;
      camera.right = aspect;
      camera.top = 1;
      camera.bottom = -1;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const placeSelectedMascot = (event: PointerEvent) => {
      const runtime = mascotRuntimes.get(activeMascotIdRef.current);

      if (
        !runtime ||
        runtime.placed ||
        placedMascotIdsRef.current.includes(runtime.mascot.id) ||
        !runtime.loaded
      ) {
        return;
      }

      event.preventDefault();
      placeMascotAtCameraPoint(runtime.root, getCameraWorldPoint(event, canvas, camera));
      runtime.root.visible = true;
      runtime.placed = true;
      markMascotPlaced();

      const nextPlacedIds = [...placedMascotIdsRef.current, runtime.mascot.id];
      placedMascotIdsRef.current = nextPlacedIds;
      setPlacedMascotIds(nextPlacedIds);

      const nextMascot = mascots.find((candidate) => !nextPlacedIds.includes(candidate.id));

      if (nextMascot) {
        activeMascotIdRef.current = nextMascot.id;
        setActiveMascotId(nextMascot.id);
      }
    };

    const removePlacedMascot = (mascotId: MascotId) => {
      const runtime = mascotRuntimes.get(mascotId);

      if (!runtime?.placed) {
        activeMascotIdRef.current = mascotId;
        setActiveMascotId(mascotId);
        return;
      }

      runtime.root.visible = false;
      runtime.placed = false;

      const nextPlacedIds = placedMascotIdsRef.current.filter((id) => id !== mascotId);
      placedMascotIdsRef.current = nextPlacedIds;
      setPlacedMascotIds(nextPlacedIds);
      activeMascotIdRef.current = mascotId;
      setActiveMascotId(mascotId);
      setCaptureStatus("idle");
      enterPlacement();
    };

    const captureStill = () => {
      const video = videoRef.current;

      if (captureInProgress || !video || placedMascotIdsRef.current.length === 0) {
        return;
      }

      captureInProgress = true;
      setCaptureStatus("capturing");
      renderer.render(scene, camera);

      void captureCameraComposite(video, canvas)
        .then((blob) => {
          const fileName = createCaptureFileName();
          const url = URL.createObjectURL(blob);
          setCapturedPhoto((previousPhoto) => {
            if (previousPhoto) {
              URL.revokeObjectURL(previousPhoto.url);
            }

            return {
              blob,
              fileName,
              url
            };
          });
          setCaptureStatus("ready");
        })
        .catch(() => {
          setCaptureStatus("failed");
        })
        .finally(() => {
          captureInProgress = false;
        });
    };

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

    async function loadMascots() {
      try {
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
              CAMERA_MODEL_TARGET_HEIGHT_WORLD
            );
            applyMascotForwardCorrection(runtime.model);

            const firstAnimation = gltf.animations[0];

            if (firstAnimation) {
              runtime.mixer = new AnimationMixer(gltf.scene);
              runtime.mixer.clipAction(firstAnimation).play();
            }

            runtime.loaded = true;
            setLoadedMascotIds((ids) =>
              ids.includes(manifestEntry.id) ? ids : [...ids, manifestEntry.id]
            );
          })
        );

        if (!disposed) {
          enterPlacement();
          setStatus("ready");
        }
      } catch {
        if (!disposed) {
          setStatus("error");
        }
      }
    }

    resizeRenderer();
    window.addEventListener("resize", resizeRenderer);
    window.addEventListener("orientationchange", resizeRenderer);
    canvas.addEventListener("pointerdown", placeSelectedMascot);
    captureStillRef.current = captureStill;
    removePlacedMascotRef.current = removePlacedMascot;
    void loadMascots();

    renderer.setAnimationLoop((frameTime) => {
      if (disposed) {
        return;
      }

      const delta = (frameTime - previousFrameTime) / 1000;
      previousFrameTime = frameTime;
      mascotRuntimes.forEach((runtime) => runtime.mixer?.update(delta));
      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      captureStillRef.current = () => undefined;
      removePlacedMascotRef.current = () => undefined;
      canvas.removeEventListener("pointerdown", placeSelectedMascot);
      window.removeEventListener("resize", resizeRenderer);
      window.removeEventListener("orientationchange", resizeRenderer);
      renderer.setAnimationLoop(null);
      disposeObjectResources(scene);
      renderer.dispose();
    };
  }, [enterPlacement, markMascotPlaced, mascots]);

  return (
    <section className="camera-ar-session" data-testid="camera-ar-session" data-status={status}>
      <video
        ref={videoRef}
        className="camera-feed"
        aria-label="iOS camera AR view"
        autoPlay
        muted
        playsInline
      />
      <canvas
        ref={canvasRef}
        className="camera-model-layer"
        aria-label="Tap camera view to place selected mascot"
      />
      <div className="webxr-overlay-controls">
        <button className="camera-end-button" type="button" onClick={onEnd}>
          End
        </button>
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
              placedMascotIds.length === 0
            }
            onClick={() => captureStillRef.current()}
          >
            {getCaptureButtonLabel(captureStatus)}
          </button>
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
  return isActive ? "Tap view" : "Select";
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

function getCaptureButtonLabel(captureStatus: CaptureStatus) {
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

function createTransparentWebGL2Context(canvas: HTMLCanvasElement) {
  return canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true
  });
}

function waitForVideoMetadata(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const handleLoadedMetadata = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Camera metadata unavailable."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

function getCameraWorldPoint(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: OrthographicCamera
): WorldPoint {
  const rect = canvas.getBoundingClientRect();
  const normalizedX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
  const normalizedY = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
  const worldX = normalizedX * Math.max(Math.abs(camera.left), Math.abs(camera.right));
  const worldY = clamp(normalizedY, CAMERA_PLACEMENT_MIN_Y, CAMERA_PLACEMENT_MAX_Y);

  return {
    x: worldX,
    y: worldY
  };
}

function placeMascotAtCameraPoint(mascotRoot: Group, point: WorldPoint) {
  mascotRoot.position.set(point.x, point.y, 0);
  mascotRoot.rotation.set(0, 0, 0);
  mascotRoot.updateMatrixWorld(true);
}

async function captureCameraComposite(video: HTMLVideoElement, overlayCanvas: HTMLCanvasElement) {
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    video.videoWidth === 0 ||
    video.videoHeight === 0
  ) {
    throw new Error("Camera frame unavailable.");
  }

  const output = document.createElement("canvas");
  output.width = Math.max(1, overlayCanvas.width || video.videoWidth);
  output.height = Math.max(1, overlayCanvas.height || video.videoHeight);
  const context = get2DContext(output);

  drawCoveredVideoFrame(context, video, output.width, output.height);
  context.drawImage(overlayCanvas, 0, 0, output.width, output.height);

  return canvasToBlob(output);
}

function drawCoveredVideoFrame(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  outputWidth: number,
  outputHeight: number
) {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const scale = Math.max(outputWidth / videoWidth, outputHeight / videoHeight);
  const sourceWidth = outputWidth / scale;
  const sourceHeight = outputHeight / scale;
  const sourceX = (videoWidth - sourceWidth) / 2;
  const sourceY = (videoHeight - sourceHeight) / 2;

  context.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    outputWidth,
    outputHeight
  );
}

function get2DContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("2D canvas is unavailable.");
  }

  return context;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const CAMERA_MODEL_TARGET_HEIGHT_WORLD = 0.62;
const CAMERA_PLACEMENT_MIN_Y = -0.92;
const CAMERA_PLACEMENT_MAX_Y = 0.62;
const MASCOT_FORWARD_YAW_OFFSET = -Math.PI / 2;
