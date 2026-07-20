import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "react-bootstrap";
import StudioIcon from "../../components/StudioIcon.jsx";
import {
  isSecureRecordingContext,
  mapMicrophoneError,
  microphoneUnavailableMessage,
  requestMicrophoneStream,
} from "../utils/mediaCapture.js";

function IconClose({ className }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3z" />
      <path d="M19 11a7 7 0 0 1-14 0M12 18v3" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconRedo() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function formatTimeShort(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function blobFromChunks(chunks, mimeType) {
  const type = mimeType?.includes("webm") ? mimeType : mimeType || "audio/webm";
  return new Blob(chunks, { type });
}

export default function RecordCorrectionModal({ open, onClose, onSave }) {
  const [title, setTitle] = useState("Testing Audio");
  const [recording, setRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewTime, setPreviewTime] = useState(0);
  const [levels, setLevels] = useState(() => new Array(48).fill(0.08));
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const previewBlobRef = useRef(null);
  const previewAudioRef = useRef(null);
  const previewUrlRef = useRef(null);
  const rafRef = useRef(null);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const resetSession = useCallback(() => {
    stopStream();
    previewAudioRef.current?.pause();
    chunksRef.current = [];
    previewBlobRef.current = null;
    revokePreviewUrl();
    setRecording(false);
    setHasRecording(false);
    setPreviewPlaying(false);
    setPreviewDuration(0);
    setPreviewTime(0);
    setLevels(new Array(48).fill(0.08));
    mediaRecorderRef.current = null;
  }, [stopStream, revokePreviewUrl]);

  useEffect(() => {
    if (!open) {
      resetSession();
      setTitle("Testing Audio");
      setError("");
      return;
    }
    if (!isSecureRecordingContext()) {
      setError(microphoneUnavailableMessage());
    }
  }, [open, resetSession]);

  const tickLevels = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const step = Math.floor(data.length / 48) || 1;
    const next = [];
    for (let i = 0; i < 48; i += 1) {
      let sum = 0;
      for (let j = 0; j < step; j += 1) sum += data[i * step + j] || 0;
      next.push(0.08 + (sum / step / 255) * 0.92);
    }
    setLevels(next);
    rafRef.current = requestAnimationFrame(tickLevels);
  }, []);

  const startRecording = async () => {
    setError("");
    chunksRef.current = [];
    previewBlobRef.current = null;
    setHasRecording(false);
    try {
      const stream = await requestMicrophoneStream({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      rafRef.current = requestAnimationFrame(tickLevels);

      const preferred = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const rec = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start(250);
      setRecording(true);
    } catch (e) {
      setError(mapMicrophoneError(e));
    }
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") {
      setRecording(false);
      stopStream();
      return;
    }
    rec.onstop = async () => {
      setRecording(false);
      stopStream();
      const blob = await blobFromChunks(chunksRef.current, rec.mimeType || "audio/webm");
      previewBlobRef.current = blob;
      revokePreviewUrl();
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewUrl(url);
      setPreviewTime(0);
      setPreviewDuration(0);
      setHasRecording(true);
      mediaRecorderRef.current = null;
    };
    rec.stop();
  };

  const toggleRecord = () => {
    if (recording) stopRecording();
    else {
      if (!isSecureRecordingContext()) {
        setError(microphoneUnavailableMessage());
        return;
      }
      previewAudioRef.current?.pause();
      setPreviewPlaying(false);
      startRecording();
    }
  };

  const togglePreviewPlay = async () => {
    const audio = previewAudioRef.current;
    if (!audio || !previewUrl) return;
    if (audio.paused) {
      try {
        await audio.play();
        setPreviewPlaying(true);
      } catch {
        setError("Could not play recording preview.");
      }
    } else {
      audio.pause();
      setPreviewPlaying(false);
    }
  };

  const handleSave = () => {
    const blob = previewBlobRef.current;
    if (!blob) {
      setError("Record audio first, then save.");
      return;
    }
    const name = title.trim() || "Recording";
    onSave?.({ blob, fileName: name });
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="studio-save-backdrop" role="presentation" onClick={onClose}>
      <div
        className="studio-record-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-record-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio-save-head">
          <h3 id="studio-record-title" className="studio-save-title">
            RECORD
          </h3>
          <div className="studio-save-head-actions">
            <button
              type="button"
              className="studio-save-confirm"
              disabled={!hasRecording}
              onClick={handleSave}
            >
              <StudioIcon name="save" className="studio-toolbar-btn-icon" size={18} />
              Save
            </button>
            <button type="button" className="studio-save-close" aria-label="Close" onClick={onClose}>
              <IconClose />
            </button>
          </div>
        </header>

        <div className="studio-record-body">
          <label className="studio-save-label" htmlFor="studio-record-title-input">
            Record Title
          </label>
          <input
            id="studio-record-title-input"
            type="text"
            className="studio-save-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <p className="studio-record-section-label">
            {hasRecording ? "Preview recording" : "Start / Stop Record"}
          </p>

          {hasRecording && previewUrl ? (
            <div className="studio-record-preview">
              <audio
                key={previewUrl}
                ref={previewAudioRef}
                className="studio-record-preview-audio"
                src={previewUrl}
                preload="auto"
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget;
                  let d = el.duration;
                  if (!Number.isFinite(d) || d === Infinity) {
                    const onTime = () => {
                      el.removeEventListener("timeupdate", onTime);
                      el.currentTime = 0;
                      if (Number.isFinite(el.duration) && el.duration > 0) {
                        setPreviewDuration(el.duration);
                      }
                    };
                    el.addEventListener("timeupdate", onTime);
                    el.currentTime = 1e101;
                    return;
                  }
                  if (d > 0) setPreviewDuration(d);
                }}
                onTimeUpdate={(e) => setPreviewTime(e.currentTarget.currentTime)}
                onPlay={() => setPreviewPlaying(true)}
                onPause={() => setPreviewPlaying(false)}
                onEnded={() => setPreviewPlaying(false)}
              />
              <button
                type="button"
                className="studio-record-toggle studio-record-preview-play"
                onClick={() => {
                  void togglePreviewPlay();
                }}
                aria-label={previewPlaying ? "Pause preview" : "Play preview"}
              >
                {previewPlaying ? <IconPause /> : <IconPlay />}
              </button>
              <div className="studio-record-preview-main">
                <input
                  type="range"
                  className="studio-record-preview-seek"
                  min={0}
                  max={1000}
                  value={
                    previewDuration
                      ? Math.round((previewTime / previewDuration) * 1000)
                      : 0
                  }
                  onChange={(e) => {
                    const audio = previewAudioRef.current;
                    if (!audio || !previewDuration) return;
                    audio.currentTime = (Number(e.target.value) / 1000) * previewDuration;
                  }}
                  style={{
                    "--seek-pct": previewDuration
                      ? `${(previewTime / previewDuration) * 100}%`
                      : "0%",
                  }}
                />
                <div className="studio-record-preview-times">
                  <span>{formatTimeShort(previewTime)}</span>
                  <span>{formatTimeShort(previewDuration)}</span>
                </div>
              </div>
              <button
                type="button"
                className="studio-record-redo"
                aria-label="Re-record"
                title="Re-record"
                onClick={() => {
                  previewAudioRef.current?.pause();
                  revokePreviewUrl();
                  previewBlobRef.current = null;
                  setHasRecording(false);
                  setPreviewPlaying(false);
                  setPreviewTime(0);
                  setPreviewDuration(0);
                  setLevels(new Array(48).fill(0.08));
                }}
              >
                <IconRedo />
              </button>
            </div>
          ) : (
          <div className="studio-record-row">
            <button
              type="button"
              className={`studio-record-toggle${recording ? " is-recording" : ""}`}
              onClick={toggleRecord}
              aria-label={recording ? "Stop recording" : "Start recording"}
            >
              {recording ? <IconPause /> : <IconMic />}
            </button>
            <div className="studio-record-wave" aria-hidden>
              {levels.map((lv, i) => (
                <span
                  key={i}
                  className="studio-record-bar"
                  style={{ transform: `scaleY(${lv})` }}
                />
              ))}
            </div>
          </div>
          )}

          {error && <p className="studio-record-error">{error}</p>}
          {recording && (
            <div className="studio-record-status" role="status">
              <Spinner animation="border" size="sm" className="me-2" />
              Recording… click pause to stop
            </div>
          )}
          {hasRecording && !recording && (
            <p className="studio-record-status studio-record-status-ok">
              Recording ready — play to listen, then Save.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
