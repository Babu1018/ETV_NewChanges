import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { formatTimeShort } from "../utils/waveform.js";

function IconPlay() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
    </svg>
  );
}

export default function WaveformInlinePlayer({
  src,
  blob,
  height = 32,
  waveColor = "#a3a3a3",
  progressColor = "#18181b",
  className = "",
  showTime = true,
}) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height,
      waveColor,
      progressColor,
      cursorColor: "transparent",
      cursorWidth: 0,
      barWidth: 3,
      barGap: 3,
      barRadius: 3,
      normalize: true,
      dragToSeek: true,
      interact: true,
    });

    wavesurferRef.current = ws;

    ws.on("ready", () => {
      setDuration(ws.getDuration());
      setReady(true);
    });
    ws.on("timeupdate", (t) => setCurrentTime(t));
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => {
      setPlaying(false);
      setCurrentTime(0);
    });

    return () => {
      ws.destroy();
      wavesurferRef.current = null;
      setReady(false);
    };
  }, [height, waveColor, progressColor]);

  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;

    setReady(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    if (blob) {
      void ws.loadBlob(blob);
    } else if (src) {
      void ws.load(src);
    }
  }, [src, blob]);

  const togglePlay = () => {
    const ws = wavesurferRef.current;
    if (!ws || !ready) return;
    ws.playPause();
  };

  return (
    <div className={`history-waveform-cell ${className}`.trim()}>
      <button
        type="button"
        className="history-waveform-play-btn"
        onClick={togglePlay}
        disabled={!ready}
        aria-label={playing ? "Pause audio" : "Play audio"}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? <IconPause /> : <IconPlay />}
      </button>
      <div className="history-waveform-track" ref={containerRef} />
      {showTime && (
        <span className="history-waveform-time">
          {formatTimeShort(currentTime)} / {formatTimeShort(duration)}
        </span>
      )}
    </div>
  );
}
