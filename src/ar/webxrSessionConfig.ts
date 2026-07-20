export type CameraAccessMode = "required" | "optional";

export function createWebXRSessionInit(
  domOverlayRoot: HTMLElement | null,
  cameraAccessMode: CameraAccessMode
): XRSessionInit {
  const requiredFeatures = ["hit-test"];
  const optionalFeatures = [
    "local-floor",
    "local",
    "anchors",
    "depth-sensing"
  ];

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
    optionalFeatures,
    // CPU depth is deliberately preferred here. Three.js can consume it as a
    // regular DataTexture without taking ownership of an XR-runtime WebGL
    // texture, and the low-resolution ARCore depth map is inexpensive to upload.
    depthSensing: {
      usagePreference: ["cpu-optimized", "gpu-optimized"],
      dataFormatPreference: ["float32", "luminance-alpha", "unsigned-short"],
      depthTypeRequest: ["smooth", "raw"],
      matchDepthView: true
    }
  };

  if (domOverlayRoot) {
    sessionInit.domOverlay = { root: domOverlayRoot };
  }

  return sessionInit;
}
