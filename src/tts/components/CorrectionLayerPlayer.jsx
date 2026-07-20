import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildTimelineMarks,
  buildWaveformPeaks,
  clientXToTrackRatio,
  formatTimeShort,
  formatTimelineLabel,
  trackPositionCssLeft,
} from "../utils/waveform.js";

function IconPlay() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
    </svg>
  );
}

export default function CorrectionLayerPlayer({ blob, mimeType = "audio/wav" }) {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const waveWrapRef = useRef(null);
  const peaksRef = useRef([]);
  const durationRef = useRef(0);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loadingWave, setLoadingWave] = useState(false);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const marks = useMemo(() => buildTimelineMarks(duration, 14), [duration]);
  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  const drawWaveform = useCallback((prog = 0) => {
    const canvas = canvasRef.current;
    const wrap = waveWrapRef.current;
    if (!canvas || !wrap) return;

    const peaks = peaksRef.current;
    const dpr = window.devicePixelRatio || 1;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (width <= 0 || height <= 0) return;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const mid = height / 2;
    const barWidth = peaks.length ? width / peaks.length : width;
    const playedX = width * Math.min(1, Math.max(0, prog));

    peaks.forEach((peak, i) => {
      const barH = Math.max(2, peak * (height * 0.82));
      const x = i * barWidth + barWidth * 0.1;
      const w = Math.max(1.2, barWidth * 0.8);
      const isPlayed = x + w <= playedX;
      ctx.fillStyle = isPlayed ? "rgba(9, 50, 132, 0.55)" : "rgba(148, 163, 184, 0.65)";
      ctx.fillRect(x, mid - barH / 2, w, barH);
    });
  }, []);

  useEffect(() => {
    if (!blob) {
      peaksRef.current = [];
      setDuration(0);
      setCurrentTime(0);
      setPlaying(false);
      return undefined;
    }

    const url = URL.createObjectURL(blob);
    const audio = audioRef.current;
    if (audio) {
      audio.src = url;
      audio.load();
    }

    let cancelled = false;
    setLoadingWave(true);
    buildWaveformPeaks(blob, 120)
      .then(({ peaks, duration: d }) => {
        if (cancelled) return;
        peaksRef.current = peaks;
        if (Number.isFinite(d) && d > 0) {
          durationRef.current = d;
          setDuration(d);
        }
        drawWaveform(0);
      })
      .catch(() => {
        if (!cancelled) peaksRef.current = [];
      })
      .finally(() => {
        if (!cancelled) setLoadingWave(false);
      });

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [blob, drawWaveform]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        durationRef.current = audio.duration;
        setDuration(audio.duration);
        setLoadingWave(false);
        drawWaveform(0);
      }
    };
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      const p = audio.duration ? audio.currentTime / audio.duration : 0;
      drawWaveform(p);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(audio.duration || 0);
    };

    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [blob, drawWaveform]);

  useEffect(() => {
    if (!waveWrapRef.current) return undefined;
    const observer = new ResizeObserver(() => {
      const p = duration ? currentTime / duration : 0;
      drawWaveform(p);
    });
    observer.observe(waveWrapRef.current);
    return () => observer.disconnect();
  }, [currentTime, duration, drawWaveform]);

  if (!blob) return null;

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        /* ignore */
      }
    } else {
      audio.pause();
    }
  };

  const seekToRatio = (ratio) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    const next = Math.min(audio.duration, Math.max(0, ratio * audio.duration));
    audio.currentTime = next;
    setCurrentTime(next);
    drawWaveform(next / audio.duration);
  };

  const onTrackClick = (e) => {
    seekToRatio(clientXToTrackRatio(e.clientX, e.currentTarget));
  };

  return (
    <div className="correction-strip">
      <audio ref={audioRef} className="audio-element-hidden" preload="metadata">
        <source type={mimeType} />
      </audio>

      <div className="correction-strip-left">
        <button
          type="button"
          className="correction-strip-play"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <input
          type="range"
          className="correction-strip-seek"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={(e) => seekToRatio(Number(e.target.value) / 1000)}
          aria-label="Seek"
          style={{ "--seek-pct": `${progress * 100}%` }}
        />
        <div className="correction-strip-times">
          <span>{formatTimeShort(currentTime)}</span>
          <span>{formatTimeShort(duration)}</span>
        </div>
      </div>

      <div className="correction-strip-divider" aria-hidden />

      <div className="correction-strip-right">
        <div
          className="correction-strip-scale"
          onClick={onTrackClick}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") seekToRatio(progress + 0.02);
            if (e.key === "ArrowLeft") seekToRatio(progress - 0.02);
          }}
          role="slider"
          tabIndex={0}
          aria-label="Timeline"
          aria-valuenow={currentTime}
          aria-valuemin={0}
          aria-valuemax={duration}
        >
          <div className="correction-strip-rail">
            {marks.map((sec, i) => {
              const isStart = i === 0;
              const isEnd = i === marks.length - 1;
              return (
                <span
                  key={`${sec}-${i}`}
                  className={`correction-strip-mark${isStart ? " is-start" : ""}${isEnd ? " is-end" : ""}`}
                  style={{ left: trackPositionCssLeft(duration ? sec / duration : 0) }}
                >
                  <span className="correction-strip-mark-label">{formatTimelineLabel(sec)}</span>
                  <span className="correction-strip-mark-tick" />
                </span>
              );
            })}
            <div className="correction-strip-subticks" aria-hidden />
          </div>
        </div>
        <div
          ref={waveWrapRef}
          className="correction-strip-wave"
          onClick={onTrackClick}
          role="presentation"
        >
          <canvas ref={canvasRef} className="correction-strip-canvas" />
          {loadingWave && <span className="correction-strip-loading">…</span>}
        </div>
        <div
          className="correction-strip-playhead"
          style={{ left: trackPositionCssLeft(progress) }}
          aria-hidden
        />
      </div>
    </div>
  );
}
