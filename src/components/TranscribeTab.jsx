import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "react-bootstrap";
import StudioIcon from "./StudioIcon.jsx";
import StudioSelect from "./StudioSelect.jsx";
import { useStudioToast } from "./StudioToast.jsx";
import AudioPlayer from "./AudioPlayer.jsx";
import {
  transcribeUnified,
  logWordEdit,
  logWordDelete,
  logWordRevoke,
  saveTranscriptLog,
} from "../utils/asrApi.js";
import { audioMimeType, formatFromFile } from "../utils/audioFormat.js";
import { sanitizeDisplayValue, sanitizeUserMessage } from "../utils/apiError.js";
import {
  updateActivityLog,
  linkActivityLogHistory,
  patchActivityLogTranscriptEdit,
  recordActivityLog,
} from "../utils/activityLogApi.js";
import { saveHistoryEntry } from "../utils/historyApi.js";
import SarvamApiKeyField from "./SarvamApiKeyField.jsx";
import {
  clearStoredSarvamApiKey,
  needsSarvamKeyForAsr,
} from "../utils/sarvamKeyStorage.js";

const LANGUAGES = [
  { value: "English", label: "English" },
  { value: "Hindi", label: "Hindi" },
  { value: "Telugu", label: "Telugu" },
];

function sanitizeFileName(name) {
  const trimmed = sanitizeDisplayValue(name)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .slice(0, 120);
  return trimmed || "untitled";
}

function SaveModal({ open, fileName, saving, onFileNameChange, onClose, onSave }) {
  if (!open) return null;
  return (
    <div className="studio-save-backdrop" role="presentation" onClick={onClose}>
      <div
        className="studio-save-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-save-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="studio-save-head">
          <h2 id="studio-save-title" className="studio-save-title">
            SAVE TRANSCRIPT
          </h2>
          <div className="studio-save-head-actions">
            <button type="button" className="studio-save-confirm" disabled={saving} onClick={onSave}>
              {saving ? <Spinner animation="border" size="sm" /> : "Save"}
            </button>
            <button type="button" className="studio-save-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="studio-save-body">
          <label className="studio-save-label" htmlFor="save-file-name">
            File name
          </label>
          <input
            id="save-file-name"
            className="studio-save-input"
            value={sanitizeDisplayValue(fileName)}
            onChange={(e) => onFileNameChange(sanitizeDisplayValue(e.target.value))}
            placeholder="e.g. telu-431"
          />
        </div>
      </div>
    </div>
  );
}

const MISMATCH_STYLE = {
  display: "inline-block",
  background: "rgba(239,68,68,0.13)",
  border: "1.5px solid rgba(239,68,68,0.7)",
  borderRadius: "6px",
  padding: "1px 6px",
  color: "#dc2626",
  cursor: "pointer",
  margin: "0 1px",
  fontWeight: 500,
  userSelect: "none",
};

const ACTIVE_STYLE = {
  display: "inline-block",
  background: "rgba(59,130,246,0.18)",
  outline: "1.5px solid rgba(59,130,246,0.55)",
  borderRadius: "4px",
  padding: "1px 4px",
  margin: "0 1px",
  cursor: "pointer",
};

const CORRECTED_STYLE = {
  display: "inline-block",
  background: "rgba(16,185,129,0.1)",
  border: "1px solid rgba(16,185,129,0.4)",
  borderRadius: "6px",
  padding: "1px 5px",
  color: "#059669",
  margin: "0 1px",
};

const DELETED_STYLE = {
  display: "inline-block",
  background: "rgba(107,114,128,0.1)",
  border: "1px dashed rgba(107,114,128,0.5)",
  borderRadius: "6px",
  padding: "1px 5px",
  color: "#9ca3af",
  textDecoration: "line-through",
  margin: "0 1px",
  fontSize: "0.9em",
};

