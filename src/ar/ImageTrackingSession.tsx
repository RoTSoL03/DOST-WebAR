import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  AnimationMixer,
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  WebGLRenderer
} from "three";

import type { ImageTrackingConfig, ImageTrackingTarget } from "../config/imageTargets";
import { instantiateMascotModel, warmMascotModelCache } from "../rendering/modelCache";
import { resolveQualityProfile } from "../services/deviceProfile";
import type { MindARAnchor, MindARThree } from "../vendor/mindar/mindar-image-three.prod.js";
import {
  canvasToBlob,
  createCaptureFileName,
  downloadCapturedPhoto,
  get2DContext,
  type CapturedPhoto
} from "./captureUtils";
import { SmoothedImageAnchorBinding } from "./imageTrackingAnchorBinding";
import {
  alignModelBottomToFloor,
  applyMascotForwardCorrection,
  createMascotContactShadow,
  disposeObjectResources,
  MASCOT_TARGET_HEIGHT_METERS
} from "./mascotSceneUtils";

interface ImageTrackingSessionProps {
  config: ImageTrackingConfig;
  onBack: () => void;
}

type TrackingStatus = "initializing" | "searching" | "loading-model" | "found" | "lost" | "error";
type CaptureStatus = "idle" | "capturing" | "ready" | "failed";

interface ActiveImageRuntime {
  target: ImageTrackingTarget;
  root: Group;
  standRoot: Group;
  model: Group;
  vfx: MascotVfx;
  poseBinding: SmoothedImageAnchorBinding;
  mixer: AnimationMixer | null;
  loaded: boolean;
  visible: boolean;
  hasBeenTracked: boolean;
  modelVisible: boolean;
  appearStartedAt: number | null;
  ownsModelResources: boolean;
}

interface MascotVfx {
  group: Group;
  aura: Sprite;
  auraMaterial: SpriteMaterial;
  auraTexture: CanvasTexture;
  particles: Points;
  particleMaterial: PointsMaterial;
  particleGeometry: BufferGeometry;
}

