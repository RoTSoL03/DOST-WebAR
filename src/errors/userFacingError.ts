export type UserFacingErrorCode =
  | "desktop-unsupported"
  | "browser-unsupported"
  | "capability-check-failed"
  | "camera-permission-denied"
  | "runtime-start-failed"
  | "asset-load-failed"
  | "capture-failed"
  | "offline-asset-unavailable";

export interface UserFacingError {
  code: UserFacingErrorCode;
  title: string;
  message: string;
  recoverable: boolean;
}

export function createCapabilityCheckError(): UserFacingError {
  return {
    code: "capability-check-failed",
    title: "Compatibility check failed",
    message: "Refresh the page or try a supported mobile browser.",
    recoverable: true
  };
}
