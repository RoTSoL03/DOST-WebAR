import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  AnimationMixer,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";

import type { MascotId, MascotManifestEntry } from "../config/mascots";
import { instantiateMascotModel } from "../rendering/modelCache";
import { resolveQualityProfile } from "../services/deviceProfile";
import { useSessionStore } from "../state/sessionStore";
import {
  canvasToBlob,
  createCaptureFileName,
  get2DContext,
  type CapturedPhoto
} from "./captureUtils";
import { getScanHint, MascotOverlayControls } from "./MascotOverlayControls";
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

interface CameraARSessionProps {
  mascots: readonly MascotManifestEntry[];
  stream: MediaStream;
  onEnd: () => void;
}

type CameraSessionStatus = "loading" | "scanning" | "surface-found" | "error";
type CaptureStatus = "idle" | "capturing" | "ready" | "failed";

interface CameraMascotRuntime {
  mascot: MascotManifestEntry;
  root: Group;
  contentRoot: Group;
  model: Group;
  vfx: MascotVfx;
  mixer: AnimationMixer | null;
  loaded: boolean;
  placed: boolean;
  visible: boolean;
  modelVisible: boolean;
  appearStartedAt: number | null;
  disappearStartedAt: number | null;
}

/**
 * iOS/fallback AR runtime. Safari does not ship WebXR immersive-ar, so this
 * session recreates the Android workflow on top of getUserMedia: the camera
 * feed is the background, the gyroscope orients a virtual perspective camera,
 * and mascots are placed by raycasting screen taps onto an estimated ground
 * plane one camera-height below the device. Placement, multi-mascot support
 * and photo capture behave exactly like the WebXR session.
 */