export function ImageTrackingSession({ config, onBack }: ImageTrackingSessionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mindarRef = useRef<MindARThree | null>(null);
  const activeRuntimesRef = useRef<Map<number, ActiveImageRuntime>>(new Map());
  const captureStillRef = useRef<() => void>(() => undefined);
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>("initializing");
  const [statusMessage, setStatusMessage] = useState("Starting camera...");
  const [activeTargetName, setActiveTargetName] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);

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

    const trackingContainer = container;
    let disposed = false;
    let hasTrackedTarget = false;
    let previousFrameTime = performance.now();
    let captureInProgress = false;
    const profile = resolveQualityProfile();

    const setError = (message: string) => {
      if (!disposed) {
        setTrackingStatus("error");
        setStatusMessage(message);
      }
    };

    const updateTrackingSummary = () => {
      const visibleRuntimes = getVisibleRuntimes(activeRuntimesRef.current);

      if (visibleRuntimes.length > 0) {
        setActiveTargetName(
          visibleRuntimes.map((runtime) => runtime.target.displayName).join(", ")
        );
        setTrackingStatus("found");
        setStatusMessage(visibleRuntimes.length === 1 ? "Image Found" : "Images Found");
        return;
      }

      setActiveTargetName(null);

      if (hasTrackedTarget) {
        setTrackingStatus("lost");
        setStatusMessage("Tracking Lost");
        return;
      }

      setTrackingStatus("searching");
      setStatusMessage("Searching...");
    };

    const disposeRuntime = (runtime: ActiveImageRuntime) => {
      runtime.mixer?.stopAllAction();
      if (runtime.ownsModelResources) {
        disposeObjectResources(runtime.model);
      }
      disposeMascotVfx(runtime.vfx);
      runtime.model.clear();
      runtime.root.parent?.remove(runtime.root);
      disposeObjectResources(runtime.root);
    };

    const unloadAllRuntimes = () => {
      activeRuntimesRef.current.forEach(disposeRuntime);
      activeRuntimesRef.current.clear();
      setActiveTargetName(null);
    };

    const prepareTargetRuntime = async (target: ImageTrackingTarget, anchor: MindARAnchor) => {
      setTrackingStatus("loading-model");
      setStatusMessage("Preparing AR...");
      setActiveTargetName(target.displayName);

      const root = new Group();
      const standRoot = new Group();
      const model = new Group();
      const vfx = createMascotVfx();
      root.visible = false;
      standRoot.rotation.x = IMAGE_TARGET_STAND_ROTATION_RADIANS;
      standRoot.add(createMascotContactShadow(), model);
      root.add(standRoot);
      root.add(vfx.group);
      const poseBinding = new SmoothedImageAnchorBinding(anchor.group, root);

      const runtime: ActiveImageRuntime = {
        target,
        root,
        standRoot,
        model,
        vfx,
        poseBinding,
        mixer: null,
        loaded: false,
        visible: anchor.visible,
        hasBeenTracked: false,
        modelVisible: false,
        appearStartedAt: null,
        ownsModelResources: false
      };
      activeRuntimesRef.current.set(target.targetIndex, runtime);

      try {
        const instance = await instantiateMascotModel(target.modelUrl);

        if (disposed) {
          if (activeRuntimesRef.current.get(target.targetIndex) === runtime) {
            disposeRuntime(runtime);
            activeRuntimesRef.current.delete(target.targetIndex);
          }
          return;
        }

        model.add(instance.scene);
        alignModelBottomToFloor(model, target, MASCOT_TARGET_HEIGHT_METERS);
        applyMascotForwardCorrection(model);

        const firstAnimation = instance.animations[0];

        if (firstAnimation) {
          runtime.mixer = new AnimationMixer(instance.scene);
          runtime.mixer.clipAction(firstAnimation).play();
        }

        runtime.loaded = true;
        root.visible = false;
      } catch {
        if (disposed) {
          return;
        }

        runtime.ownsModelResources = true;
        disposeRuntime(runtime);
        activeRuntimesRef.current.delete(target.targetIndex);
        throw new Error(`Model missing: ${target.model}`);
      }
    };

    const handleTargetFound = (target: ImageTrackingTarget) => {
      const runtime = activeRuntimesRef.current.get(target.targetIndex);

      if (runtime) {
        const isReacquiring = runtime.hasBeenTracked;

        hasTrackedTarget = true;
        runtime.visible = true;
        runtime.hasBeenTracked = true;

        if (isReacquiring) {
          runtime.poseBinding.beginReacquisition();
          resumeMascotAfterReacquisition(runtime);
        } else {
          startMascotAppear(runtime, performance.now());
        }

        updateTrackingSummary();
        return;
      }
    };

    const handleTargetLost = (target: ImageTrackingTarget) => {
      const runtime = activeRuntimesRef.current.get(target.targetIndex);

      if (!runtime) {
        return;
      }

      runtime.visible = false;
      hideMascotAfterTrackingLoss(runtime);
      updateTrackingSummary();
    };

    const captureStill = () => {
      const mindar = mindarRef.current;
      const video = mindar?.video;
      const renderer = mindar?.renderer;
      const visibleRuntimes = getVisibleRuntimes(activeRuntimesRef.current);

      if (captureInProgress || !video || !renderer || visibleRuntimes.length === 0) {
        return;
      }

      captureInProgress = true;
      setCaptureStatus("capturing");
      renderer.render(mindar.scene, mindar.camera);

      void captureCameraComposite(video, renderer.domElement)
        .then((blob) => {
          const fileName = createCaptureFileName();
          const url = URL.createObjectURL(blob);
          setCapturedPhoto((previousPhoto) => {
            if (previousPhoto) {
              URL.revokeObjectURL(previousPhoto.url);
            }

            return { blob, fileName, url };
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

    async function startImageTracking() {
      if (!window.isSecureContext) {
        setError("Image Tracking requires HTTPS on phones. Open the HTTPS LAN URL.");
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser does not expose camera access.");
        return;
      }

      if (config.targets.length === 0) {
        setError("No image targets are configured.");
        return;
      }

      setStatusMessage("Preparing models...");
      const modelWarmup = warmMascotModelCache(config.targets.map((target) => target.modelUrl));
      const databaseAvailable = await isTargetDatabaseAvailable(config.databaseUrl);

      if (!databaseAvailable) {
        setError(`No tracking database found at ${config.databaseUrl}.`);
        return;
      }

      await modelWarmup;

      if (disposed) {
        return;
      }

      try {
        setStatusMessage("Requesting camera permission...");
        const permissionStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } }
        });
        permissionStream.getTracks().forEach((track) => track.stop());
      } catch {
        setError("Camera permission was denied or the camera could not start.");
        return;
      }

      try {
        const { MindARThree: MindARThreeRuntime } =
          await import("../vendor/mindar/mindar-image-three.prod.js");

        if (disposed) {
          return;
        }

        const mindar = new MindARThreeRuntime({
          container: trackingContainer,
          imageTargetSrc: config.databaseUrl,
          maxTrack: Math.min(MAX_SIMULTANEOUS_IMAGE_TARGETS, config.targets.length),
          uiLoading: "no",
          uiScanning: "no",
          uiError: "no",
          filterMinCF: TRACKING_FILTER_MIN_CUTOFF,
          filterBeta: TRACKING_FILTER_BETA,
          warmupTolerance: TRACKING_WARMUP_TOLERANCE,
          missTolerance: TRACKING_MISS_TOLERANCE
        });
        mindarRef.current = mindar;
        mindar.renderer.setPixelRatio(
          Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio)
        );
        mindar.renderer.setClearColor(0x000000, 0);

        mindar.scene.add(new AmbientLight(0xffffff, 1.5));

        const keyLight = new DirectionalLight(0xffffff, 2);
        keyLight.position.set(2, 4, 2);
        mindar.scene.add(keyLight);

        const anchors = config.targets.map((target) => {
          const anchor = mindar.addAnchor(target.targetIndex);
          anchor.onTargetFound = () => handleTargetFound(target);
          anchor.onTargetLost = () => handleTargetLost(target);

          return { target, anchor };
        });

        setStatusMessage("Preparing AR...");
        await Promise.all(
          anchors.map(({ target, anchor }) => prepareTargetRuntime(target, anchor))
        );

        if (disposed) {
          return;
        }

        setStatusMessage("Searching...");
        await mindar.start();

        if (disposed) {
          return;
        }

        setTrackingStatus("searching");
        setStatusMessage("Searching...");
        captureStillRef.current = captureStill;
        mindar.renderer.setAnimationLoop((frameTime) => {
          if (disposed) {
            return;
          }

          const delta = (frameTime - previousFrameTime) / 1000;
          previousFrameTime = frameTime;
          activeRuntimesRef.current.forEach((runtime) => {
            if (runtime.visible) {
              runtime.poseBinding.update(delta);
            }

            const hasActiveVfx = updateMascotVfx(runtime, frameTime);

            if (runtime.visible || hasActiveVfx) {
              runtime.mixer?.update(delta);
            }
          });
          mindar.renderer.render(mindar.scene, mindar.camera);
        });
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Image Tracking could not start. Check camera access and target assets."
        );
      }
    }

    void startImageTracking();

    return () => {
      disposed = true;
      captureStillRef.current = () => undefined;
      unloadAllRuntimes();
      const mindar = mindarRef.current;
      mindarRef.current = null;

      if (mindar) {
        mindar.renderer.setAnimationLoop(null);
        safeStopMindAR(mindar);
        disposeMindARRenderer(mindar.renderer);
        container.replaceChildren();
      }
    };
  }, [config]);

  const canCapture =
    trackingStatus === "found" && captureStatus !== "capturing" && capturedPhoto === null;

  return (
    <section className="image-tracking-session" data-testid="image-tracking-session">
      <div ref={containerRef} className="image-tracking-stage" />
      <div className="image-tracking-topbar">
        <button className="image-tracking-back" type="button" onClick={onBack}>
          ← Back
        </button>
        <p>Point your camera at a supported image.</p>
      </div>
      <div className="image-tracking-status-panel" role="status">
        <p>{statusMessage}</p>
        {activeTargetName ? <span>{activeTargetName}</span> : null}
        <button
          className="image-tracking-capture"
          type="button"
          disabled={!canCapture}
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
    </section>
  );
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

