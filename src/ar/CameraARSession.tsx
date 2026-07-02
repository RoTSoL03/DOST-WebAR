import { useEffect, useRef, useState } from "react";

import type { MascotManifestEntry } from "../config/mascots";

interface CameraARSessionProps {
  mascot: MascotManifestEntry;
  stream: MediaStream;
  onEnd: () => void;
}

export function CameraARSession({ mascot, stream, onEnd }: CameraARSessionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<"loading" | "preview" | "error">("loading");

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.srcObject = stream;
    video.setAttribute("playsinline", "true");

    void video
      .play()
      .then(() => setStatus("preview"))
      .catch(() => setStatus("error"));

    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <section className="camera-ar-session" data-testid="camera-ar-session">
      <video
        ref={videoRef}
        className="camera-feed"
        aria-label={`${mascot.displayName} camera preview`}
        autoPlay
        muted
        playsInline
      />
      <div className="camera-ar-hud">
        <p role="status">
          {status === "loading" ? "Starting camera preview..." : null}
          {status === "preview"
            ? "Camera preview only. AR floor scanning requires WebXR on Android Chrome."
            : null}
          {status === "error" ? "Camera preview could not start on this browser." : null}
        </p>
        <button className="secondary-action" type="button" onClick={onEnd}>
          End
        </button>
      </div>
    </section>
  );
}
