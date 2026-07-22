import { useEffect, useRef, useState } from "react";
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
  waveColor = "#64748b",
  progressColor = "#2563eb",
  className = "",
  showTime = true,
}) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);

  useEffect(() => {
    let url = null;
    if (blob) {
      url = URL.createObjectURL(blob);
    } else if (src) {
      url = src;
    }

    setAudioUrl(url);
    setReady(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    return () => {
      if (blob && url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [src, blob]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !ready) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch((err) => console.warn("Audio play failed:", err));
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration || 0);
      setReady(true);
    }
  };

  const handleEnded = () => {
    setPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  return (
    <div className={`history-waveform-cell ${className}`.trim()}>
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />
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
      <div className="history-waveform-track">
        <input
          type="range"
          className="history-waveform-range"
          min="0"
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          disabled={!ready}
          style={{
            width: "100%",
            cursor: ready ? "pointer" : "default",
            accentColor: progressColor,
          }}
        />
      </div>
      {showTime && (
        <span className="history-waveform-time">
          {formatTimeShort(currentTime)} / {formatTimeShort(duration)}
        </span>
      )}
    </div>
  );
}

