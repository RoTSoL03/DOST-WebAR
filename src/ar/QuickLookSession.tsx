import { useState, type CSSProperties } from "react";

import type { MascotId, MascotManifestEntry } from "../config/mascots";

interface QuickLookSessionProps {
  mascots: readonly MascotManifestEntry[];
  onEnd: () => void;
}

type MascotButtonStyle = CSSProperties & {
  "--mascot-accent": string;
};

export function QuickLookSession({ mascots, onEnd }: QuickLookSessionProps) {
  const [activeMascotId, setActiveMascotId] = useState<MascotId>(() => getInitialMascotId(mascots));
  const [launchedMascotIds, setLaunchedMascotIds] = useState<MascotId[]>([]);

  const handleMascotLaunch = (mascotId: MascotId) => {
    const nextLaunchedIds = launchedMascotIds.includes(mascotId)
      ? launchedMascotIds
      : [...launchedMascotIds, mascotId];

    setLaunchedMascotIds(nextLaunchedIds);
    setActiveMascotId(getNextMascotId(mascots, nextLaunchedIds, mascotId));
  };

  return (
    <section className="quick-look-session" data-testid="quick-look-session">
      <div className="quick-look-stage" aria-hidden="true" />
      <div className="webxr-overlay-controls quick-look-controls">
        <button className="camera-end-button" type="button" onClick={onEnd}>
          End
        </button>
        <div className="webxr-mascot-picker quick-look-mascot-picker" aria-label="Mascots to open in AR">
          {mascots.map((entry) => {
            const isActive = activeMascotId === entry.id;
            const wasLaunched = launchedMascotIds.includes(entry.id);

            return (
              <a
                key={entry.id}
                className="webxr-mascot-choice quick-look-mascot-choice"
                href={entry.quickLookUrl}
                rel="ar"
                data-active={isActive ? "true" : "false"}
                data-placed={wasLaunched ? "true" : "false"}
                style={getMascotButtonStyle(entry.id)}
                onClick={() => handleMascotLaunch(entry.id)}
              >
                <img
                  className="quick-look-ar-preview"
                  src={entry.thumbnailUrl}
                  alt=""
                  draggable="false"
                />
                <span className="webxr-mascot-avatar" aria-hidden="true">
                  <img src={entry.thumbnailUrl} alt="" draggable="false" />
                </span>
                <span>{entry.displayName}</span>
                <small>{wasLaunched ? "Open again" : "Open AR"}</small>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function getInitialMascotId(mascots: readonly MascotManifestEntry[]) {
  const mascot = mascots[0];

  if (!mascot) {
    throw new Error("At least one mascot must be configured.");
  }

  return mascot.id;
}

function getNextMascotId(
  mascots: readonly MascotManifestEntry[],
  launchedMascotIds: readonly MascotId[],
  currentMascotId: MascotId
) {
  const nextMascot = mascots.find(
    (candidate) => candidate.id !== currentMascotId && !launchedMascotIds.includes(candidate.id)
  );

  return nextMascot?.id ?? currentMascotId;
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