async function isTargetDatabaseAvailable(databaseUrl: string) {
  try {
    const headResponse = await fetch(databaseUrl, { method: "HEAD", cache: "no-store" });

    if (isMindDatabaseResponse(headResponse)) {
      return true;
    }

    if (headResponse.status !== 405) {
      return false;
    }
  } catch {
    return false;
  }

  try {
    const getResponse = await fetch(databaseUrl, { cache: "no-store" });

    return isMindDatabaseResponse(getResponse);
  } catch {
    return false;
  }
}

function isMindDatabaseResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  return response.ok && !contentType.toLowerCase().includes("text/html");
}

function safeStopMindAR(mindar: MindARThree) {
  try {
    mindar.stop();
  } catch {
    // MindAR stop assumes startup completed; cleanup also runs after partial starts.
  }
}

function disposeMindARRenderer(renderer: WebGLRenderer) {
  renderer.dispose();
  renderer.forceContextLoss();
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

function getVisibleRuntimes(runtimes: Map<number, ActiveImageRuntime>) {
  return [...runtimes.values()].filter((runtime) => runtime.visible && runtime.loaded);
}

function createMascotVfx(): MascotVfx {
  const group = new Group();
  group.visible = false;
  group.position.z = 0.72;

  const auraTexture = createAuraTexture();
  const auraMaterial = new SpriteMaterial({
    map: auraTexture,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false
  });
  const aura = new Sprite(auraMaterial);
  aura.scale.setScalar(1);
  group.add(aura);

  const particleGeometry = createParticleGeometry();
  const particleMaterial = new PointsMaterial({
    color: 0xffffff,
    size: 0.09,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false
  });
  const particles = new Points(particleGeometry, particleMaterial);
  group.add(particles);

  return {
    group,
    aura,
    auraMaterial,
    auraTexture,
    particles,
    particleMaterial,
    particleGeometry
  };
}

function createAuraTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = AURA_TEXTURE_SIZE;
  canvas.height = AURA_TEXTURE_SIZE;
  const context = get2DContext(canvas);
  const center = AURA_TEXTURE_SIZE / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.22, "rgba(255,255,255,0.68)");
  gradient.addColorStop(0.56, "rgba(255,255,255,0.18)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  return new CanvasTexture(canvas);
}

