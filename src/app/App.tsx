import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { mascotManifest } from "../config/mascots";
import { createCapabilityCheckError, type UserFacingError } from "../errors/userFacingError";
import { detectCapabilities, type CapabilityResult } from "../services/capabilities";
import { useSessionStore } from "../state/sessionStore";

const CameraARSession = lazy(() =>
  import("../ar/CameraARSession").then((module) => ({ default: module.CameraARSession }))
);

const ImageTrackingSession = lazy(() =>
  import("../ar/ImageTrackingSession").then((module) => ({ default: module.ImageTrackingSession }))
);

const WebXRSession = lazy(() =>
  import("../ar/WebXRSession").then((module) => ({ default: module.WebXRSession }))
);

export interface AppProps {
  detectCapabilitiesFn?: () => Promise<CapabilityResult>;
}

export function App({ detectCapabilitiesFn = detectCapabilities }: AppProps) {
  const sessionStatus = useSessionStore((state) => state.sessionStatus);
  const runtimeKind = useSessionStore((state) => state.runtimeKind);
  const capabilities = useSessionStore((state) => state.capabilities);
  const beginCapabilityCheck = useSessionStore((state) => state.beginCapabilityCheck);
  const applyCapabilities = useSessionStore((state) => state.applyCapabilities);
  const requestPermission = useSessionStore((state) => state.requestPermission);
  const startRuntime = useSessionStore((state) => state.startRuntime);
  const endSession = useSessionStore((state) => state.endSession);
  const setError = useSessionStore((state) => state.setError);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [xrSession, setXrSession] = useState<XRSession | null>(null);
  const [xrOverlayRoot, setXrOverlayRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let mounted = true;

    beginCapabilityCheck();
    detectCapabilitiesFn()
      .then((result) => {
        if (mounted) {
          applyCapabilities(result);
        }
      })
      .catch(() => {
        if (mounted) {
          setError(createCapabilityCheckError());
        }
      });

    return () => {
      mounted = false;
    };
  }, [applyCapabilities, beginCapabilityCheck, detectCapabilitiesFn, setError]);

  const startAR = async () => {
    if (runtimeKind === "webxr") {
      await startWebXR();
      return;
    }

    if (runtimeKind === "image-tracking") {
      startImageTracking();
      return;
    }

    await startCameraAR();
  };

  const startImageTracking = () => {
    if (!window.isSecureContext) {
      setError(
        createImageTrackingError("Image tracking requires HTTPS on phones. Open the HTTPS LAN URL.")
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(createImageTrackingError("This browser does not expose camera access."));
      return;
    }

    requestPermission();
    startRuntime();
  };

  const startWebXR = async () => {
    if (!window.isSecureContext) {
      setError(createWebXRError("WebXR requires HTTPS on phones. Open the HTTPS LAN URL."));
      return;
    }

    if (!navigator.xr?.requestSession) {
      setError(createWebXRError("This browser does not expose WebXR immersive AR."));
      return;
    }

    try {
      requestPermission();
      const overlayRoot = createWebXROverlayRoot();
      const { session, domOverlayRoot } = await requestWebXRSession(overlayRoot);
      setXrOverlayRoot(domOverlayRoot);
      setXrSession(session);
      startRuntime();
    } catch {
      removeWebXROverlayRoot();
      setError(
        createWebXRError(
          "WebXR could not start. Use Android Chrome on an ARCore-capable phone and try again in a well-lit space."
        )
      );
    }
  };

  const startCameraAR = async () => {
    if (!window.isSecureContext) {
      setError(createCameraError("Camera requires HTTPS on phones. Open the HTTPS LAN URL."));
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(createCameraError("This browser does not expose camera access."));
      return;
    }

    try {
      requestPermission();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      setCameraStream(stream);
      startRuntime();
    } catch {
      setError(createCameraError("Camera permission was denied or the camera could not start."));
    }
  };

  const endCameraAR = () => {
    cameraStream?.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
    endSession();
  };

  const endWebXR = useCallback(() => {
    setXrSession(null);
    setXrOverlayRoot(null);
    removeWebXROverlayRoot();
    endSession();
  }, [endSession]);

  const handleWebXRError = useCallback(
    (message: string) => {
      setError(createWebXRError(message));
    },
    [setError]
  );

  const handleImageTrackingError = useCallback(
    (message: string) => {
      setError(createImageTrackingError(message));
    },
    [setError]
  );

  if (isActiveRuntimeStatus(sessionStatus) && runtimeKind === "image-tracking") {
    return (
      <Suspense fallback={<div className="camera-loading">Loading AR...</div>}>
        <ImageTrackingSession
          mascots={mascotManifest}
          imageTargetSrc="/targets/mindar-card.mind"
          onEnd={endSession}
          onError={handleImageTrackingError}
        />
      </Suspense>
    );
  }

  if (isActiveRuntimeStatus(sessionStatus) && xrSession) {
    return (
      <Suspense fallback={<div className="camera-loading">Loading AR...</div>}>
        <WebXRSession
          mascots={mascotManifest}
          domOverlayRoot={xrOverlayRoot}
          session={xrSession}
          onEnd={endWebXR}
          onError={handleWebXRError}
        />
      </Suspense>
    );
  }

  if (
    isActiveRuntimeStatus(sessionStatus) &&
    !xrSession &&
    runtimeKind !== "webxr" &&
    cameraStream
  ) {
    return (
      <Suspense fallback={<div className="camera-loading">Loading AR...</div>}>
        <CameraARSession mascots={mascotManifest} stream={cameraStream} onEnd={endCameraAR} />
      </Suspense>
    );
  }

  const isHomeReady = sessionStatus === "readyToStart";
  const isDesktopFallback = sessionStatus === "unsupported";

  return (
    <main
      className={
        isHomeReady
          ? "app-shell app-shell-home"
          : isDesktopFallback
            ? "app-shell app-shell-desktop-fallback"
            : "app-shell"
      }
      aria-live="polite"
    >
      {!isHomeReady && !isDesktopFallback ? (
        <header className="app-header">
          <p className="app-kicker">DOST WebAR</p>
          <h1>Mascot Experience</h1>
        </header>
      ) : null}

      <section className="app-panel">
        {sessionStatus === "checkingCapabilities" || sessionStatus === "idle" ? (
          <LoadingScreen />
        ) : null}

        {sessionStatus === "unsupported" ? (
          <UnsupportedScreen osFamily={capabilities?.osFamily ?? "unknown"} />
        ) : null}

        {sessionStatus === "readyToStart" ? (
          <ReadyScreen
            onStartAR={startAR}
            canAttemptWebXR={canAttemptWebXR(runtimeKind)}
            onStartWebXR={startWebXR}
          />
        ) : null}

        {sessionStatus === "error" ? <ErrorScreen /> : null}
      </section>
    </main>
  );
}