function WordHighlightTranscript({
  words,
  editedWords,
  editingIndex,
  editValue,
  activeWordIndex,
  onDoubleClick,
  onSingleClickActive,
  onEditChange,
  onEditCommit,
  onEditCancel,
}) {
  const inputRef = useRef(null);
  const activeRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (editingIndex !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingIndex]);

  useEffect(() => {
    if (activeWordIndex != null && activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeWordIndex]);

  if (!words || words.length === 0) {
    return (
      <div className="studio-transcript-empty">
        Transcription will appear here after you transcribe…
      </div>
    );
  }

  return (
    <div ref={containerRef} className="studio-transcript-highlight" aria-label="Transcript with highlights">
      {words.map((wordObj) => {
        const { word, index, mismatch } = wordObj;
        const editedVal = editedWords.get(index);
        const isDeleted = editedVal === null;
        const isCorrected = !isDeleted && editedWords.has(index);
        const displayWord = isCorrected ? editedVal : word;
        const isActive = index === activeWordIndex;

        // Deleted word — show strikethrough, double-click to restore via edit
        if (isDeleted) {
          return (
            <span key={index}>
              <span
                style={DELETED_STYLE}
                onDoubleClick={() => onDoubleClick(index, word)}
                title="Double-click to restore this deleted word"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onDoubleClick(index, word);
                }}
              >
                {word}
              </span>{" "}
            </span>
          );
        }

        if (editingIndex === index) {
          return (
            <span key={index}>
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => onEditChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onEditCommit();
                  } else if (e.key === "Escape") {
                    onEditCancel();
                  }
                }}
                onBlur={onEditCommit}
                aria-label={`Edit word at position ${index}. Clear to delete.`}
                className="studio-transcript-word-input"
                style={{ width: `${Math.max((editValue || "").length + 1, 3)}ch` }}
                placeholder="delete"
              />{" "}
            </span>
          );
        }

        if (mismatch && !isCorrected) {
          return (
            <span key={index}>
              <span
                ref={isActive ? activeRef : null}
                style={{ ...MISMATCH_STYLE, ...(isActive ? { outline: "2px solid #3b82f6" } : {}) }}
                onDoubleClick={() => onDoubleClick(index, word)}
                title="Double-click to correct or clear to delete"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onDoubleClick(index, word);
                }}
              >
                {word}
              </span>{" "}
            </span>
          );
        }

        return (
          <span key={index}>
            <span
              ref={isActive ? activeRef : null}
              style={isCorrected ? CORRECTED_STYLE : isActive ? ACTIVE_STYLE : undefined}
              onClick={isActive ? () => onSingleClickActive(index, displayWord) : undefined}
               onDoubleClick={() => onDoubleClick(index, displayWord)}
              title="Double-click to edit or clear to delete"
              role="button"
              tabIndex={0}
              onKeyDown={
                (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    if (isActive) onSingleClickActive(index, displayWord);
                    else onDoubleClick(index, displayWord);
                  }
                }
              }
            >
              {displayWord}
            </span>{" "}
          </span>
        );
      })}
    </div>
  );
}

function EditModeTranscript({ value, onChange }) {
  return (
    <textarea
      className="studio-textarea studio-transcript-edit"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Transcription will appear here after you transcribe…"
    />
  );
}

function wordsFromTranscript(text, mismatchByIndex = null) {
  const parts = (text || "").split(/\s+/).filter(Boolean);
  return parts.map((word, index) => ({
    word,
    index,
    mismatch: mismatchByIndex ? Boolean(mismatchByIndex[index]) : false,
  }));
}

function normalizeWordsFromResult(result) {
  if (Array.isArray(result.words) && result.words.length > 0) {
    return result.words
      .map((w, i) => ({
        word: String(w.word ?? w.text ?? "").trim(),
        index: Number.isFinite(w.index) ? w.index : i,
        mismatch: Boolean(w.mismatch),
        start_sec: Number.isFinite(w.start_sec) ? w.start_sec : null,
        end_sec: Number.isFinite(w.end_sec) ? w.end_sec : null,
      }))
      .filter((w) => w.word);
  }
  return wordsFromTranscript(result.transcript);
}

