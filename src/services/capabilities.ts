import type { RuntimeKind } from "../config/runtime";

type BrowserFamily = "chrome" | "safari" | "edge" | "samsung-internet" | "firefox" | "unknown";
type OsFamily = "android" | "ios" | "windows" | "macos" | "linux" | "unknown";

interface BrowserNavigator {
  userAgent?: string;
  mediaDevices?: {
    getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  };
  share?: (data?: ShareData) => Promise<void>;
  xr?: {
    isSessionSupported?: (mode: "immersive-ar") => Promise<boolean>;
  };
  userAgentData?: {
    mobile?: boolean;
  };
}

export interface CapabilityResult {
  isMobile: boolean;
  webGL2Available: boolean;
  webAssemblyAvailable: boolean;
  cameraApiAvailable: boolean;
  webXRAvailable: boolean;
  immersiveARSupported: boolean;
  webXRHitTestLikelySupported: boolean;
  nativeShareAvailable: boolean;
  browserFamily: BrowserFamily;
  osFamily: OsFamily;
  runtimeRecommendation: RuntimeKind;
}

export interface CapabilityDetectionEnvironment {
  document: Document;
  navigator: BrowserNavigator;
  userAgent: string;
  matchMedia?: Window["matchMedia"];
  webAssembly?: typeof WebAssembly;
}

export async function detectCapabilities(
  environment: Partial<CapabilityDetectionEnvironment> = {}
): Promise<CapabilityResult> {
  const nav = environment.navigator ?? (globalThis.navigator as BrowserNavigator);
  const userAgent = environment.userAgent ?? nav.userAgent ?? "";
  const doc = environment.document ?? globalThis.document;
  const matchMedia = environment.matchMedia ?? globalThis.matchMedia?.bind(globalThis);
  const webAssembly = environment.webAssembly ?? globalThis.WebAssembly;

  const isMobile = detectMobile(nav, userAgent, matchMedia);
  const webGL2Available = detectWebGL2(doc);
  const webAssemblyAvailable =
    typeof webAssembly === "object" && typeof webAssembly.instantiate === "function";
  const cameraApiAvailable = typeof nav.mediaDevices?.getUserMedia === "function";
  const webXRAvailable = typeof nav.xr?.isSessionSupported === "function";
  const immersiveARSupported = webXRAvailable
    ? await safeImmersiveArCheck(nav.xr?.isSessionSupported)
    : false;

  const resultWithoutRecommendation = {
    isMobile,
    webGL2Available,
    webAssemblyAvailable,
    cameraApiAvailable,
    webXRAvailable,
    immersiveARSupported,
    webXRHitTestLikelySupported: immersiveARSupported,
    nativeShareAvailable: typeof nav.share === "function",
    browserFamily: detectBrowserFamily(userAgent),
    osFamily: detectOsFamily(userAgent)
  };

  return {
    ...resultWithoutRecommendation,
    runtimeRecommendation: recommendRuntime(resultWithoutRecommendation)
  };
}

export function recommendRuntime(
  capabilities: Omit<CapabilityResult, "runtimeRecommendation">
): RuntimeKind {
  if (
    !capabilities.isMobile ||
    !capabilities.webGL2Available ||
    !capabilities.webAssemblyAvailable
  ) {
    return "unsupported";
  }

  if (capabilities.immersiveARSupported && capabilities.webXRHitTestLikelySupported) {
    return "webxr";
  }

  if (capabilities.osFamily === "ios") {
    return "quick-look";
  }

  if (capabilities.cameraApiAvailable) {
    return "camera-composition";
  }

  return "unsupported";
}

function detectMobile(
  navigatorRef: BrowserNavigator,
  userAgent: string,
  matchMedia?: Window["matchMedia"]
): boolean {
  if (typeof navigatorRef.userAgentData?.mobile === "boolean") {
    return navigatorRef.userAgentData.mobile;
  }

  const coarsePointer = matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const narrowViewport = matchMedia?.("(max-width: 768px)")?.matches ?? false;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);

  return mobileUA || (coarsePointer && narrowViewport);
}

function detectWebGL2(documentRef: Document): boolean {
  try {
    const canvas = documentRef.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

async function safeImmersiveArCheck(
  isSessionSupported?: (mode: "immersive-ar") => Promise<boolean>
): Promise<boolean> {
  if (!isSessionSupported) {
    return false;
  }

  try {
    return await isSessionSupported("immersive-ar");
  } catch {
    return false;
  }
}

function detectBrowserFamily(userAgent: string): BrowserFamily {
  if (/SamsungBrowser/i.test(userAgent)) {
    return "samsung-internet";
  }
  if (/EdgA?|EdgiOS/i.test(userAgent)) {
    return "edge";
  }
  if (/Firefox|FxiOS/i.test(userAgent)) {
    return "firefox";
  }
  if (/Chrome|CriOS/i.test(userAgent)) {
    return "chrome";
  }
  if (/Safari/i.test(userAgent)) {
    return "safari";
  }
  return "unknown";
}

function detectOsFamily(userAgent: string): OsFamily {
  if (/Android/i.test(userAgent)) {
    return "android";
  }
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return "ios";
  }
  if (/Windows/i.test(userAgent)) {
    return "windows";
  }
  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return "macos";
  }
  if (/Linux/i.test(userAgent)) {
    return "linux";
  }
  return "unknown";
}