function createParticleGeometry() {
  const positions: number[] = [];

  for (let index = 0; index < VFX_PARTICLE_COUNT; index += 1) {
    const angle = (index / VFX_PARTICLE_COUNT) * Math.PI * 2;
    const ring = index % 3;
    const radius = 0.2 + ring * 0.14 + (index % 5) * 0.018;
    const height = -0.18 + ((index * 7) % 17) * 0.055;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, height);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

  return geometry;
}

function startMascotAppear(runtime: ActiveImageRuntime, frameTime: number) {
  if (!runtime.loaded) {
    return;
  }

  runtime.root.visible = true;
  runtime.standRoot.visible = false;
  runtime.standRoot.scale.setScalar(APPEAR_MODEL_START_SCALE);
  runtime.modelVisible = false;
  runtime.appearStartedAt = frameTime;
  runtime.vfx.group.visible = true;
  updateMascotVfx(runtime, frameTime);
}

function hideMascotAfterTrackingLoss(runtime: ActiveImageRuntime) {
  runtime.appearStartedAt = null;
  runtime.root.visible = false;
  runtime.standRoot.visible = false;
  runtime.modelVisible = false;
  runtime.vfx.group.visible = false;
}

function resumeMascotAfterReacquisition(runtime: ActiveImageRuntime) {
  runtime.appearStartedAt = null;
  runtime.root.visible = runtime.loaded;
  runtime.standRoot.visible = runtime.loaded;
  runtime.standRoot.scale.setScalar(1);
  runtime.modelVisible = runtime.loaded;
  runtime.vfx.group.visible = false;
}

