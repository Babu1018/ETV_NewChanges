import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import Timeline from "wavesurfer.js/dist/plugins/timeline.esm.js";
import Regions from "wavesurfer.js/dist/plugins/regions.esm.js";
import AudioAddMenu from "./AudioAddMenu.jsx";
import {
  clampSelectionRange,
  formatTimeShort,
  minSelectionSpanSec,
} from "../utils/waveform.js";

const ZOOM_MIN_PX_PER_SEC = [20, 35, 55, 80, 120, 180, 260];

function IconZoomIn() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
    </svg>
  );
}

function IconZoomOut() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M8 11h6" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
    </svg>
  );
}

function IconRestart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="4" y="6" width="3" height="12" rx="1" />
      <path d="M11 6v12l9-6-9-6z" />
    </svg>
  );
}

const REGION_COLOR = "rgba(14, 165, 233, 0.28)";

export default function AudioPlayer({
  blob,
  mimeType = "audio/wav",
  onAddAudio,
  variant = "studio",
  editMode = false,
  selectionSec = null,
  onSelectionSecChange,
  showAddMenu = false,
  addMenuOpen = false,
  onAddMenuToggle,
  onAddMenuUpload,
  onAddMenuRecord,
  onDurationChange,
  onTimeUpdate,
  onPlayStateChange,
}) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const regionsRef = useRef(null);
  const dragSelectDisableRef = useRef(null);
  const selectionSyncRef = useRef(false);
  const editModeRef = useRef(editMode);
  const onSelectionRef = useRef(onSelectionSecChange);

  const addWrapRef = useRef(null);
  const zoomIndexRef = useRef(0);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onDurationChangeRef = useRef(onDurationChange);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loadingWave, setLoadingWave] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    zoomIndexRef.current = zoomIndex;
  }, [zoomIndex]);

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    onDurationChangeRef.current = onDurationChange;
  }, [onDurationChange]);

  const emitTime = useCallback((t) => {
    setCurrentTime(t);
    onTimeUpdateRef.current?.(t);
  }, []);

  const isStudio = variant === "studio";
  const waveHeight = isStudio ? 330 : 96;
  const timelineHeight = isStudio ? 22 : 18;

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  useEffect(() => {
    onSelectionRef.current = onSelectionSecChange;
  }, [onSelectionSecChange]);

  const applyZoom = useCallback((index) => {
    const ws = wavesurferRef.current;
    if (!ws) return false;
    const d = ws.getDuration();
    if (!Number.isFinite(d) || d <= 0) return false;
    const px = ZOOM_MIN_PX_PER_SEC[Math.max(0, Math.min(ZOOM_MIN_PX_PER_SEC.length - 1, index))];
    try {
      ws.zoom(px);
      return true;
    } catch {
      return false;
    }
  }, []);

  const emitSelection = useCallback((start, end) => {
    const ws = wavesurferRef.current;
    const d = ws?.getDuration?.() ?? 0;
    if (!d || !onSelectionRef.current) return;
    selectionSyncRef.current = true;
    onSelectionRef.current(clampSelectionRange(start, end, d));
    requestAnimationFrame(() => {
      selectionSyncRef.current = false;
    });
  }, []);

  const upsertSelectionRegion = useCallback((startSec, endSec) => {
    const regions = regionsRef.current;
    const ws = wavesurferRef.current;
    if (!regions || !ws) return;
    const d = ws.getDuration();
    if (!d || endSec <= startSec) return;

    const { startSec: start, endSec: end } = clampSelectionRange(startSec, endSec, d);
    const existing = regions.getRegions();
    if (existing.length === 1) {
      const r = existing[0];
      if (Math.abs(r.start - start) < 0.005 && Math.abs(r.end - end) < 0.005) return;
      r.setOptions({ start, end });
      return;
    }
    regions.clearRegions();
    regions.addRegion({
      start,
      end,
      color: REGION_COLOR,
      drag: false,
      resize: true,
      minLength: minSelectionSpanSec(d),
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const regions = Regions.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: waveHeight,
      waveColor: isStudio ? "#94a3b8" : "rgba(100, 116, 139, 0.45)",
      progressColor: isStudio ? "#093181" : "rgba(59, 130, 246, 0.55)",
      cursorColor: isStudio ? "#093181" : "#2563eb",
      cursorWidth: 2,
      normalize: true,
      dragToSeek: true,
      interact: true,
      plugins: [
        Timeline.create({
          height: timelineHeight,
          insertPosition: "beforebegin",
          timeInterval: 0.25,
          primaryLabelInterval: 5,
          secondaryLabelInterval: 1,
          style: {
            fontSize: "11px",
            color: isStudio ? "#64748b" : "rgba(71, 85, 105, 0.75)",
            backgroundColor: isStudio ? "#f8fafc" : "#F5F5F5",
          },
        }),
        regions,
      ],
    });

    wavesurferRef.current = ws;

    const onReady = () => {
      const d = ws.getDuration();
      setDuration(d);
      setLoadingWave(false);
      setReady(true);
      applyZoom(zoomIndexRef.current);
      if (d > 0) onDurationChangeRef.current?.(d);
    };
    const onLoad = () => setLoadingWave(true);
    const onTime = (t) => emitTime(t);
    const onPlay = () => { setPlaying(true); onPlayStateChange?.(true); };
    const onPause = () => { setPlaying(false); onPlayStateChange?.(false); };
    const onFinish = () => { setPlaying(false); onPlayStateChange?.(false); };

    const onRegionUpdated = (region) => {
      if (!editModeRef.current || selectionSyncRef.current) return;
      emitSelection(region.start, region.end);
    };
    const onRegionCreated = (region) => {
      if (!editModeRef.current || selectionSyncRef.current) return;
      regions.getRegions().forEach((r) => {
        if (r !== region) r.remove();
      });
      emitSelection(region.start, region.end);
    };

    ws.on("ready", onReady);
    ws.on("load", onLoad);
    ws.on("timeupdate", onTime);
    ws.on("audioprocess", onTime);
    ws.on("seeking", onTime);
    ws.on("interaction", (newTime) => onTime(newTime));
    ws.on("play", onPlay);
    ws.on("pause", onPause);
    ws.on("finish", onFinish);
    regions.on("region-updated", onRegionUpdated);
    regions.on("region-created", onRegionCreated);

    return () => {
      if (dragSelectDisableRef.current) {
        dragSelectDisableRef.current();
        dragSelectDisableRef.current = null;
      }
      regions.unAll();
      ws.destroy();
      wavesurferRef.current = null;
      regionsRef.current = null;
      setReady(false);
    };
  }, [waveHeight, timelineHeight, applyZoom, emitSelection, upsertSelectionRegion, emitTime]);

  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws || !blob) return undefined;

    setZoomIndex(0);
    setLoadingWave(true);
    setDuration(0);
    setCurrentTime(0);
    setPlaying(false);
    setReady(false);

    void ws.loadBlob(blob);
  }, [blob]);

  useEffect(() => {
    if (duration > 0) onDurationChange?.(duration);
  }, [duration, onDurationChange]);

  useEffect(() => {
    if (!ready || duration <= 0) return;
    applyZoom(zoomIndex);
  }, [zoomIndex, ready, duration, applyZoom]);

  useEffect(() => {
    const ws = wavesurferRef.current;
    const regions = regionsRef.current;
    if (!ws || !regions) return;

    if (dragSelectDisableRef.current) {
      dragSelectDisableRef.current();
      dragSelectDisableRef.current = null;
    }

    if (editMode) {
      ws.setOptions({ dragToSeek: false });
      dragSelectDisableRef.current = regions.enableDragSelection({
        color: REGION_COLOR,
      });
    } else {
      ws.setOptions({ dragToSeek: true });
      regions.clearRegions();
    }
  }, [editMode, ready]);

  useEffect(() => {
    if (!editMode || !ready || selectionSyncRef.current) return;
    if (
      !selectionSec ||
      selectionSec.endSec <= selectionSec.startSec
    ) {
      regionsRef.current?.clearRegions();
      return;
    }
    upsertSelectionRegion(selectionSec.startSec, selectionSec.endSec);
  }, [selectionSec, editMode, ready, upsertSelectionRegion]);

  useEffect(() => {
    if (!isStudio) return undefined;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "=" || e.key === "+" || e.code === "Equal") {
        e.preventDefault();
        setZoomIndex((i) => Math.min(ZOOM_MIN_PX_PER_SEC.length - 1, i + 1));
      } else if (e.key === "-" || e.key === "_" || e.code === "Minus") {
        e.preventDefault();
        setZoomIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "0" || e.code === "Digit0") {
        e.preventDefault();
        setZoomIndex(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isStudio]);

  if (!blob) return null;

  const togglePlay = () => {
    const ws = wavesurferRef.current;
    if (!ws || duration <= 0) return;
    try {
      ws.playPause();
    } catch {
      /* audio not ready */
    }
  };

  const restartFromBeginning = () => {
    const ws = wavesurferRef.current;
    if (!ws || duration <= 0) return;
    const wasPlaying = ws.isPlaying();
    try {
      ws.setTime(0);
      if (wasPlaying) void ws.play();
    } catch {
      /* audio not ready */
    }
  };

  const onSeekChange = (e) => {
    const ws = wavesurferRef.current;
    if (!ws || duration <= 0) return;
    try {
      const t = (Number(e.target.value) / 1000) * duration;
      ws.setTime(t);
      emitTime(t);
    } catch {
      /* audio not ready */
    }
  };

  const progress = duration > 0 ? currentTime / duration : 0;
  const canZoom = ready && duration > 0;
  const canZoomIn = canZoom && zoomIndex < ZOOM_MIN_PX_PER_SEC.length - 1;
  const canZoomOut = canZoom && zoomIndex > 0;

  return (
    <div className={`audio-wrap${isStudio ? " audio-wrap--studio" : ""}`}>
      {isStudio ? (
        <div className="studio-track-shell">
          <div className="studio-track-zoom-dock" role="group" aria-label="Waveform zoom">
            <button
              type="button"
              className="studio-timeline-zoom-btn"
              title="Zoom out (Ctrl+-)"
              aria-label="Zoom out"
              disabled={!canZoomOut}
              onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
            >
              <IconZoomOut />
            </button>
            <button
              type="button"
              className="studio-timeline-zoom-btn"
              title="Zoom in (Ctrl++)"
              aria-label="Zoom in"
              disabled={!canZoomIn}
              onClick={() => setZoomIndex((i) => Math.min(ZOOM_MIN_PX_PER_SEC.length - 1, i + 1))}
            >
              <IconZoomIn />
            </button>
          </div>
          <div className="studio-wavesurfer-scroll">
            <div
              ref={containerRef}
              className={`studio-wavesurfer-host${editMode ? " studio-wavesurfer-host--editable" : ""}`}
              aria-label={
                editMode
                  ? "Audio waveform — drag on the wave to select a region"
                  : "Audio waveform"
              }
            />
            {loadingWave && <div className="audio-waveform-loading">Loading waveform…</div>}
          </div>
        </div>
      ) : (
        <div className="audio-wavesurfer-compact">
          <div
            ref={containerRef}
            className="audio-wavesurfer-host"
            aria-label="Audio waveform"
          />
          {loadingWave && <div className="audio-waveform-loading">Loading waveform…</div>}
        </div>
      )}

      <div className="audio-controls">
        {(showAddMenu || onAddAudio) && (
          <div className="audio-add-wrap" ref={addWrapRef}>
            {showAddMenu && (
              <AudioAddMenu
                anchorRef={addWrapRef}
                open={addMenuOpen}
                onClose={() => onAddMenuToggle?.(false)}
                onUpload={() => {
                  onAddMenuToggle?.(false);
                  onAddMenuUpload?.();
                }}
                onRecord={() => {
                  onAddMenuToggle?.(false);
                  onAddMenuRecord?.();
                }}
              />
            )}
            <button
              type="button"
              className="audio-btn audio-btn-add"
              title={showAddMenu ? "Add correction audio" : "Add audio"}
              onClick={() => {
                if (showAddMenu) onAddMenuToggle?.(!addMenuOpen);
                else onAddAudio?.();
              }}
            >
              +
            </button>
          </div>
        )}
        <button
          type="button"
          className="audio-btn audio-btn-play"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <button
          type="button"
          className="audio-btn audio-btn-restart"
          onClick={restartFromBeginning}
          aria-label="Restart from beginning"
          title="Restart from beginning"
        >
          <IconRestart />
        </button>
        <div className="audio-seek">
          <span className="audio-time">{formatTimeShort(currentTime)}</span>
          <input
            type="range"
            className="audio-seek-input"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            onChange={onSeekChange}
            aria-label="Seek"
            style={{ "--seek-pct": `${progress * 100}%` }}
          />
          <span className="audio-time audio-time-end">{formatTimeShort(duration)}</span>
        </div>
      </div>
    </div>
  );
}
