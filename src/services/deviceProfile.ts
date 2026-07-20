export type DeviceTier = "high" | "mid" | "low";

export interface QualityProfile {
  tier: DeviceTier;
  /** Upper bound applied to window.devicePixelRatio for 2D canvas rendering. */
  maxPixelRatio: number;
  /** Whether MSAA is worth its cost on this device. */
  antialias: boolean;
  /** WebXR framebuffer scale factor (1 = native XR resolution). */
  xrFramebufferScale: number;
  /** How many scanned-surface indicator patches may exist at once. */
  maxScannedSurfacePatches: number;
  /** Minimum interval between spawning new scanned-surface patches. */
  surfaceSampleIntervalMs: number;
}

export interface DeviceProfileEnvironment {
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
  gpuRendererString?: string | null;
}

const QUALITY_PROFILES: Record<DeviceTier, QualityProfile> = {
  high: {
    tier: "high",
    maxPixelRatio: 1.5,
    antialias: true,
    xrFramebufferScale: 0.85,
    maxScannedSurfacePatches: 10,
    surfaceSampleIntervalMs: 280
  },
  mid: {
    tier: "mid",
    maxPixelRatio: 1.25,
    antialias: false,
    xrFramebufferScale: 0.7,
    maxScannedSurfacePatches: 6,
    surfaceSampleIntervalMs: 380
  },
  low: {
    tier: "low",
    maxPixelRatio: 1,
    antialias: false,
    xrFramebufferScale: 0.55,
    maxScannedSurfacePatches: 4,
    surfaceSampleIntervalMs: 500
  }
};

export function classifyDeviceTier(environment: DeviceProfileEnvironment): DeviceTier {
  const memoryGb = environment.deviceMemoryGb ?? 4;
  const cores = environment.hardwareConcurrency ?? 4;
  const gpu = (environment.gpuRendererString ?? "").toLowerCase();

  // Older mobile GPU families that struggle with full-resolution AR rendering.
  const isLowEndGpu = /adreno \(tm\) [345]\d\d|adreno [345]\d\d|mali-4\d\d|mali-t\d\d|powervr/.test(
    gpu
  );
  const isHighEndGpu =
    /adreno \(tm\) 7|adreno 7|adreno \(tm\) 6[6-9]|immortalis|mali-g7|apple/.test(gpu);

  let score = 0;

  if (memoryGb >= 6) {
    score += 2;
  } else if (memoryGb >= 4) {
    score += 1;
  }

  if (cores >= 8) {
    score += 2;
  } else if (cores >= 6) {
    score += 1;
  }

  if (isHighEndGpu) {
    score += 2;
  }

  if (isLowEndGpu) {
    score -= 3;
  }

  if (score >= 4) {
    return "high";
  }

  if (score >= 2) {
    return "mid";
  }

  return "low";
}

export function getQualityProfile(tier: DeviceTier): QualityProfile {
  return QUALITY_PROFILES[tier];
}

let cachedProfile: QualityProfile | null = null;

/**
 * Detects the current device's capability tier once per page load and returns
 * the rendering quality settings for it.
 */
export function resolveQualityProfile(): QualityProfile {
  if (cachedProfile) {
    return cachedProfile;
  }

  const nav = globalThis.navigator as Navigator & { deviceMemory?: number };
  cachedProfile = getQualityProfile(
    classifyDeviceTier({
      deviceMemoryGb: nav?.deviceMemory,
      hardwareConcurrency: nav?.hardwareConcurrency,
      gpuRendererString: detectGpuRendererString()
    })
  );

  return cachedProfile;
}

function detectGpuRendererString(): string | null {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");

    if (!gl) {
      return null;
    }

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo
      ? (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string)
      : (gl.getParameter(gl.RENDERER) as string);

    gl.getExtension("WEBGL_lose_context")?.loseContext();

    return typeof renderer === "string" ? renderer : null;
  } catch {
    return null;
  }
}