function getActiveWordIndex(words, currentTime, duration, playing) {
  if (!words.length) return null;
  const t = Math.max(currentTime, 0);

  const hasTimestamps = words.some((w) => Number.isFinite(w.start_sec));
  if (hasTimestamps) {
    for (let i = 0; i < words.length; i += 1) {
      const start = words[i].start_sec ?? 0;
      const end = words[i].end_sec ?? start;
      if (t >= start && t < end) return i;
    }
    const last = words[words.length - 1];
    if (t >= (last.end_sec ?? last.start_sec ?? 0)) return words.length - 1;
    return null;
  }

  if (!duration) return null;
  if (t <= 0 && !playing) return null;
  const ratio = Math.min(t / duration, 1);
  const idx = Math.floor(ratio * words.length);
  return Math.min(idx, words.length - 1);
}

export default function TranscribeTab({
  apiBaseUrl,
  apiKey,
  accessToken,
  loadRequest,
  onLoadRequestConsumed,
  onHistorySaved,
  tabActive = true,
}) {
  const toast = useStudioToast();
  const fileInputRef = useRef(null);
  const activityLogIdRef = useRef(null);
  const originalTranscriptRef = useRef("");
  const reeditBaselineRef = useRef("");
  const ensureLogPromiseRef = useRef(null);

  const [language, setLanguage] = useState("English");
  const [sarvamApiKey, setSarvamApiKey] = useState("");
  const [validatorName, setValidatorName] = useState("");
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioFormat, setAudioFormat] = useState("wav");
  const [sourceFileName, setSourceFileName] = useState("");

  const [words, setWords] = useState([]);
  const [transcript, setTranscript] = useState("");
  const [stats, setStats] = useState(null);
  const [viewMode, setViewMode] = useState("highlight");

  const [editedWords, setEditedWords] = useState(new Map());
  const [editingIndex, setEditingIndex] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editHistory, setEditHistory] = useState([]);
  const [textHistory, setTextHistory] = useState([]);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  const [sessionId] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  useEffect(() => {
    clearStoredSarvamApiKey();
  }, []);

  useEffect(() => {
    if (!tabActive) {
      setSarvamApiKey("");
    }
  }, [tabActive]);

  const onSarvamKeyChange = (e) => {
    setSarvamApiKey(e.target.value);
  };

  const showSarvamKeyField = needsSarvamKeyForAsr(language);
  const hasAudio = Boolean(audioBlob);
  const hasTranscript = words.length > 0 || transcript.trim().length > 0;

  const activeWordIndex =
    viewMode === "highlight"
      ? getActiveWordIndex(words, currentTime, duration, audioPlaying)
      : null;

  const wordsRef = useRef(words);
  const editedWordsRef = useRef(editedWords);
  const transcriptRef = useRef(transcript);
  const viewModeRef = useRef(viewMode);

  useEffect(() => { wordsRef.current = words; }, [words]);
  useEffect(() => { editedWordsRef.current = editedWords; }, [editedWords]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  // Always computes from latest refs — safe to call inside async handlers
  const buildFinalTranscriptFresh = useCallback(() => {
    const currentWords = wordsRef.current;
    const currentEdited = editedWordsRef.current;
    const currentTranscript = transcriptRef.current;
    if (currentWords.length === 0) return currentTranscript;
    return currentWords
      .map((w) => {
        const c = currentEdited.get(w.index);
        if (c === null) return null; // deleted
        return c !== undefined ? c : w.word;
      })
      .filter((w) => w !== null)
      .join(" ");
  }, []);

  const buildFinalTranscript = useCallback(() => {
    if (words.length === 0) return transcript;
    return words
      .map((w) => {
        const c = editedWords.get(w.index);
        // null means deleted
        if (c === null) return null;
        return c !== undefined ? c : w.word;
      })
      .filter((w) => w !== null)
      .join(" ");
  }, [words, editedWords, transcript]);

  const effectiveTranscript = viewMode === "edit" ? transcript : buildFinalTranscript();

  useEffect(() => {
    if (viewMode === "edit") {
      setTranscript(buildFinalTranscript());
    }
  }, [viewMode, buildFinalTranscript]);

  const ensureActivityLogForEdit = useCallback(async () => {
    if (activityLogIdRef.current) return activityLogIdRef.current;
    if (!accessToken || !audioBlob) return null;

    const baseline = reeditBaselineRef.current || originalTranscriptRef.current;
    if (!baseline) return null;

    if (ensureLogPromiseRef.current) return ensureLogPromiseRef.current;

    ensureLogPromiseRef.current = (async () => {
      try {
        const { id } = await recordActivityLog(accessToken, {
          activityType: "asr",
          textContent: baseline,
          fileName: sanitizeFileName(saveName || sourceFileName.replace(/\.[^.]+$/, "") || "reedit"),
          language,
          validatorName,
          audioBlob,
          audioFormat,
        });
        activityLogIdRef.current = id || null;
        originalTranscriptRef.current = baseline;
        return activityLogIdRef.current;
      } catch (err) {
        console.warn("Admin activity log (ASR re-edit) failed:", err);
        return null;
      } finally {
        ensureLogPromiseRef.current = null;
      }
    })();

    return ensureLogPromiseRef.current;
  }, [accessToken, audioBlob, saveName, sourceFileName, language, validatorName, audioFormat]);

  useEffect(() => {
    if (!accessToken || !audioBlob) return undefined;

    const baseline = reeditBaselineRef.current || originalTranscriptRef.current;
    if (!baseline) return undefined;
    if (effectiveTranscript === baseline && !activityLogIdRef.current) return undefined;

    const timer = window.setTimeout(() => {
      (async () => {
        const logId = activityLogIdRef.current || (await ensureActivityLogForEdit());
        if (!logId || effectiveTranscript === originalTranscriptRef.current) return;
        await patchActivityLogTranscriptEdit(accessToken, logId, {
          editedText: effectiveTranscript,
          validatorName,
        });
      })().catch((err) => {
        console.warn("Admin activity log transcript edit failed:", err);
      });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [effectiveTranscript, validatorName, accessToken, audioBlob, ensureActivityLogForEdit]);

  useEffect(() => {
    if (!loadRequest?.token) return;

    setSarvamApiKey("");
    const fmt = loadRequest.audioFormat || "wav";
    const mime =
      loadRequest.mimeType?.split(";")[0]?.trim() ||
      loadRequest.audioBlob?.type?.split(";")[0]?.trim() ||
      audioMimeType(fmt);

    setLanguage(loadRequest.language || "English");
    setValidatorName(sanitizeDisplayValue(loadRequest.validatorName || ""));
    setAudioFormat(fmt);
    setSourceFileName(sanitizeDisplayValue(loadRequest.fileName || ""));
    setSaveName(sanitizeFileName(loadRequest.fileName || ""));
    setError("");
    activityLogIdRef.current = null;

    const rawText = sanitizeUserMessage(loadRequest.transcriptText || "");
    setTranscript(rawText);
    originalTranscriptRef.current = rawText;
    reeditBaselineRef.current = rawText;
    const plainWords = rawText
      .split(/\s+/)
      .filter(Boolean)
      .map((w, i) => ({ word: w, index: i, mismatch: false }));
    setWords(plainWords);
    setStats(null);
    setEditedWords(new Map());
    setEditingIndex(null);
    setViewMode("highlight");
    setCurrentTime(0);
    setDuration(0);
    setEditHistory([]);
    setTextHistory([]);

    const source = loadRequest.audioBlob;
    if (source) {
      source.arrayBuffer().then((bytes) => {
        if (bytes.byteLength) setAudioBlob(new Blob([bytes], { type: mime }));
      });
    }
    onLoadRequestConsumed?.();
  }, [loadRequest?.token]);

  const resetTranscriptState = useCallback(() => {
    setWords([]);
    setTranscript("");
    setStats(null);
    setEditedWords(new Map());
    setEditingIndex(null);
    setViewMode("highlight");
    setEditHistory([]);
    setTextHistory([]);
    setCurrentTime(0);
    setDuration(0);
    activityLogIdRef.current = null;
    originalTranscriptRef.current = "";
    reeditBaselineRef.current = "";
  }, []);

  const onPickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    resetTranscriptState();
    setSourceFileName(sanitizeDisplayValue(file.name));
    setSaveName(sanitizeFileName(file.name.replace(/\.[^.]+$/, "")));
    setAudioFormat(formatFromFile(file));
    setAudioBlob(file);
    toast.show({ message: `${file.name} ready to transcribe`, variant: "success" });
  };

  const handleTranscribe = async () => {
    if (!audioBlob) {
      setError("Upload an audio file first.");
      return;
    }
    setError("");
    setLoading(true);
    resetTranscriptState();

    try {
      const file =
        audioBlob instanceof File
          ? audioBlob
          : new File([audioBlob], sourceFileName || `audio.${audioFormat}`, {
              type: audioBlob.type || audioMimeType(audioFormat),
            });

      const result = await transcribeUnified(
        language,
        file,
        apiKey,
        validatorName,
        apiBaseUrl,
        accessToken,
        sarvamApiKey
      );

      const normalizedWords = normalizeWordsFromResult(result);
      setWords(normalizedWords);
      setTranscript(result.transcript || normalizedWords.map((w) => w.word).join(" "));
      originalTranscriptRef.current = result.transcript;
      activityLogIdRef.current = result.activityLogId || null;
      setStats({
        mismatch_count: result.mismatch_count,
        total_words: result.total_words || normalizedWords.length,
        accuracy: result.accuracy,
        ground_truth_available: result.ground_truth_available,
        ground_truth_status: result.ground_truth_status || (result.ground_truth_available ? "ok" : "unavailable"),
        has_word_timestamps: result.hasWordTimestamps,
      });
      setViewMode("highlight");
      setSaveName(sanitizeFileName(sourceFileName.replace(/\.[^.]+$/, "") || "recording"));

      if (result.ground_truth_available && result.mismatch_count > 0) {
        toast.show({
          message: `Transcription complete — ${result.mismatch_count} word(s) flagged in red`,
          variant: "success",
        });
      
      } else {
        toast.show({ message: "Transcription complete", variant: "success" });
      }
    } catch (e) {
      const msg = sanitizeUserMessage(e.message || e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDoubleClick = useCallback(
    (index, word) => {
      const corrected = editedWords.get(index);
      setEditingIndex(index);
      setEditValue(corrected !== undefined ? corrected : word);
    },
    [editedWords]
  );

  const handleSingleClickActive = useCallback((index, displayWord) => {
    setEditingIndex(index);
    setEditValue(displayWord);
  }, []);

  const handleEditChange = useCallback((val) => setEditValue(val), []);

  const handleEditCommit = useCallback(() => {
    if (editingIndex === null) return;
    const corrected = editValue.trim();
    const originalWord = words.find((w) => w.index === editingIndex)?.word || "";
    const prevCorrected = editedWords.get(editingIndex);
    const before = prevCorrected !== undefined && prevCorrected !== null ? prevCorrected : originalWord;

    // Empty value = delete the word
    if (!corrected) {
      setEditedWords((prev) => {
        const n = new Map(prev);
        n.set(editingIndex, null); // null marks deleted
        return n;
      });
      setEditHistory((prev) => [
        ...prev,
        {
          type: "delete",
          wordIndex: editingIndex,
          before,
          after: null,
          restoreToOriginal: prevCorrected === undefined,
        },
      ]);
      logWordDelete(
        {
          session_id: sessionId,
          word_index: editingIndex,
          deleted_word: originalWord,
          display_word: before,
          validator_name: validatorName,
          file_name: sourceFileName,
          language,
        },
        apiKey,
        apiBaseUrl
      );
      toast.show({ message: `Deleted: "${before}"`, variant: "warning" });
      setEditingIndex(null);
      return;
    }

    setEditedWords((prev) => {
      const n = new Map(prev);
      n.set(editingIndex, corrected);
      return n;
    });
    setEditHistory((prev) => [
      ...prev,
      {
        type: "word",
        wordIndex: editingIndex,
        before,
        after: corrected,
        restoreToOriginal: prevCorrected === undefined,
      },
    ]);
    logWordEdit(
      {
        session_id: sessionId,
        word_index: editingIndex,
        original_word: originalWord,
        corrected_word: corrected,
        validator_name: validatorName,
        file_name: sourceFileName,
        language,
      },
      apiKey,
      apiBaseUrl
    );
    setEditingIndex(null);
  }, [
    editingIndex,
    editValue,
    words,
    editedWords,
    sessionId,
    validatorName,
    sourceFileName,
    language,
    apiKey,
    apiBaseUrl,
    toast,
  ]);

  const handleEditCancel = useCallback(() => setEditingIndex(null), []);

  const canRevoke =
    viewMode === "highlight" ? editHistory.length > 0 : textHistory.length > 0;

  const handleRevoke = useCallback(() => {
    if (viewMode === "highlight") {
      if (editHistory.length === 0) return;
      const last = editHistory[editHistory.length - 1];
      setEditedWords((prev) => {
        const n = new Map(prev);
        if (last.restoreToOriginal) {
          n.delete(last.wordIndex);
        } else {
          n.set(last.wordIndex, last.before);
        }
        return n;
      });
      setEditHistory((prev) => prev.slice(0, -1));

      const revokedDisplay = last.after === null ? `(deleted) "${last.before}"` : `"${last.after}"`;
      const restoredDisplay = last.before;

      logWordRevoke(
        {
          session_id: sessionId,
          word_index: last.wordIndex,
          revoked_word: last.after === null ? `[DELETED] ${last.before}` : last.after,
          restored_word: last.before,
          action_type: last.type,
          validator_name: validatorName,
          file_name: sourceFileName,
          language,
        },
        apiKey,
        apiBaseUrl
      );
      toast.show({
        message: last.type === "delete"
          ? `Restored deleted word: "${restoredDisplay}"`
          : `Revoked: ${revokedDisplay} → "${restoredDisplay}"`,
        variant: "warning",
      });
    } else {
      if (textHistory.length === 0) return;
      const previous = textHistory[textHistory.length - 1];
      const revokedText = transcript;
      setTranscript(previous);
      setTextHistory((prev) => prev.slice(0, -1));
      logWordRevoke(
        {
          session_id: sessionId,
          word_index: -1,
          revoked_word: revokedText.slice(0, 120),
          restored_word: previous.slice(0, 120),
          action_type: "text",
          validator_name: validatorName,
          file_name: sourceFileName,
          language,
        },
        apiKey,
        apiBaseUrl
      );
      toast.show({ message: "Last edit revoked", variant: "warning" });
    }
  }, [
    viewMode,
    editHistory,
    textHistory,
    transcript,
    sessionId,
    validatorName,
    sourceFileName,
    language,
    apiKey,
    apiBaseUrl,
    toast,
  ]);

  const handleEditModeChange = useCallback(
    (newVal) => {
      setTextHistory((prev) => [...prev, transcript]);
      setTranscript(newVal);
    },
    [transcript]
  );

  const handleTimeUpdate = useCallback((t) => setCurrentTime(t), []);
  const handleDurationChange = useCallback((d) => setDuration(d), []);
  const handlePlayStateChange = useCallback((isPlaying) => setAudioPlaying(isPlaying), []);

  const handleSave = async () => {
    const name = sanitizeFileName(saveName);
    if (!name) {
      toast.show({ message: "Enter a file name", variant: "danger" });
      return;
    }
    if (!audioBlob) {
      toast.show({ message: "No audio to save", variant: "danger" });
      return;
    }
    setSaving(true);
    try {
            const finalTranscript =
        viewModeRef.current === "edit"
          ? transcriptRef.current
          : buildFinalTranscriptFresh();

      const saved = await saveHistoryEntry(apiBaseUrl, accessToken, {
        transcriptText: finalTranscript,
        fileName: name,
        language,
        validatorName,
        audioBlob,
        audioFormat,
      });

      if (activityLogIdRef.current) {
        if (saved?.id) {
          await linkActivityLogHistory(accessToken, activityLogIdRef.current, saved.id);
        }
        await updateActivityLog(accessToken, activityLogIdRef.current, {
          textContent: finalTranscript,
          fileName: name,
          language,
          validatorName,
          audioBlob,
          audioFormat,
          linkedHistoryId: saved?.id,
        });
      }

      saveTranscriptLog(
        {
          session_id: sessionId,
          transcript: finalTranscript,
          validator_name: validatorName,
          file_name: sourceFileName,
          language,
          edit_count: editedWords.size,
          mismatch_count: stats?.mismatch_count ?? 0,
          accuracy: stats?.accuracy ?? 1,
        },
        apiKey,
        apiBaseUrl
      );

      setSaveOpen(false);
      toast.show({ message: "Saved to history", variant: "success" });
      reeditBaselineRef.current = finalTranscript;
      activityLogIdRef.current = null;
      onHistorySaved?.({
        id: saved?.id,
        originalTranscript: originalTranscriptRef.current || "",
        finalTranscript,
      });
    } catch (e) {
      toast.show({ message: sanitizeUserMessage(e.message || e), variant: "danger" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="studio-dashboard">
        {error ? (
          <div className="studio-alerts">
            <div className="history-alert" role="alert">
              {sanitizeUserMessage(error)}
            </div>
          </div>
        ) : null}

        <div className="studio-card studio-card-audio studio-glass">
          <div className="studio-card-head">
            <h2 className="studio-card-title studio-card-title-plain">AUDIO</h2>
          </div>
          <div className="studio-card-body studio-card-body-audio">
            <div className="studio-select-row studio-audio-toolbar">
              <div className="studio-field studio-field--language">
                <span className="studio-field-icon">
                  <StudioIcon name="language" size={18} />
                </span>
                <StudioSelect
                  value={language}
                  onChange={(val) => {
                    setLanguage(val);
                    setSarvamApiKey("");
                    resetTranscriptState();
                  }}
                  options={LANGUAGES}
                  aria-label="Language"
                />
              </div>
              {hasAudio ? (
                <button
                  type="button"
                  className="studio-btn studio-btn-ghost studio-replace-file-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title={sourceFileName || "Replace audio file"}
                >
                  <StudioIcon name="upload" size={18} className="studio-btn-icon" />
                  Replace file
                </button>
              ) : null}
            </div>

            {showSarvamKeyField ? (
              <SarvamApiKeyField
                value={sarvamApiKey}
                onChange={onSarvamKeyChange}
                id="asr-sarvam-api-key"
              />
            ) : null}

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.mp4,.ogg,.flac"
              className="studio-sr-only"
              onChange={onPickFile}
            />

            <div className="studio-preview-shell">
              <div className="studio-preview-body">
                {!hasAudio ? (
                  <div className="studio-preview-empty">
                    <p className="studio-preview-empty-title">Upload audio</p>
                    <p className="studio-preview-empty-sub">MP3, WAV, M4A, FLAC, OGG</p>
                    <button
                      type="button"
                      className="studio-btn studio-btn-glow mt-3"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <StudioIcon name="upload" size={18} className="studio-btn-icon" />
                      Choose file
                    </button>
                  </div>
                ) : (
                  <div className="studio-preview-audio">
                    <AudioPlayer
                      blob={audioBlob}
                      mimeType={
                        audioBlob?.type?.split(";")[0]?.trim() || audioMimeType(audioFormat)
                      }
                      variant="studio"
                      editMode={false}
                      onTimeUpdate={handleTimeUpdate}
                      onDurationChange={handleDurationChange}
                      onPlayStateChange={handlePlayStateChange}
                    />
                    {sourceFileName ? (
                      <p className="studio-audio-filename" title={sanitizeDisplayValue(sourceFileName)}>
                        {sanitizeDisplayValue(sourceFileName)}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            <div className="studio-card-actions studio-card-actions-end">
              <button
                type="button"
                className="studio-btn studio-btn-glow"
                disabled={!hasAudio || loading}
                onClick={handleTranscribe}
              >
                {loading ? (
                  <>
                    <Spinner animation="border" size="sm" className="studio-btn-spinner" />
                    Transcribing…
                  </>
                ) : (
                  <>
                    <StudioIcon name="nav-transcribe" size={18} className="studio-btn-icon" />
                    Transcribe
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="studio-card studio-card-script studio-glass">
          <div className="studio-card-head studio-card-head-split">
            <h2 className="studio-card-title studio-card-title-plain">TRANSCRIPT</h2>
            <div className="studio-transcript-head-actions">
              {hasTranscript && canRevoke && (
                <button
                  type="button"
                  className="studio-btn studio-btn-ghost studio-btn-revoke"
                  onClick={handleRevoke}
                  title="Undo the last edit"
                >
                  ↩ Revoke
                </button>
              )}
              {hasTranscript && (
                <button
                  type="button"
                  className="studio-btn studio-btn-ghost studio-btn-mode-toggle"
                  onClick={() => setViewMode((m) => (m === "highlight" ? "edit" : "highlight"))}
                  title={
                    viewMode === "highlight"
                      ? "Switch to free-text edit mode"
                      : "Switch to highlight mode"
                  }
                >
                  {viewMode === "highlight" ? "✏️ Edit mode" : "🔍 Highlight mode"}
                </button>
              )}
              <button
                type="button"
                className="studio-toolbar-btn"
                disabled={!hasTranscript || !hasAudio}
                onClick={() => setSaveOpen(true)}
              >
                <StudioIcon name="save" className="studio-toolbar-btn-icon" size={18} />
                Save
              </button>
            </div>
          </div>

          <div className="studio-card-body studio-transcript-body">
            <label className="studio-save-label" htmlFor="validator-name">
              Validator name
            </label>
            <input
              id="validator-name"
              className="studio-save-input mb-3"
              value={sanitizeDisplayValue(validatorName)}
              onChange={(e) => setValidatorName(sanitizeDisplayValue(e.target.value))}
              placeholder="Your name (optional)"
            />

            {viewMode === "highlight" ? (
              <WordHighlightTranscript
                words={words}
                editedWords={editedWords}
                editingIndex={editingIndex}
                editValue={editValue}
                activeWordIndex={activeWordIndex}
                onDoubleClick={handleDoubleClick}
                onSingleClickActive={handleSingleClickActive}
                onEditChange={handleEditChange}
                onEditCommit={handleEditCommit}
                onEditCancel={handleEditCancel}
              />
            ) : (
              <EditModeTranscript value={transcript} onChange={handleEditModeChange} />
            )}


            {stats && stats.ground_truth_available && (
              <p className="studio-transcript-stats">
                {stats.total_words - stats.mismatch_count} of {stats.total_words} words matched (
                {Math.round(stats.accuracy * 100)}% accuracy)
                {editedWords.size > 0 && (() => {
                  const deletedCount = [...editedWords.values()].filter((v) => v === null).length;
                  const correctedCount = editedWords.size - deletedCount;
                  const parts = [];
                  if (correctedCount > 0) parts.push(`${correctedCount} correction${correctedCount !== 1 ? "s" : ""}`);
                  if (deletedCount > 0) parts.push(`${deletedCount} deletion${deletedCount !== 1 ? "s" : ""}`);
                  return parts.length > 0 ? (
                    <span className="studio-transcript-corrections"> · {parts.join(", ")}</span>
                  ) : null;
                })()}
              </p>
            )}

            {viewMode === "highlight" &&
              stats?.ground_truth_available &&
              stats.mismatch_count > 0 && (
                <p className="studio-transcript-hint">
                  Double-click a <span className="studio-transcript-hint-mismatch">highlighted</span>{" "}
                  word to correct it. Clear the input and press Enter to delete it.
                </p>
              )}
          </div>
        </div>
      </div>

      <SaveModal
        open={saveOpen}
        fileName={saveName}
        saving={saving}
        onFileNameChange={setSaveName}
        onClose={() => setSaveOpen(false)}
        onSave={handleSave}
      />
    </>
  );
}