function isActiveRuntimeStatus(
  sessionStatus: ReturnType<typeof useSessionStore.getState>["sessionStatus"]
) {
  return (
    sessionStatus === "startingRuntime" ||
    sessionStatus === "detectingSurface" ||
    sessionStatus === "placingMascot" ||
    sessionStatus === "mascotPlaced"
  );
}

async function requestWebXRSession(
  domOverlayRoot: HTMLElement
): Promise<{ session: XRSession; domOverlayRoot: HTMLElement | null }> {
  if (!navigator.xr?.requestSession) {
    throw new Error("WebXR requestSession is unavailable.");
  }

  const attempts: Array<{
    cameraAccessMode: CameraAccessMode;
    domOverlayRoot: HTMLElement | null;
  }> = [
    { cameraAccessMode: "required", domOverlayRoot },
    { cameraAccessMode: "optional", domOverlayRoot },
    { cameraAccessMode: "required", domOverlayRoot: null },
    { cameraAccessMode: "optional", domOverlayRoot: null }
  ];
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      if (!attempt.domOverlayRoot) {
        removeWebXROverlayRoot();
      }

      return {
        session: await navigator.xr.requestSession(
          "immersive-ar",
          createWebXRSessionInit(attempt.domOverlayRoot, attempt.cameraAccessMode)
        ),
        domOverlayRoot: attempt.domOverlayRoot
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("WebXR requestSession failed.");
}

type CameraAccessMode = "required" | "optional";

function createWebXRSessionInit(
  domOverlayRoot: HTMLElement | null,
  cameraAccessMode: CameraAccessMode
): XRSessionInit {
  const requiredFeatures = ["hit-test"];
  const optionalFeatures = ["local-floor", "local"];

  if (cameraAccessMode === "required") {
    requiredFeatures.push("camera-access");
  } else {
    optionalFeatures.push("camera-access");
  }

  if (domOverlayRoot) {
    optionalFeatures.push("dom-overlay");
  }

  const sessionInit: XRSessionInit = {
    requiredFeatures,
    optionalFeatures
  };

  if (domOverlayRoot) {
    sessionInit.domOverlay = { root: domOverlayRoot };
  }

  return sessionInit;
}

function createWebXROverlayRoot() {
  removeWebXROverlayRoot();

  const root = document.createElement("div");
  root.id = WEBXR_DOM_OVERLAY_ROOT_ID;
  root.className = "webxr-dom-overlay-root";
  document.body.appendChild(root);

  return root;
}

function removeWebXROverlayRoot() {
  document.getElementById(WEBXR_DOM_OVERLAY_ROOT_ID)?.remove();
}

const WEBXR_DOM_OVERLAY_ROOT_ID = "webxr-dom-overlay-root";

function LoadingScreen() {
  return (
    <div className="screen-state" data-testid="loading-screen">
      <h2>Checking this device</h2>
      <p>Preparing the best available mobile AR path.</p>
    </div>
  );
}

function UnsupportedScreen({ osFamily }: { osFamily: CapabilityResult["osFamily"] }) {
  const message =
    osFamily === "ios"
      ? "Use iOS Safari on a camera-capable mobile device"
      : "To view and Use AR experience use a mobile device";

  return (
    <div className="desktop-fallback-screen" data-testid="unsupported-screen">
      <h1>{message}</h1>
    </div>
  );
}

function ReadyScreen({
  onStartAR,
  canAttemptWebXR,
  onStartWebXR
}: {
  onStartAR: () => void;
  canAttemptWebXR: boolean;
  onStartWebXR: () => void;
}) {
  return (
    <div className="home-ready-screen" data-testid="ready-screen">
      <button
        className="primary-action home-start-button"
        type="button"
        onClick={canAttemptWebXR ? onStartWebXR : onStartAR}
      >
        Start Experience
      </button>
    </div>
  );
}

function canAttemptWebXR(runtimeKind: ReturnType<typeof useSessionStore.getState>["runtimeKind"]) {
  return runtimeKind !== "image-tracking" && typeof navigator.xr?.requestSession === "function";
}

function createCameraError(message: string): UserFacingError {
  return {
    code: "camera-permission-denied",
    title: "Camera unavailable",
    message,
    recoverable: true
  };
}

function createWebXRError(message: string): UserFacingError {
  return {
    code: "runtime-start-failed",
    title: "WebXR unavailable",
    message,
    recoverable: true
  };
}

function createImageTrackingError(message: string): UserFacingError {
  return {
    code: "runtime-start-failed",
    title: "Image tracking unavailable",
    message,
    recoverable: true
  };
}

function ErrorScreen() {
  const error = useSessionStore((state) => state.error);
  const clearError = useSessionStore((state) => state.clearError);

  return (
    <div className="screen-state" role="alert" data-testid="error-screen">
      <h2>{error?.title ?? "Something went wrong"}</h2>
      <p>{error?.message ?? "Please refresh and try again."}</p>
      <button className="secondary-action" type="button" onClick={clearError}>
        Try again
      </button>
    </div>
  );
}
