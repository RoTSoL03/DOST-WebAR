import { useSessionStore } from "./sessionStore";
import type { CapabilityResult } from "../services/capabilities";
import type { UserFacingError } from "../errors/userFacingError";

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
  runtimeRecommendation: "camera-composition"
};

describe("useSessionStore", () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  afterEach(() => {
    useSessionStore.getState().reset();
  });

  it("moves from capability checking to the scanner start screen with a runtime recommendation", () => {
    useSessionStore.getState().beginCapabilityCheck();
    expect(useSessionStore.getState().sessionStatus).toBe("checkingCapabilities");
    expect(useSessionStore.getState().loading.kind).toBe("capabilities");

    useSessionStore.getState().applyCapabilities(mobileCameraCapabilities);

    expect(useSessionStore.getState().sessionStatus).toBe("readyToStart");
    expect(useSessionStore.getState().runtimeKind).toBe("camera-composition");
    expect(useSessionStore.getState().loading.kind).toBe("idle");
  });

  it("models mascot loading and ready state explicitly", () => {
    useSessionStore.getState().selectMascot("mascot-alpha");

    expect(useSessionStore.getState().selectedMascotId).toBe("mascot-alpha");
    expect(useSessionStore.getState().sessionStatus).toBe("loadingMascot");
    expect(useSessionStore.getState().loading.kind).toBe("mascot");

    useSessionStore.getState().markMascotLoaded();

    expect(useSessionStore.getState().sessionStatus).toBe("readyToStart");
    expect(useSessionStore.getState().loading.progress).toBe(1);
  });

  it("resets errors without preserving failed capture state", () => {
    const error: UserFacingError = {
      code: "runtime-start-failed",
      title: "Runtime failed",
      message: "Try again.",
      recoverable: true
    };

    useSessionStore.getState().setError(error);
    expect(useSessionStore.getState().sessionStatus).toBe("error");
    expect(useSessionStore.getState().captureStatus).toBe("failed");

    useSessionStore.getState().clearError();

    expect(useSessionStore.getState().error).toBeNull();
    expect(useSessionStore.getState().sessionStatus).toBe("idle");
    expect(useSessionStore.getState().captureStatus).toBe("idle");
  });

  it("uses unsupported session status when no runtime is available", () => {
    useSessionStore.getState().applyCapabilities({
      ...mobileCameraCapabilities,
      cameraApiAvailable: false,
      runtimeRecommendation: "unsupported"
    });

    expect(useSessionStore.getState().sessionStatus).toBe("unsupported");
    expect(useSessionStore.getState().runtimeKind).toBeNull();
  });

  it("returns to the scanner start screen after a runtime session ends", () => {
    useSessionStore.getState().applyCapabilities(mobileCameraCapabilities);
    useSessionStore.getState().requestPermission();
    useSessionStore.getState().startRuntime();

    useSessionStore.getState().endSession();

    expect(useSessionStore.getState().sessionStatus).toBe("readyToStart");
    expect(useSessionStore.getState().selectedMascotId).toBeNull();
  });
});
