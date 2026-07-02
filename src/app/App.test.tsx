import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "./App";
import { useSessionStore } from "../state/sessionStore";
import type { CapabilityResult } from "../services/capabilities";

vi.mock("../ar/WebXRSession", () => ({
  WebXRSession: ({ onEnd }: { onEnd: () => void }) => (
    <div data-testid="webxr-session">
      <button type="button" onClick={onEnd}>
        End XR
      </button>
    </div>
  )
}));

vi.mock("../ar/CameraARSession", () => ({
  CameraARSession: ({ onEnd }: { onEnd: () => void }) => (
    <div data-testid="camera-ar-session">
      <button type="button" onClick={onEnd}>
        End Camera
      </button>
    </div>
  )
}));

const mobileCameraCapabilities: CapabilityResult = {
  isMobile: true,
  webGL2Available: true,
  webAssemblyAvailable: true,
  cameraApiAvailable: true,
  webXRAvailable: false,
  immersiveARSupported: false,
  webXRHitTestLikelySupported: false,
  nativeShareAvailable: true,
  browserFamily: "safari",
  osFamily: "ios",
  runtimeRecommendation: "quick-look"
};

const androidCameraCapabilities: CapabilityResult = {
  ...mobileCameraCapabilities,
  browserFamily: "chrome",
  osFamily: "android",
  runtimeRecommendation: "camera-composition"
};

const mobileWebXRCapabilities: CapabilityResult = {
  ...mobileCameraCapabilities,
  webXRAvailable: true,
  immersiveARSupported: true,
  webXRHitTestLikelySupported: true,
  browserFamily: "chrome",
  osFamily: "android",
  runtimeRecommendation: "webxr"
};

const desktopUnsupportedCapabilities: CapabilityResult = {
  ...mobileCameraCapabilities,
  isMobile: false,
  browserFamily: "chrome",
  osFamily: "windows",
  runtimeRecommendation: "unsupported"
};

describe("App", () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  afterEach(() => {
    useSessionStore.getState().reset();
  });

  it("renders the mobile app shell after capability detection", async () => {
    const capabilities = createDeferred<CapabilityResult>();

    await act(async () => {
      render(<App detectCapabilitiesFn={() => capabilities.promise} />);
      await Promise.resolve();
    });

    expect(screen.getByTestId("loading-screen")).toBeInTheDocument();

    await act(async () => {
      capabilities.resolve(androidCameraCapabilities);
      await capabilities.promise;
      await Promise.resolve();
    });

    expect(await screen.findByTestId("ready-screen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Experience" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start AR Scanner" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Mascot Experience" })).not.toBeInTheDocument();
  });

  it("shows unsupported messaging for desktop production views", async () => {
    await renderAppWithCapabilities(desktopUnsupportedCapabilities);

    expect(await screen.findByTestId("unsupported-screen")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "To view and Use AR experience use a mobile device"
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Experience" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test" })).not.toBeInTheDocument();
  });

  it("shows the desktop fallback in development desktop views", async () => {
    await renderAppWithCapabilities(desktopUnsupportedCapabilities);

    expect(await screen.findByTestId("unsupported-screen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test" })).not.toBeInTheDocument();
  });

  it("moves Android camera fallback devices to ready state without starting camera permission", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });

    await renderAppWithCapabilities(androidCameraCapabilities);

    await waitFor(() => expect(screen.getByTestId("ready-screen")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Start Experience" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start AR Scanner" })).not.toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("renders the iOS Quick Look launcher from the ready screen", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    Object.defineProperty(globalThis.navigator, "xr", {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true
    });

    await renderAppWithCapabilities(mobileCameraCapabilities);

    const quickLookLink = await screen.findByRole("link", { name: "Start Experience" });

    expect(quickLookLink).toHaveAttribute("href", "/models/resilient_four.usdz");
    expect(quickLookLink).toHaveAttribute("rel", "ar");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.queryByTestId("camera-ar-session")).not.toBeInTheDocument();
    expect(screen.queryByTestId("webxr-session")).not.toBeInTheDocument();
  });

  it("starts WebXR from the ready screen without requesting camera fallback media", async () => {
    const getUserMedia = vi.fn();
    const requestSession = vi.fn().mockResolvedValue(new EventTarget());
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    Object.defineProperty(globalThis.navigator, "xr", {
      configurable: true,
      value: { requestSession }
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true
    });

    const user = userEvent.setup();
    await renderAppWithCapabilities(mobileWebXRCapabilities);

    await waitFor(() => expect(screen.getByTestId("ready-screen")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Start Experience" }));

    expect(requestSession).toHaveBeenCalledWith(
      "immersive-ar",
      expect.objectContaining({
        requiredFeatures: expect.arrayContaining(["hit-test", "camera-access"]),
        optionalFeatures: expect.arrayContaining(["local-floor", "local", "dom-overlay"]),
        domOverlay: expect.objectContaining({
          root: expect.objectContaining({ id: "webxr-dom-overlay-root" })
        })
      })
    );
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(await screen.findByTestId("webxr-session")).toBeInTheDocument();
  });

  it("allows a direct WebXR scanner attempt when capability detection recommended camera fallback", async () => {
    const getUserMedia = vi.fn();
    const requestSession = vi.fn().mockResolvedValue(new EventTarget());
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    Object.defineProperty(globalThis.navigator, "xr", {
      configurable: true,
      value: { requestSession }
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true
    });

    const user = userEvent.setup();
    await renderAppWithCapabilities(androidCameraCapabilities);

    await waitFor(() => expect(screen.getByTestId("ready-screen")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Start Experience" }));

    expect(requestSession).toHaveBeenCalledWith(
      "immersive-ar",
      expect.objectContaining({
        requiredFeatures: expect.arrayContaining(["hit-test", "camera-access"]),
        optionalFeatures: expect.arrayContaining(["dom-overlay"])
      })
    );
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(await screen.findByTestId("webxr-session")).toBeInTheDocument();
  });

  it("shows WebXR startup errors when immersive AR session creation fails", async () => {
    const requestSession = vi.fn().mockRejectedValue(new Error("session rejected"));
    Object.defineProperty(globalThis.navigator, "xr", {
      configurable: true,
      value: { requestSession }
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true
    });

    const user = userEvent.setup();
    await renderAppWithCapabilities(mobileWebXRCapabilities);

    await waitFor(() => expect(screen.getByTestId("ready-screen")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Start Experience" }));

    expect(requestSession).toHaveBeenCalledTimes(4);
    expect(requestSession).toHaveBeenCalledWith(
      "immersive-ar",
      expect.objectContaining({
        requiredFeatures: ["hit-test"],
        optionalFeatures: expect.arrayContaining(["local-floor", "local", "camera-access"])
      })
    );
    expect(await screen.findByTestId("error-screen")).toBeInTheDocument();
    expect(screen.getByText("WebXR unavailable")).toBeInTheDocument();
  });
});

async function renderAppWithCapabilities(capabilities: CapabilityResult) {
  const deferredCapabilities = createDeferred<CapabilityResult>();

  await act(async () => {
    render(<App detectCapabilitiesFn={() => deferredCapabilities.promise} />);
    await Promise.resolve();
  });

  await act(async () => {
    deferredCapabilities.resolve(capabilities);
    await deferredCapabilities.promise;
    await Promise.resolve();
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