function updateMascotVfx(runtime: ActiveImageRuntime, frameTime: number) {
  if (runtime.appearStartedAt !== null) {
    const elapsed = frameTime - runtime.appearStartedAt;
    const progress = MathUtils.clamp(elapsed / APPEAR_VFX_DURATION_MS, 0, 1);
    const pulse = Math.sin(progress * Math.PI);

    runtime.vfx.group.visible = progress < 1;
    runtime.vfx.auraMaterial.opacity = 1.18 * (1 - progress) + 0.42 * pulse;
    runtime.vfx.aura.scale.setScalar(1.3 + progress * 2.8);
    runtime.vfx.particleMaterial.opacity = 0.96 * (1 - progress);
    runtime.vfx.particles.scale.setScalar(0.95 + progress * 2.35);

    if (!runtime.modelVisible && elapsed >= APPEAR_MODEL_DELAY_MS) {
      runtime.standRoot.visible = runtime.visible;
      runtime.modelVisible = runtime.visible;
    }

    if (runtime.modelVisible) {
      const modelProgress = MathUtils.clamp(
        (elapsed - APPEAR_MODEL_DELAY_MS) / APPEAR_MODEL_GROW_DURATION_MS,
        0,
        1
      );
      runtime.standRoot.scale.setScalar(getOvershootScale(modelProgress));
    }

    if (progress >= 1) {
      runtime.appearStartedAt = null;
      runtime.vfx.group.visible = false;
      runtime.standRoot.visible = runtime.visible;
      runtime.standRoot.scale.setScalar(1);
      runtime.modelVisible = runtime.visible;
      return false;
    }

    return true;
  }

  runtime.vfx.group.visible = false;
  return false;
}

function disposeMascotVfx(vfx: MascotVfx) {
  vfx.auraTexture.dispose();
  vfx.auraMaterial.dispose();
  vfx.particleGeometry.dispose();
  vfx.particleMaterial.dispose();
}

function getOvershootScale(progress: number) {
  const eased = 1 - Math.pow(1 - progress, 3);
  const overshoot = Math.sin(progress * Math.PI) * APPEAR_MODEL_OVERSHOOT;

  return APPEAR_MODEL_START_SCALE + (1 - APPEAR_MODEL_START_SCALE) * eased + overshoot;
}

const MAX_SIMULTANEOUS_IMAGE_TARGETS = 2;
const TRACKING_FILTER_MIN_CUTOFF = 0.001;
const TRACKING_FILTER_BETA = 1000;
const TRACKING_WARMUP_TOLERANCE = 3;
const TRACKING_MISS_TOLERANCE = 4;
const IMAGE_TARGET_STAND_ROTATION_RADIANS = MathUtils.degToRad(90);
const APPEAR_MODEL_DELAY_MS = 150;
const APPEAR_MODEL_GROW_DURATION_MS = 360;
const APPEAR_MODEL_START_SCALE = 0.18;
const APPEAR_MODEL_OVERSHOOT = 0.12;
const APPEAR_VFX_DURATION_MS = 700;
const AURA_TEXTURE_SIZE = 128;
const VFX_PARTICLE_COUNT = 72;