export function CameraARSession({ mascots, stream, onEnd }: CameraARSessionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<CameraSessionStatus>("loading");
  const [activeMascotId, setActiveMascotId] = useState<MascotId>(() => getInitialMascotId(mascots));
  const [loadedMascotIds, setLoadedMascotIds] = useState<MascotId[]>([]);
  const [placedMascotIds, setPlacedMascotIds] = useState<MascotId[]>([]);
  const [movingMascotId, setMovingMascotId] = useState<MascotId | null>(null);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
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

    const profile = resolveQualityProfile();
    const glContext = canvas.getContext("webgl2", {
      alpha: true,
      antialias: profile.antialias,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    });

    if (!glContext) {
      setStatus("error");
      return;
    }

    let disposed = false;
    let captureInProgress = false;
    let previousFrameTime = performance.now();
    let hasOrientation = false;
    let floorReady = false;
    let floorConfidenceMs = 0;
    let lastSurfacePatchTime = 0;
    let lastStatus: CameraSessionStatus = "loading";
    const scene = new Scene();
    const camera = new PerspectiveCamera(CAMERA_FOV_DEGREES, 1, 0.05, 60);
    const renderer = new WebGLRenderer({
      canvas,
      context: glContext as unknown as WebGLRenderingContext,
      alpha: true,
      antialias: profile.antialias,
      preserveDrawingBuffer: true
    });
    const mascotRuntimes = new Map<MascotId, CameraMascotRuntime>();
    const reticle = createReticle();
    const orientationQuaternion = new Quaternion();
    const pendingOrientationQuaternion = new Quaternion();
    const lastAcceptedOrientationQuaternion = new Quaternion();
    const estimatedCameraPosition = new Vector3(0, CAMERA_HEIGHT_METERS, 0);
    const estimatedCameraVelocity = new Vector3();
    const motionAcceleration = new Vector3();
    const worldMotionAcceleration = new Vector3();
    const fixedPitchQuaternion = new Quaternion().setFromEuler(
      new Euler(FIXED_PITCH_RADIANS, 0, 0, "YXZ")
    );
    const aimNdc = new Vector2(0, RETICLE_AIM_NDC_Y);
    const rayOrigin = new Vector3();
    const rayDirection = new Vector3();
    const floorPoint = new Vector3();
    const lastSurfacePatchPosition = new Vector3(Number.POSITIVE_INFINITY, 0, 0);
    const surfacePatchGeometries = createSurfacePatchGeometries();
    const scannedSurfaces = new Group();
    const needsOrientation = needsSpatialSensorPermission();
    let hasMotionPosition = false;
    let lastMotionTime: number | null = null;
    let lastMotionEventTime = 0;

    camera.position.set(0, CAMERA_HEIGHT_METERS, 0);
    camera.quaternion.copy(fixedPitchQuaternion);
    orientationQuaternion.copy(fixedPitchQuaternion);
    pendingOrientationQuaternion.copy(fixedPitchQuaternion);
    lastAcceptedOrientationQuaternion.copy(fixedPitchQuaternion);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio));
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;

    scene.add(new AmbientLight(0xffffff, 1.5));

    const keyLight = new DirectionalLight(0xffffff, 2);
    keyLight.position.set(2, 4, 2);
    scene.add(keyLight);
    scene.add(scannedSurfaces);
    scene.add(reticle);

    mascots.forEach((manifestEntry) => {
      const root = new Group();
      const contentRoot = new Group();
      const model = new Group();
      const vfx = createMascotVfx();
      const contactShadow = createMascotContactShadow();
      root.matrixAutoUpdate = false;
      root.visible = false;
      contentRoot.add(contactShadow, model);
      root.add(contentRoot, vfx.group);
      scene.add(root);
      mascotRuntimes.set(manifestEntry.id, {
        mascot: manifestEntry,
        root,
        contentRoot,
        model,
        vfx,
        mixer: null,
        loaded: false,
        placed: false,
        visible: false,
        modelVisible: false,
        appearStartedAt: null,
        disappearStartedAt: null
      });
    });

    const updateStatus = (nextStatus: CameraSessionStatus) => {
      if (lastStatus !== nextStatus) {
        lastStatus = nextStatus;
        setStatus(nextStatus);
      }
    };

    const handleDeviceOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) {
        return;
      }

      setQuaternionFromDeviceOrientation(
        pendingOrientationQuaternion,
        event.alpha ?? 0,
        event.beta,
        event.gamma,
        getScreenOrientationAngle()
      );

      if (
        quaternionAngleBetween(
          pendingOrientationQuaternion,
          lastAcceptedOrientationQuaternion
        ) < ORIENTATION_INPUT_DEADBAND_RADIANS
      ) {
        return;
      }

      orientationQuaternion.copy(pendingOrientationQuaternion);
      lastAcceptedOrientationQuaternion.copy(pendingOrientationQuaternion);
      hasOrientation = true;
    };

    const handleDeviceMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.acceleration;

      if (
        acceleration?.x === null ||
        acceleration?.y === null ||
        acceleration?.z === null ||
        acceleration?.x === undefined ||
        acceleration?.y === undefined ||
        acceleration?.z === undefined
      ) {
        return;
      }

      const now = performance.now();
      const deltaSeconds =
        lastMotionTime === null
          ? 0
          : Math.min((now - lastMotionTime) / 1000, MOTION_MAX_DELTA_SECONDS);
      lastMotionTime = now;
      lastMotionEventTime = now;

      if (deltaSeconds <= 0) {
        return;
      }

      motionAcceleration.set(acceleration.x, acceleration.y, acceleration.z);
      worldMotionAcceleration.copy(motionAcceleration).applyQuaternion(camera.quaternion);
      worldMotionAcceleration.y = 0;

      const accelerationLength = worldMotionAcceleration.length();

      if (accelerationLength < MOTION_ACCELERATION_DEADBAND) {
        estimatedCameraVelocity.multiplyScalar(
          Math.exp(-MOTION_VELOCITY_DAMPING_PER_SECOND * deltaSeconds)
        );
        return;
      }

      worldMotionAcceleration.multiplyScalar(
        ((Math.min(accelerationLength, MOTION_MAX_ACCELERATION) -
          MOTION_ACCELERATION_DEADBAND) /
          accelerationLength) *
          MOTION_ACCELERATION_GAIN
      );

      estimatedCameraVelocity.addScaledVector(worldMotionAcceleration, deltaSeconds);
      estimatedCameraVelocity.multiplyScalar(
        Math.exp(-MOTION_VELOCITY_DAMPING_PER_SECOND * deltaSeconds)
      );
      estimatedCameraPosition.addScaledVector(estimatedCameraVelocity, deltaSeconds);
      clampHorizontalCameraEstimate(estimatedCameraPosition);
      hasMotionPosition = true;
    };

    const resizeRenderer = () => {
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    /**
     * Casts a ray from a normalized screen point onto the estimated ground
     * plane (y = 0). Returns true when it lands within a placeable range.
     */
    const intersectFloor = (ndcX: number, ndcY: number, target: Vector3): boolean => {
      rayOrigin.setFromMatrixPosition(camera.matrixWorld);
      rayDirection.set(ndcX, ndcY, 0.5).unproject(camera).sub(rayOrigin).normalize();

      if (rayDirection.y > -MIN_DOWNWARD_RAY_SLOPE) {
        return false;
      }

      const distanceAlongRay = -rayOrigin.y / rayDirection.y;
      target.copy(rayOrigin).addScaledVector(rayDirection, distanceAlongRay);

      const horizontalDistance = Math.hypot(target.x - rayOrigin.x, target.z - rayOrigin.z);

      return (
        horizontalDistance >= MIN_PLACEMENT_DISTANCE_METERS &&
        horizontalDistance <= MAX_PLACEMENT_DISTANCE_METERS
      );
    };

    const placeSelectedMascot = (event: PointerEvent) => {
      const runtime = mascotRuntimes.get(activeMascotIdRef.current);

      if (!runtime || !runtime.loaded || !floorReady) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const ndcX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const ndcY = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);

      if (!intersectFloor(ndcX, ndcY, floorPoint)) {
        return;
      }

      event.preventDefault();
      const wasPlaced = runtime.placed || placedMascotIdsRef.current.includes(runtime.mascot.id);
      applyStableMascotAnchor(runtime.root, floorPoint);
      runtime.placed = true;
      startMascotAppear(runtime, performance.now());
      movingMascotIdRef.current = null;
      setMovingMascotId(null);

      if (wasPlaced) {
        updateStatus(placedMascotIdsRef.current.length === mascots.length ? "surface-found" : lastStatus);
        return;
      }

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

    const selectMascotForPlacement = (mascotId: MascotId) => {
      const runtime = mascotRuntimes.get(mascotId);

      activeMascotIdRef.current = mascotId;
      setActiveMascotId(mascotId);
      movingMascotIdRef.current = runtime?.placed ? mascotId : null;
      setMovingMascotId(runtime?.placed ? mascotId : null);

      if (runtime?.placed) {
        runtime.placed = false;
        runtime.visible = false;
        startMascotDisappear(runtime, performance.now());
      }

      floorReady = false;
      floorConfidenceMs = 0;
      reticle.visible = false;
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
      const reticleWasVisible = reticle.visible;
      reticle.visible = false;
      renderer.render(scene, camera);

      void captureCameraComposite(video, canvas)
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
          reticle.visible = reticleWasVisible;
          captureInProgress = false;
        });
    };

    async function loadMascots() {
      try {
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

        if (!disposed) {
          enterPlacement();
          updateStatus("scanning");
        }
      } catch {
        if (!disposed) {
          updateStatus("error");
        }
      }
    }

    resizeRenderer();
    window.addEventListener("resize", resizeRenderer);
    window.addEventListener("orientationchange", resizeRenderer);
    window.addEventListener("deviceorientation", handleDeviceOrientation, true);
    window.addEventListener("devicemotion", handleDeviceMotion, true);
    canvas.addEventListener("pointerdown", placeSelectedMascot);
    captureStillRef.current = captureStill;
    selectMascotForPlacementRef.current = selectMascotForPlacement;
    void loadMascots();

    renderer.setAnimationLoop((frameTime) => {
      if (disposed) {
        return;
      }

      const delta = (frameTime - previousFrameTime) / 1000;
      previousFrameTime = frameTime;

      if (hasOrientation) {
        camera.quaternion.slerp(orientationQuaternion, getDampingAlpha(delta));
      }

      if (hasMotionPosition) {
        if (frameTime - lastMotionEventTime > MOTION_STALE_MS) {
          estimatedCameraVelocity.multiplyScalar(
            Math.exp(-MOTION_IDLE_DAMPING_PER_SECOND * Math.min(delta, MAX_FRAME_DELTA))
          );
        }

        camera.position.lerp(estimatedCameraPosition, getPositionDampingAlpha(delta));
      }

      camera.updateMatrixWorld();

      let allMascotsPlaced = true;
      mascotRuntimes.forEach((runtime) => {
        const hasActiveVfx = updateMascotVfx(runtime, frameTime);

        if (!runtime.placed) {
          allMascotsPlaced = false;
        }

        if (runtime.placed || hasActiveVfx) {
          runtime.mixer?.update(delta);
        }

        if (!runtime.placed && !hasActiveVfx && runtime.disappearStartedAt === null) {
          runtime.root.visible = false;
        }
      });
      fadeScannedSurfacePatches(scannedSurfaces, frameTime);

      if (lastStatus !== "loading" && lastStatus !== "error") {
        if (allMascotsPlaced && movingMascotIdRef.current === null) {
          reticle.visible = false;
        } else if (intersectFloor(aimNdc.x, aimNdc.y, floorPoint)) {
          if (hasOrientation || !needsOrientation) {
            floorConfidenceMs = Math.min(
              FLOOR_SCAN_CONFIRMATION_MS,
              floorConfidenceMs + delta * 1000
            );

            if (
              sampleScannedSurfacePatch(
                scannedSurfaces,
                surfacePatchGeometries,
                floorPoint,
                frameTime,
                lastSurfacePatchPosition,
                lastSurfacePatchTime
              )
            ) {
              lastSurfacePatchTime = frameTime;
            }

            floorReady = floorConfidenceMs >= FLOOR_SCAN_CONFIRMATION_MS;
            reticle.matrix.makeTranslation(floorPoint.x, floorPoint.y, floorPoint.z);
            reticle.matrixWorldNeedsUpdate = true;
            reticle.visible = floorReady;
            updateStatus(floorReady ? "surface-found" : "scanning");
          } else {
            floorReady = false;
            floorConfidenceMs = 0;
            reticle.visible = false;
            updateStatus("scanning");
          }
        } else {
          floorReady = false;
          floorConfidenceMs = Math.max(0, floorConfidenceMs - delta * 1000 * 2);
          reticle.visible = false;
          updateStatus("scanning");
        }
      }

      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      captureStillRef.current = () => undefined;
      selectMascotForPlacementRef.current = () => undefined;
      canvas.removeEventListener("pointerdown", placeSelectedMascot);
      window.removeEventListener("resize", resizeRenderer);
      window.removeEventListener("orientationchange", resizeRenderer);
      window.removeEventListener("deviceorientation", handleDeviceOrientation, true);
      window.removeEventListener("devicemotion", handleDeviceMotion, true);
      renderer.setAnimationLoop(null);
      surfacePatchGeometries.fill.dispose();
      surfacePatchGeometries.grid.dispose();
      mascotRuntimes.forEach((runtime) => {
        runtime.mixer?.stopAllAction();
        // Cached model instances share resources with the model cache; detach
        // them so scene disposal only touches session-owned objects.
        runtime.model.clear();
        disposeMascotVfx(runtime.vfx);
      });
      disposeObjectResources(scene);
      renderer.dispose();
    };
  }, [enterPlacement, markMascotPlaced, mascots]);

  const allPlaced = placedMascotIds.length === mascots.length;
  const isMovingPlacedMascot = movingMascotId !== null;
  const activeMascotName =
    mascots.find((entry) => entry.id === activeMascotId)?.displayName ?? "mascot";

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
        aria-label="Tap the floor to place the selected mascot"
      />
      <MascotOverlayControls
        mascots={mascots}
        activeMascotId={activeMascotId}
        loadedMascotIds={loadedMascotIds}
        placedMascotIds={placedMascotIds}
        onMascotButton={(mascotId) => {
          selectMascotForPlacementRef.current(mascotId);
        }}
        captureButtonLabel={getCaptureButtonLabel(captureStatus)}
        captureDisabled={
          Boolean(capturedPhoto) || captureStatus === "capturing" || placedMascotIds.length === 0
        }
        onCapture={() => captureStillRef.current()}
        capturedPhoto={capturedPhoto}
        onRetake={() => {
          setCapturedPhoto(null);
          setCaptureStatus("idle");
        }}
      >
        <button className="camera-end-button" type="button" onClick={onEnd}>
          ← Back
        </button>
        <p className="camera-scan-hint" role="status">
          {getScanHint(status, allPlaced && !isMovingPlacedMascot, activeMascotName)}
        </p>
      </MascotOverlayControls>
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

