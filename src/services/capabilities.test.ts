import { detectCapabilities, recommendRuntime, type CapabilityResult } from "./capabilities";

function createDocumentWithWebGL2(available: boolean): Document {
  return {
    createElement: vi.fn(() => ({
      getContext: vi.fn((contextId: string) => (available && contextId === "webgl2" ? {} : null))
    }))
  } as unknown as Document;
}

function createMatchMedia(matches = true): Window["matchMedia"] {
  return vi.fn().mockReturnValue({ matches }) as unknown as Window["matchMedia"];
}

describe("detectCapabilities", () => {
  it("recommends WebXR when mobile WebXR AR support is available", async () => {
    const getUserMedia = vi.fn();
    const isSessionSupported = vi.fn().mockResolvedValue(true);

    const result = await detectCapabilities({
      document: createDocumentWithWebGL2(true),
      matchMedia: createMatchMedia(true),
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36",
      navigator: {
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36",
        mediaDevices: { getUserMedia },
        xr: { isSessionSupported }
      } as unknown as Navigator
    });

    expect(result.runtimeRecommendation).toBe("webxr");
    expect(result.immersiveARSupported).toBe(true);
    expect(isSessionSupported).toHaveBeenCalledWith("immersive-ar");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("recommends unsupported on iOS while the prototype is Android-only", async () => {
    const getUserMedia = vi.fn();

    const result = await detectCapabilities({
      document: createDocumentWithWebGL2(true),
      matchMedia: createMatchMedia(true),
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
      navigator: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
        mediaDevices: { getUserMedia }
      } as unknown as Navigator
    });

    expect(result.runtimeRecommendation).toBe("unsupported");
    expect(result.webXRAvailable).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("recommends camera composition on Android when WebXR AR is unavailable but camera API exists", async () => {
    const getUserMedia = vi.fn();

    const result = await detectCapabilities({
      document: createDocumentWithWebGL2(true),
      matchMedia: createMatchMedia(true),
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36",
      navigator: {
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36",
        mediaDevices: { getUserMedia }
      } as unknown as Navigator
    });

    expect(result.runtimeRecommendation).toBe("camera-composition");
    expect(result.webXRAvailable).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("recommends unsupported for desktop production capability paths", async () => {
    const result = await detectCapabilities({
      document: createDocumentWithWebGL2(true),
      matchMedia: createMatchMedia(false),
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125",
      navigator: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125",
        mediaDevices: { getUserMedia: vi.fn() }
      } as unknown as Navigator
    });

    expect(result.isMobile).toBe(false);
    expect(result.runtimeRecommendation).toBe("unsupported");
  });
});

describe("recommendRuntime", () => {
  const baseCapabilities: Omit<CapabilityResult, "runtimeRecommendation"> = {
    isMobile: true,
    webGL2Available: true,
    webAssemblyAvailable: true,
    cameraApiAvailable: true,
    webXRAvailable: false,
    immersiveARSupported: false,
    webXRHitTestLikelySupported: false,
    nativeShareAvailable: false,
    browserFamily: "safari",
    osFamily: "ios"
  };

  it("keeps unsupported when required graphics foundations are missing", () => {
    expect(recommendRuntime({ ...baseCapabilities, webGL2Available: false })).toBe("unsupported");
    expect(recommendRuntime({ ...baseCapabilities, webAssemblyAvailable: false })).toBe(
      "unsupported"
    );
  });
});
