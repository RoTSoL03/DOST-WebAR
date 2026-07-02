import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction
} from "react";
import {
  AmbientLight,
  AnimationMixer,
  Box3,
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
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Material
} from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { MascotId, MascotManifestEntry } from "../config/mascots";
import { useSessionStore } from "../state/sessionStore";

interface ImageTrackingSessionProps {
  mascots: readonly MascotManifestEntry[];
  imageTargetSrc: string;
  onEnd: () => void;
  onError: (message: string) => void;
}

type CaptureStatus = "idle" | "capturing" | "ready" | "failed";

interface ImageTrackingMascotRuntime {
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

interface MindARAnchor {
  group: Group;
  onTargetFound: (() => void) | null;
  onTargetLost: (() => void) | null;
}

interface MindARThreeInstance {
  scene: Scene;
  camera: Camera;
  renderer: WebGLRenderer;
  cssRenderer?: {
    domElement: HTMLElement;
    render: (scene: unknown, camera: unknown) => void;
  };
  cssScene?: unknown;
  video?: HTMLVideoElement;
  start: () => Promise<void>;
  stop: () => void;
  addAnchor: (targetIndex: number) => MindARAnchor;
}

interface MindARThreeModule {
  MindARThree: new (options: {
    container: HTMLElement;
    imageTargetSrc: string;
    maxTrack?: number;
    uiLoading?: "yes" | "no";
    uiScanning?: "yes" | "no";
    uiError?: "yes" | "no";
    filterMinCF?: number;
    filterBeta?: number;
    warmupTolerance?: number;
    missTolerance?: number;
  }) => MindARThreeInstance;
}

type MascotButtonStyle = CSSProperties & {
  "--mascot-accent": string;
};

export function ImageTrackingSession({
  mascots,
  imageTargetSrc,
  onEnd,
  onError
}: ImageTrackingSessionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeMascotId, setActiveMascotId] = useState<MascotId>(() => getInitialMascotId(mascots));
  const [loadedMascotIds, setLoadedMascotIds] = useState<MascotId[]>([]);
  const [placedMascotIds, setPlacedMascotIds] = useState<MascotId[]>([]);
  const [targetVisible, setTargetVisible] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const activeMascotIdRef = useRef<MascotId>(getInitialMascotId(mascots));
  const placedMascotIdsRef = useRef<MascotId[]>([]);
  const targetVisibleRef = useRef(false);
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
    targetVisibleRef.current = targetVisible;
  }, [targetVisible]);

  useEffect(() => {
    return () => {
      if (capturedPhoto) {
        URL.revokeObjectURL(capturedPhoto.url);
      }
    };
  }, [capturedPhoto]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const viewport = container;
    let disposed = false;
    let mindarThree: MindARThreeInstance | null = null;
    let captureInProgress = false;
    let previousFrameTime = performance.now();
    const mascotRuntimes = new Map<MascotId, ImageTrackingMascotRuntime>();
    const targetGuide = createTargetGuide();
    const hitPlane = createHitPlane();
    const raycaster = new Raycaster();
    const pointer = new Vector2();

    async function startImageTracking() {
      try {
        const { MindARThree } = await loadMindARThree();

        if (disposed) {
          return;
        }

        mindarThree = new MindARThree({
          container: viewport,
          imageTargetSrc,
          maxTrack: 1,
          uiLoading: "no",
          uiScanning: "no",
          uiError: "no",
          filterMinCF: 0.0001,
          filterBeta: 0.001,
          warmupTolerance: 3,
          missTolerance: 8
        });

        mindarThree.scene.add(new AmbientLight(0xffffff, 1.55));

        const keyLight = new DirectionalLight(0xffffff, 2.1);
        keyLight.position.set(1.5, 3, 3);
        mindarThree.scene.add(keyLight);

        const anchor = mindarThree.addAnchor(0);
        anchor.group.add(hitPlane, targetGuide);
        anchor.onTargetFound = () => {
          targetVisibleRef.current = true;
          setTargetVisible(true);
          enterPlacement();
        };
        anchor.onTargetLost = () => {
          targetVisibleRef.current = false;
          setTargetVisible(false);
        };

        mascots.forEach((manifestEntry) => {
          const root = new Group();
          const model = new Group();
          root.visible = false;
          root.add(model);
          anchor.group.add(root);
          mascotRuntimes.set(manifestEntry.id, {
            mascot: manifestEntry,
            root,
            model,
            mixer: null,
            loaded: false,
            placed: false
          });
        });

        await loadMascotModels(mascots, mascotRuntimes, () => disposed, setLoadedMascotIds);

        if (disposed) {
          return;
        }

        await mindarThree.start();

        if (disposed) {
          mindarThree.stop();
          return;
        }

        styleMindARLayers(viewport, mindarThree);
        enterPlacement();
        captureStillRef.current = () => {
          if (!mindarThree) {
            return;
          }
          captureStill(mindarThree);
        };
        removePlacedMascotRef.current = removePlacedMascot;

        mindarThree.renderer.setAnimationLoop((frameTime) => {
          if (!mindarThree || disposed) {
            return;
          }

          const delta = (frameTime - previousFrameTime) / 1000;
          previousFrameTime = frameTime;
          mascotRuntimes.forEach((runtime) => runtime.mixer?.update(delta));
          mindarThree.renderer.render(mindarThree.scene, mindarThree.camera);
          mindarThree.cssRenderer?.render(mindarThree.cssScene, mindarThree.camera);
        });
      } catch (error) {
        if (!disposed) {
          onError(
            error instanceof Error
              ? `Image tracking failed to start. ${error.message}`
              : "Image tracking failed to start."
          );
        }
      }
    }

    const placeSelectedMascot = (event: PointerEvent) => {
      if (!mindarThree || !targetVisibleRef.current) {
        return;
      }

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
      placeMascotAtMarkerPoint(
        runtime.root,
        getMarkerPointFromPointer(event, viewport, mindarThree.camera, hitPlane, raycaster, pointer)
      );
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

    const captureStill = (runtime: MindARThreeInstance) => {
      const video = getMindARVideo(viewport, runtime);
      const overlayCanvas = runtime.renderer.domElement;

      if (
        captureInProgress ||
        !video ||
        placedMascotIdsRef.current.length === 0 ||
        !targetVisibleRef.current
      ) {
        return;
      }

      captureInProgress = true;
      setCaptureStatus("capturing");
      const previousGuideVisibility = targetGuide.visible;
      targetGuide.visible = false;
      runtime.renderer.render(runtime.scene, runtime.camera);
      runtime.renderer.getContext().flush();

      void captureImageTrackingComposite(video, overlayCanvas)
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
          targetGuide.visible = previousGuideVisibility;
          captureInProgress = false;
        });
    };

    viewport.addEventListener("pointerdown", placeSelectedMascot);
    void startImageTracking();

    return () => {
      disposed = true;
      captureStillRef.current = () => undefined;
      removePlacedMascotRef.current = () => undefined;
      viewport.removeEventListener("pointerdown", placeSelectedMascot);

      try {
        mindarThree?.renderer.setAnimationLoop(null);
        mindarThree?.stop();
      } catch {
        // MindAR may already have released camera resources during teardown.
      }

      disposeObjectResources(targetGuide);
      disposeObjectResources(hitPlane);
      mascotRuntimes.forEach((runtime) => disposeObjectResources(runtime.root));
      mindarThree?.renderer.dispose();
      viewport.replaceChildren();
    };
  }, [enterPlacement, imageTargetSrc, markMascotPlaced, mascots, onError]);

  return (
    <section className="image-tracking-session" data-testid="image-tracking-session">
      <div ref={containerRef} className="image-tracking-viewport" />
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
                <small>{getMascotButtonStatus(isLoaded, isPlaced, isActive, targetVisible)}</small>
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
              placedMascotIds.length === 0 ||
              !targetVisible
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

async function loadMindARThree() {
  return (await import("../vendor/mindar-image-three.prod.js")) as MindARThreeModule;
}

async function loadMascotModels(
  mascots: readonly MascotManifestEntry[],
  mascotRuntimes: Map<MascotId, ImageTrackingMascotRuntime>,
  isDisposed: () => boolean,
  setLoadedMascotIds: Dispatch<SetStateAction<MascotId[]>>
) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

  await Promise.all(
    mascots.map(async (manifestEntry) => {
      const runtime = mascotRuntimes.get(manifestEntry.id);

      if (!runtime) {
        return;
      }

      const gltf = await loader.loadAsync(manifestEntry.modelUrl);

      if (isDisposed()) {
        disposeObjectResources(gltf.scene);
        return;
      }

      runtime.model.add(gltf.scene);
      alignModelBottomToFloor(runtime.model, manifestEntry, IMAGE_TRACKING_MODEL_TARGET_HEIGHT);
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
}

function getMascotButtonStatus(
  isLoaded: boolean,
  isPlaced: boolean,
  isActive: boolean,
  targetVisible: boolean
) {
  if (isPlaced) {
    return "Move";
  }
  if (!isLoaded) {
    return "Loading";
  }
  if (!targetVisible) {
    return "Scan target";
  }
  return isActive ? "Tap target" : "Select";
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

function createTargetGuide() {
  const guide = new Group();
  const fill = new Mesh(
    new PlaneGeometry(IMAGE_TARGET_WIDTH, IMAGE_TARGET_HEIGHT),
    new MeshBasicMaterial({
      color: 0x35f3cf,
      side: DoubleSide,
      transparent: true,
      opacity: 0.12,
      depthWrite: false
    })
  );
  const grid = new LineSegments(
    createTargetGridGeometry(IMAGE_TARGET_WIDTH, IMAGE_TARGET_HEIGHT, 6),
    new LineBasicMaterial({
      color: 0xf9f871,
      transparent: true,
      opacity: 0.58,
      depthWrite: false
    })
  );

  guide.add(fill, grid);

  return guide;
}

function createHitPlane() {
  const plane = new Mesh(
    new PlaneGeometry(IMAGE_TARGET_WIDTH, IMAGE_TARGET_HEIGHT),
    new MeshBasicMaterial({
      color: 0xffffff,
      side: DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false
    })
  );

  plane.renderOrder = -1;

  return plane;
}

function getMarkerPointFromPointer(
  event: PointerEvent,
  container: HTMLElement,
  camera: Camera,
  hitPlane: Mesh,
  raycaster: Raycaster,
  pointer: Vector2
) {
  const rect = container.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);
  hitPlane.updateMatrixWorld(true);
  const hit = raycaster.intersectObject(hitPlane, false)[0];

  if (!hit) {
    return getNextFallbackMarkerPoint();
  }

  const localPoint = hitPlane.worldToLocal(hit.point.clone());

  return {
    x: clamp(localPoint.x, -IMAGE_TARGET_WIDTH / 2, IMAGE_TARGET_WIDTH / 2),
    y: clamp(localPoint.y, -IMAGE_TARGET_HEIGHT / 2, IMAGE_TARGET_HEIGHT / 2)
  };
}

let fallbackPlacementIndex = 0;

function getNextFallbackMarkerPoint() {
  const point = FALLBACK_MARKER_POINTS[fallbackPlacementIndex % FALLBACK_MARKER_POINTS.length]!;
  fallbackPlacementIndex += 1;

  return point;
}

function placeMascotAtMarkerPoint(mascotRoot: Group, point: { x: number; y: number }) {
  mascotRoot.position.set(point.x, point.y, IMAGE_TRACKING_MODEL_DEPTH_OFFSET);
  mascotRoot.rotation.set(0, 0, 0);
  mascotRoot.updateMatrixWorld(true);
}

async function captureImageTrackingComposite(
  video: HTMLVideoElement,
  overlayCanvas: HTMLCanvasElement
) {
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

function getMindARVideo(container: HTMLElement, mindarThree: MindARThreeInstance) {
  return mindarThree.video ?? container.querySelector("video");
}

function styleMindARLayers(container: HTMLElement, mindarThree: MindARThreeInstance) {
  const video = getMindARVideo(container, mindarThree);

  if (video) {
    video.className = "image-tracking-video";
    video.style.zIndex = "0";
  }

  mindarThree.renderer.domElement.className = "image-tracking-canvas";
  mindarThree.renderer.domElement.style.zIndex = "1";

  if (mindarThree.cssRenderer?.domElement) {
    mindarThree.cssRenderer.domElement.style.zIndex = "1";
    mindarThree.cssRenderer.domElement.style.pointerEvents = "none";
  }
}

function createTargetGridGeometry(width: number, height: number, divisions: number) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const positions: number[] = [];

  for (let index = 0; index <= divisions; index += 1) {
    const x = -halfWidth + (width * index) / divisions;
    const y = -halfHeight + (height * index) / divisions;
    positions.push(x, -halfHeight, 0, x, halfHeight, 0);
    positions.push(-halfWidth, y, 0, halfWidth, y, 0);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

  return geometry;
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

const IMAGE_TARGET_WIDTH = 1;
const IMAGE_TARGET_HEIGHT = 0.552;
const IMAGE_TRACKING_MODEL_TARGET_HEIGHT = 0.24;
const IMAGE_TRACKING_MODEL_DEPTH_OFFSET = 0.08;
const MASCOT_FORWARD_YAW_OFFSET = -Math.PI / 2;
const FALLBACK_MARKER_POINTS = [
  { x: -0.26, y: 0.1 },
  { x: 0.26, y: 0.1 },
  { x: -0.18, y: -0.16 },
  { x: 0.18, y: -0.16 }
];