function getInitialMascotId(mascots: readonly MascotManifestEntry[]) {
  const mascot = mascots[0];

  if (!mascot) {
    throw new Error("At least one mascot must be configured.");
  }

  return mascot.id;
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

const orientationEuler = new Euler();
const orientationScreenQuaternion = new Quaternion();
const CAMERA_LOOK_ADJUSTMENT = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const Z_AXIS = new Vector3(0, 0, 1);

/**
 * Standard deviceorientation → camera quaternion conversion (the math used by
 * three.js DeviceOrientationControls), including screen-rotation compensation.
 */
function setQuaternionFromDeviceOrientation(
  target: Quaternion,
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenOrientationDeg: number
) {
  const alpha = MathUtils.degToRad(alphaDeg);
  const beta = MathUtils.degToRad(betaDeg);
  const gamma = MathUtils.degToRad(gammaDeg);
  const orient = MathUtils.degToRad(screenOrientationDeg);

  orientationEuler.set(beta, alpha, -gamma, "YXZ");
  target.setFromEuler(orientationEuler);
  target.multiply(CAMERA_LOOK_ADJUSTMENT);
  target.multiply(orientationScreenQuaternion.setFromAxisAngle(Z_AXIS, -orient));
}

function quaternionAngleBetween(first: Quaternion, second: Quaternion) {
  return first.angleTo(second);
}

function getDampingAlpha(deltaSeconds: number) {
  return 1 - Math.exp(-ORIENTATION_DAMPING_PER_SECOND * Math.min(deltaSeconds, MAX_FRAME_DELTA));
}

function getPositionDampingAlpha(deltaSeconds: number) {
  return 1 - Math.exp(-POSITION_DAMPING_PER_SECOND * Math.min(deltaSeconds, MAX_FRAME_DELTA));
}

function clampHorizontalCameraEstimate(position: Vector3) {
  position.y = CAMERA_HEIGHT_METERS;

  const horizontalDistance = Math.hypot(position.x, position.z);

  if (horizontalDistance <= MAX_ESTIMATED_CAMERA_TRANSLATION_METERS) {
    return;
  }

  const scale = MAX_ESTIMATED_CAMERA_TRANSLATION_METERS / horizontalDistance;
  position.x *= scale;
  position.z *= scale;
}

function applyStableMascotAnchor(root: Group, floorPosition: Vector3) {
  root.position.copy(floorPosition);
  root.rotation.set(0, Math.atan2(-floorPosition.x, -floorPosition.z), 0);
  root.updateMatrix();
  root.updateMatrixWorld(true);
  root.visible = true;
}

function getScreenOrientationAngle(): number {
  if (typeof screen !== "undefined" && screen.orientation) {
    return screen.orientation.angle;
  }

  const legacyOrientation = (window as { orientation?: number }).orientation;

  return typeof legacyOrientation === "number" ? legacyOrientation : 0;
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

interface SurfacePatchGeometries {
  fill: PlaneGeometry;
  grid: BufferGeometry;
}

function createSurfacePatchGeometries(): SurfacePatchGeometries {
  return {
    fill: new PlaneGeometry(CAMERA_SURFACE_PATCH_SIZE_METERS, CAMERA_SURFACE_PATCH_SIZE_METERS)
      .rotateX(-Math.PI / 2),
    grid: createSurfaceGridGeometry(
      CAMERA_SURFACE_PATCH_SIZE_METERS,
      CAMERA_SURFACE_PATCH_DIVISIONS
    )
  };
}

function sampleScannedSurfacePatch(
  scannedSurfaces: Group,
  geometries: SurfacePatchGeometries,
  position: Vector3,
  frameTime: number,
  lastPatchPosition: Vector3,
  lastPatchTime: number
) {
  if (
    frameTime - lastPatchTime < CAMERA_SURFACE_SAMPLE_INTERVAL_MS ||
    position.distanceTo(lastPatchPosition) < CAMERA_SURFACE_SAMPLE_DISTANCE_METERS
  ) {
    return false;
  }

  const patch = createSurfacePatch(geometries);
  patch.position.copy(position);
  patch.userData.createdAt = frameTime;
  scannedSurfaces.add(patch);
  lastPatchPosition.copy(position);

  while (scannedSurfaces.children.length > MAX_CAMERA_SURFACE_PATCHES) {
    const oldestPatch = scannedSurfaces.children[0];

    if (!oldestPatch) {
      break;
    }

    scannedSurfaces.remove(oldestPatch);
    disposeSurfacePatchMaterials(oldestPatch);
  }

  return true;
}

function createSurfacePatch(geometries: SurfacePatchGeometries) {
  const patch = new Group();
  const fillMaterial = new MeshBasicMaterial({
    color: 0x35f3cf,
    side: DoubleSide,
    transparent: true,
    opacity: 0.16,
    depthTest: false,
    depthWrite: false
  });
  const lineMaterial = new LineBasicMaterial({
    color: 0xf9f871,
    transparent: true,
    opacity: 0.56,
    depthTest: false,
    depthWrite: false
  });

  patch.add(
    new Mesh(geometries.fill, fillMaterial),
    new LineSegments(geometries.grid, lineMaterial)
  );

  return patch;
}

function fadeScannedSurfacePatches(scannedSurfaces: Group, frameTime: number) {
  for (let index = scannedSurfaces.children.length - 1; index >= 0; index -= 1) {
    const patch = scannedSurfaces.children[index];

    if (!patch) {
      continue;
    }

    const createdAt = typeof patch.userData.createdAt === "number" ? patch.userData.createdAt : 0;
    const ageMs = frameTime - createdAt;
    const opacityScale = getSurfacePatchOpacityScale(ageMs);

    if (opacityScale <= 0) {
      scannedSurfaces.remove(patch);
      disposeSurfacePatchMaterials(patch);
      continue;
    }

    setPatchOpacity(patch, opacityScale);
  }
}

function disposeSurfacePatchMaterials(object: Object3D) {
  object.traverse((child) => {
    const material = (child as Mesh | LineSegments).material;

    if (!material || Array.isArray(material)) {
      return;
    }

    material.dispose();
  });
}

function getSurfacePatchOpacityScale(ageMs: number) {
  if (ageMs <= CAMERA_SURFACE_PATCH_HOLD_MS) {
    return 1;
  }

  const fadeProgress = (ageMs - CAMERA_SURFACE_PATCH_HOLD_MS) / CAMERA_SURFACE_PATCH_FADE_MS;

  return Math.max(0, 1 - fadeProgress);
}

function setPatchOpacity(object: Object3D, opacityScale: number) {
  object.traverse((child) => {
    const material = (child as Mesh | LineSegments).material;

    if (!material || Array.isArray(material)) {
      return;
    }

    material.opacity = ((child as LineSegments).isLineSegments ? 0.56 : 0.16) * opacityScale;
  });
}

function createSurfaceGridGeometry(size: number, divisions: number) {
  const half = size / 2;
  const positions: number[] = [];

  for (let index = 0; index <= divisions; index += 1) {
    const offset = -half + (size * index) / divisions;
    positions.push(-half, 0, offset, half, 0, offset);
    positions.push(offset, 0, -half, offset, 0, half);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

  return geometry;
}

function needsSpatialSensorPermission() {
  const requestPermission = (
    globalThis.DeviceOrientationEvent as
      | { requestPermission?: () => Promise<PermissionState> }
      | undefined
  )?.requestPermission;

  return typeof requestPermission === "function";
}

const CAMERA_FOV_DEGREES = 62;
/** Assumed height of a hand-held phone above the floor. */
const CAMERA_HEIGHT_METERS = 1.4;
/** Camera pitch used when gyroscope data is unavailable or denied. */
const FIXED_PITCH_RADIANS = -0.42;
/** Aim point for the reticle, slightly below screen center. */
const RETICLE_AIM_NDC_Y = -0.3;
const MIN_DOWNWARD_RAY_SLOPE = 0.08;
const MIN_PLACEMENT_DISTANCE_METERS = 0.4;
const MAX_PLACEMENT_DISTANCE_METERS = 7;
const ORIENTATION_INPUT_DEADBAND_RADIANS = MathUtils.degToRad(0.35);
const ORIENTATION_DAMPING_PER_SECOND = 7;
const POSITION_DAMPING_PER_SECOND = 9;
const MAX_FRAME_DELTA = 0.05;
const MOTION_ACCELERATION_DEADBAND = 0.18;
const MOTION_ACCELERATION_GAIN = 0.42;
const MOTION_MAX_ACCELERATION = 3.5;
const MOTION_MAX_DELTA_SECONDS = 0.08;
const MOTION_VELOCITY_DAMPING_PER_SECOND = 2.8;
const MOTION_IDLE_DAMPING_PER_SECOND = 5.2;
const MOTION_STALE_MS = 260;
const MAX_ESTIMATED_CAMERA_TRANSLATION_METERS = 2.25;
const FLOOR_SCAN_CONFIRMATION_MS = 650;
const CAMERA_SURFACE_PATCH_SIZE_METERS = 1.2;
const CAMERA_SURFACE_PATCH_DIVISIONS = 6;
const CAMERA_SURFACE_SAMPLE_INTERVAL_MS = 220;
const CAMERA_SURFACE_SAMPLE_DISTANCE_METERS = 0.3;
const CAMERA_SURFACE_PATCH_HOLD_MS = 900;
const CAMERA_SURFACE_PATCH_FADE_MS = 600;
const MAX_CAMERA_SURFACE_PATCHES = 10;
