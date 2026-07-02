export type RuntimeKind = "webxr" | "quick-look" | "camera-composition" | "unsupported";

export const SESSION_STATUSES = [
  "idle",
  "checkingCapabilities",
  "selectingMascot",
  "loadingMascot",
  "readyToStart",
  "requestingPermission",
  "startingRuntime",
  "detectingSurface",
  "placingMascot",
  "mascotPlaced",
  "capturing",
  "captureReady",
  "ending",
  "error",
  "unsupported"
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];
