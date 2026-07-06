import type { CSSProperties, ReactNode } from "react";

import type { MascotId, MascotManifestEntry } from "../config/mascots";
import { downloadCapturedPhoto, type CapturedPhoto } from "./captureUtils";

type MascotButtonStyle = CSSProperties & {
  "--mascot-accent": string;
};

export interface MascotOverlayControlsProps {
  mascots: readonly MascotManifestEntry[];
  activeMascotId: MascotId;
  loadedMascotIds: readonly MascotId[];
  placedMascotIds: readonly MascotId[];
  /** Called for every mascot button press; the session decides between select and move. */
  onMascotButton: (mascotId: MascotId) => void;
  captureButtonLabel: string;
  captureDisabled: boolean;
  onCapture: () => void;
  captureWarnings?: readonly string[];
  capturedPhoto: CapturedPhoto | null;
  onRetake: () => void;
  children?: ReactNode;
}

/**
 * The in-session UI shared by the Android WebXR runtime and the iOS camera
 * runtime: mascot picker, capture button and captured-photo preview. Keeping
 * this shared guarantees the two platforms present an identical workflow.
 */
export function MascotOverlayControls({
  mascots,
  activeMascotId,
  loadedMascotIds,
  placedMascotIds,
  onMascotButton,
  captureButtonLabel,
  captureDisabled,
  onCapture,
  captureWarnings = [],
  capturedPhoto,
  onRetake,
  children
}: MascotOverlayControlsProps) {
  return (
    <div className="webxr-overlay-controls">
      {children}
      <div className="webxr-mascot-picker" aria-label="Mascots to place">
        {mascots.map((entry) => {
          const isLoaded = loadedMascotIds.includes(entry.id);
          const isPlaced = placedMascotIds.includes(entry.id);
          const isActive = activeMascotId === entry.id;

          return (
            <button
              key={entry.id}
              className="webxr-mascot-choice"
              type="button"
              aria-pressed={isActive}
              data-placed={isPlaced ? "true" : "false"}
              style={getMascotButtonStyle(entry.id)}
              disabled={!isLoaded}
              onClick={() => onMascotButton(entry.id)}
            >
              <span className="webxr-mascot-avatar" aria-hidden="true">
                <img src={entry.thumbnailUrl} alt="" draggable="false" />
              </span>
              <span>{entry.displayName}</span>
              <small>{getMascotButtonStatus(isLoaded, isPlaced, isActive)}</small>
            </button>
          );
        })}
      </div>
      <div className="webxr-capture-row">
        <button
          className="webxr-capture-button"
          type="button"
          disabled={captureDisabled}
          onClick={onCapture}
        >
          {captureButtonLabel}
        </button>
        {captureWarnings.map((warning) => (
          <p key={warning} className="webxr-capture-warning" role="status">
            {warning}
          </p>
        ))}
      </div>
      {capturedPhoto ? (
        <div className="webxr-capture-preview" role="dialog" aria-label="Captured photo preview">
          <div className="webxr-capture-preview-frame">
            <img src={capturedPhoto.url} alt="Captured AR frame preview" />
          </div>
          <div className="webxr-capture-actions">
            <button
              className="webxr-download-button"
              type="button"
              onClick={() => downloadCapturedPhoto(capturedPhoto)}
            >
              Download
            </button>
            <button className="webxr-retake-button" type="button" onClick={onRetake}>
              Retake
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type ScanStatus = "loading" | "scanning" | "surface-found" | "placed" | "error";

/** Shared status line so both runtimes guide the user with identical wording. */
export function getScanHint(status: ScanStatus, allPlaced: boolean, activeMascotName: string) {
  if (status === "loading") {
    return "Loading mascots...";
  }
  if (status === "error") {
    return "The AR experience could not start.";
  }
  if (allPlaced) {
    return "All mascots placed. Capture a photo!";
  }
  if (status === "surface-found") {
    return `Tap the floor to place ${activeMascotName}.`;
  }
  return "Move your phone and point the camera at the floor.";
}

function getMascotButtonStatus(isLoaded: boolean, isPlaced: boolean, isActive: boolean) {
  if (isPlaced) {
    return "Move";
  }
  if (!isLoaded) {
    return "Loading";
  }
  return isActive ? "Tap floor" : "Select";
}

function getMascotButtonStyle(mascotId: MascotId): MascotButtonStyle {
  return {
    "--mascot-accent": getMascotAccentColor(mascotId)
  } as MascotButtonStyle;
}

function getMascotAccentColor(mascotId: MascotId) {
  switch (mascotId) {
    case "mascot-alpha":
      return "#ff8a1c";
    case "mascot-amihan":
      return "#62cfff";
    case "mascot-ulan":
      return "#1d4ed8";
    case "mascot-apoy":
      return "#ef4444";
  }
}
