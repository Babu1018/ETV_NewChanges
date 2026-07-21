import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "react-bootstrap";
import AudioPlayer from "../../components/AudioPlayer.jsx";
import {
  audioMimeType,
  formatFromFile,
  formatFromMimeType,
  formatLabel,
  normalizeAudioFormat,
} from "../utils/audioFormat.js";
import SelectionRangeEditor from "./SelectionRangeEditor.jsx";
import { updateActivityLog, patchActivityLogEditRegions, linkActivityLogHistory, recordActivityLog, uploadActivityLogCorrectionAudio } from "../../utils/activityLogApi.js";
import {
  attachCorrectionAudio,
  buildEditRegionEntry,
  mergeEditRegionEntry,
} from "../../utils/editRegions.js";
import { saveHistoryEntry } from "../utils/historyApi.js";
import { isAudioOnlyScript, scriptTextForHistorySave } from "../utils/historyScript.js";
import { correctTtsSegment, deleteTtsClip } from "../utils/correctionApi.js";
import CorrectionLayerPanel from "./CorrectionLayerPanel.jsx";
import RecordCorrectionModal from "./RecordCorrectionModal.jsx";
import StudioIcon from "../../components/StudioIcon.jsx";
import StudioSelect from "../../components/StudioSelect.jsx";
import { useStudioToast } from "../../components/StudioToast.jsx";
import SarvamApiKeyField from "../../components/SarvamApiKeyField.jsx";
import {
  clearStoredSarvamApiKey,
  sarvamKeyHeaders,
} from "../../utils/sarvamKeyStorage.js";

const LANGUAGES = [
  { value: "English", label: "English" },
  { value: "Hindi", label: "Hindi" },
  { value: "Telugu", label: "Telugu" },
];

const GENDERS = [
  { value: "Female", label: "Female" },
  { value: "Male", label: "Male" },
];

const FEMALE_SPEAKERS = [
  { value: "D", label: "D" },
  { value: "E", label: "E" },
  { value: "F", label: "F" },
  { value: "G", label: "G" },
];

const MALE_SPEAKERS = [
  { value: "A", label: "A" },
  { value: "B", label: "B" },
  { value: "C", label: "C" },
];

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

function sanitizeFileName(name) {
  const trimmed = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "").slice(0, 120);
  return trimmed || "untitled";
}

function SaveAudioModal({ open, fileName, saving, onFileNameChange, onClose, onSave }) {
  if (!open) return null;

  return (
    <div
      className="studio-save-backdrop"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        onClose?.();
      }}
    >
      <div
        className="studio-save-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-save-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio-save-head">
          <h3 id="studio-save-title" className="studio-save-title">
            SAVE
          </h3>
          <div className="studio-save-head-actions">
            <button
              type="button"
              className="studio-save-confirm"
              disabled={saving || !fileName.trim()}
              onClick={onSave}
            >
              <StudioIcon name="save" className="studio-toolbar-btn-icon" size={18} />
              Save
            </button>
            <button
              type="button"
              className="studio-save-close"
              aria-label="Close"
              onClick={onClose}
            >
              <IconClose />
            </button>
          </div>
        </header>
        <div className="studio-save-body">
          <label className="studio-save-label" htmlFor="studio-save-filename">
            File Name
          </label>
          <input
            id="studio-save-filename"
            type="text"
            className="studio-save-input"
            placeholder="Enter file name"
            value={fileName}
            onChange={(e) => onFileNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && fileName.trim()) onSave();
            }}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}

function IconChevronDown({ className }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function resolveSpeaker(gender, speaker) {
  const femaleKeys = FEMALE_SPEAKERS.map((o) => o.value);
  const maleKeys = MALE_SPEAKERS.map((o) => o.value);
  if (gender === "Male") {
    return maleKeys.includes(speaker) ? speaker : "A";
  }
  return femaleKeys.includes(speaker) ? speaker : "D";
}

export default function GenerateTab({
  apiBaseUrl,
  apiKey,
  accessToken,
  loadRequest,
  onLoadRequestConsumed,
  onHistorySaved,
  tabActive = true,
}) {
  const [language, setLanguage] = useState("English");
  const [sarvamApiKey, setSarvamApiKey] = useState("");
  const [gender, setGender] = useState("Female");
  const [speaker, setSpeaker] = useState("D");
  const [text, setText] = useState("");
  const pendingRawScriptFileRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [saved, setSaved] = useState(false);
  const [generatedFormat, setGeneratedFormat] = useState("wav");
  const [exportFormat, setExportFormat] = useState("wav");
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveFileName, setSaveFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSavedName, setLastSavedName] = useState("");
  const [audioEditMode, setAudioEditMode] = useState(false);
  const [audioEditSelection, setAudioEditSelection] = useState(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [correctionLayer, setCorrectionLayer] = useState(null);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previousAudioBlob, setPreviousAudioBlob] = useState(null);
  const undoTimerRef = useRef(null);
  const [loadedFromHistoryName, setLoadedFromHistoryName] = useState("");

  const txtInputRef = useRef(null);
  const audioSectionRef = useRef(null);
  const audioUploadInputRef = useRef(null);
  const correctionFileInputRef = useRef(null);
  const scriptRef = useRef(null);
  const downloadFormatRef = useRef(null);
  const activityLogIdRef = useRef(null);
  const editRegionsRef = useRef([]);
  const ensureLogPromiseRef = useRef(null);
  const { show: showToast } = useStudioToast();

  const speakerOptions = useMemo(
    () => (gender === "Female" ? FEMALE_SPEAKERS : MALE_SPEAKERS),
    [gender]
  );

  const onGenderChange = (g) => {
    setGender(g);
    setSpeaker(g === "Female" ? "D" : "A");
  };

  const onLanguageChange = (val) => {
    setLanguage(val);
    setSarvamApiKey("");
  };

  const onSarvamKeyChange = (e) => {
    setSarvamApiKey(e.target.value);
  };

  useEffect(() => {
    clearStoredSarvamApiKey();
  }, []);

  useEffect(() => {
    if (!tabActive) {
      setSarvamApiKey("");
    }
  }, [tabActive]);

  const ensureActivityLog = useCallback(async () => {
    if (activityLogIdRef.current) return activityLogIdRef.current;
    if (!accessToken || !audioBlob) return null;

    if (ensureLogPromiseRef.current) return ensureLogPromiseRef.current;

    ensureLogPromiseRef.current = (async () => {
      try {
        const scriptForLog = scriptTextForHistorySave(text);
        const audioOnlySave = isAudioOnlyScript(scriptForLog);
        const pendingName = pendingRawScriptFileRef.current?.name?.replace(/\.[^.]+$/i, "");
        const baseName = sanitizeFileName(
          lastSavedName || loadedFromHistoryName || pendingName || "tts_reedit"
        );
        const fmt = normalizeAudioFormat(exportFormat || generatedFormat);
        const { id } = await recordActivityLog(accessToken, {
          activityType: "tts",
          textContent: scriptForLog,
          fileName: baseName,
          language,
          gender: audioOnlySave ? "" : gender,
          speaker: audioOnlySave ? "" : speaker,
          audioBlob,
          audioFormat: fmt,
        });
        activityLogIdRef.current = id || null;
        return activityLogIdRef.current;
      } catch (err) {
        console.warn("Admin activity log (TTS re-edit) failed:", err);
        return null;
      } finally {
        ensureLogPromiseRef.current = null;
      }
    })();

    return ensureLogPromiseRef.current;
  }, [
    accessToken,
    audioBlob,
    text,
    language,
    gender,
    speaker,
    exportFormat,
    generatedFormat,
    lastSavedName,
    loadedFromHistoryName,
  ]);

  const syncEditRegions = useCallback(
    (regions) => {
      editRegionsRef.current = regions;
      if (!accessToken) return;
      ensureActivityLog().then((logId) => {
        if (!logId) return;
        patchActivityLogEditRegions(accessToken, logId, regions).catch((err) => {
          console.warn("Admin activity log edit regions failed:", err);
        });
      });
    },
    [accessToken, ensureActivityLog]
  );

  const pushEditRegion = useCallback(
    (startSec, endSec, status) => {
      const entry = buildEditRegionEntry(startSec, endSec, status);
      const prior = editRegionsRef.current.find(
        (item) => item.startSec === startSec && item.endSec === endSec
      );
      if (prior?.correctionAudioId) {
        entry.correctionAudioId = prior.correctionAudioId;
        entry.correctionFileName = prior.correctionFileName;
      }
      syncEditRegions(mergeEditRegionEntry(editRegionsRef.current, entry));
    },
    [syncEditRegions]
  );

  const syncCorrectionAudio = useCallback(
    async (blob, fileName, selection) => {
      if (!accessToken || !selection) return;
      const logId = await ensureActivityLog();
      if (!logId) return;
      const fmt = formatFromFile({ name: fileName });
      try {
        const result = await uploadActivityLogCorrectionAudio(accessToken, logId, {
          startSec: selection.startSec,
          endSec: selection.endSec,
          fileName: sanitizeFileName(fileName.replace(/\.[^.]+$/i, "") || "correction"),
          audioBlob: blob,
          audioFormat: fmt,
        });
        if (result?.correctionAudioId) {
          editRegionsRef.current = attachCorrectionAudio(
            editRegionsRef.current,
            selection.startSec,
            selection.endSec,
            {
              correctionAudioId: result.correctionAudioId,
              correctionFileName: sanitizeFileName(fileName.replace(/\.[^.]+$/i, "") || "correction"),
            }
          );
          syncEditRegions(editRegionsRef.current);
        }
      } catch (err) {
        console.warn("Admin activity log correction audio failed:", err);
      }
    },
    [accessToken, ensureActivityLog, syncEditRegions]
  );

  useEffect(() => {
    if (!audioEditSelection || audioEditSelection.endSec <= audioEditSelection.startSec) return;
    if (!accessToken) return;
    const timer = window.setTimeout(() => {
      pushEditRegion(audioEditSelection.startSec, audioEditSelection.endSec, "selected");
    }, 400);
    return () => window.clearTimeout(timer);
  }, [audioEditSelection, accessToken, pushEditRegion]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!loadRequest?.token) return;

    setSarvamApiKey("");

    const fmt = normalizeAudioFormat(loadRequest.audioFormat || "wav");
    const mime =
      loadRequest.mimeType?.split(";")[0]?.trim() ||
      loadRequest.audioBlob?.type?.split(";")[0]?.trim() ||
      audioMimeType(fmt);

    const g = loadRequest.gender === "Male" ? "Male" : "Female";
    const sp = resolveSpeaker(g, loadRequest.speaker || "");

    pendingRawScriptFileRef.current = null;
    setText(loadRequest.scriptText || "");
    setLanguage(loadRequest.language || "English");
    setGender(g);
    setSpeaker(sp);
    setGeneratedFormat(fmt);
    setExportFormat(fmt);
    setAudioBlob(null);
    setPreviousAudioBlob(null);
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    activityLogIdRef.current = null;
    editRegionsRef.current = [];

    const source = loadRequest.audioBlob;
    if (!source) return;

    (async () => {
      try {
        const bytes = await source.arrayBuffer();
        if (!bytes.byteLength) {
          setError("Saved audio is empty.");
          return;
        }
        setAudioBlob(new Blob([bytes], { type: mime }));
      } catch {
        setError("Could not load saved audio for editing.");
      }
    })();
    setAudioEditMode(true);
    setAudioEditSelection(null);
    setAddMenuOpen(false);
    setCorrectionLayer(null);
    setError("");
    setSuccess(false);
    setSaved(false);
    setLoadedFromHistoryName(loadRequest.fileName || "saved clip");
    setLastSavedName(loadRequest.fileName || "");

    onLoadRequestConsumed?.();

    requestAnimationFrame(() => {
      audioSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot per loadRequest.token
  }, [loadRequest?.token]);

  const buildFileForUpload = async () => {
    const trimmed = text.trim();
    if (trimmed) {
      return new File([text], "input.txt", { type: "text/plain;charset=utf-8" });
    }
    const pending = pendingRawScriptFileRef.current;
    if (pending?.size) return pending;
    return null;
  };

  const handleGenerate = async () => {
    setError("");
    setSuccess(false);
    setSaved(false);
    setAddMenuOpen(false);

    if (audioBlob && audioEditMode) {
      setError(
        "Select a region on the waveform, then use + to upload or record correction audio."
      );
      return;
    }

    setAudioBlob(null);
    setAudioEditMode(false);
    setAudioEditSelection(null);
    setCorrectionLayer(null);
    setPreviousAudioBlob(null);
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setGeneratedFormat("wav");
    setLoadedFromHistoryName("");
    activityLogIdRef.current = null;
    editRegionsRef.current = [];

    const file = await buildFileForUpload();
    if (!file) {
      setError("Please enter text or upload a .txt file.");
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("language", language);
    form.append("gender", gender);
    form.append("speaker", speaker);
    form.append("audio_format", "wav");
    const trimmedSarvam = sarvamApiKey.trim();
    if (trimmedSarvam) form.append("sarvam_api_key", trimmedSarvam);

    const base = apiBaseUrl.replace(/\/$/, "");
    setLoading(true);
    try {
      const r = await fetch(`${base}/generate-tts`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          ...sarvamKeyHeaders(sarvamApiKey),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: form,
      });
      if (!r.ok) {
        const t = await r.text();
        let message = t || `HTTP ${r.status}`;
        try {
          const parsed = JSON.parse(t);
          if (parsed.detail) {
            message =
              typeof parsed.detail === "string"
                ? parsed.detail
                : JSON.stringify(parsed.detail);
          }
        } catch {
          /* plain text */
        }
        setError(message);
        return;
      }
      const raw = await r.blob();
      const responseFormat = formatFromMimeType(r.headers.get("Content-Type"));
      const mime =
        r.headers.get("Content-Type")?.split(";")[0]?.trim() || audioMimeType(responseFormat);
      setGeneratedFormat(responseFormat);
      const outBlob = raw.type ? raw : new Blob([raw], { type: mime });
      setExportFormat(responseFormat);
      setAudioBlob(outBlob);
      setSuccess(true);
      activityLogIdRef.current = r.headers.get("X-Activity-Log-Id") || null;
      editRegionsRef.current = [];

      requestAnimationFrame(() => {
        audioSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  const fetchAudioForFormat = async (targetFormat) => {
    const target = normalizeAudioFormat(targetFormat);
    if (!audioBlob || !(audioBlob instanceof Blob) || audioBlob.size <= 0) {
      throw new Error("No audio available to export.");
    }
    if (target === generatedFormat) return audioBlob;

    const base = apiBaseUrl.replace(/\/$/, "");
    const sourceBytes = await audioBlob.arrayBuffer();
    const form = new FormData();
    form.append(
      "file",
      new Blob([sourceBytes], { type: audioBlob.type || audioMimeType(generatedFormat) }),
      `audio.${generatedFormat}`
    );
    form.append("audio_format", target);
    form.append("source_format", generatedFormat);

    const r = await fetch(`${base}/convert-audio`, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: form,
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t || `HTTP ${r.status}`);
    }
    const converted = await r.blob();
    const mime =
      r.headers.get("Content-Type")?.split(";")[0]?.trim() || audioMimeType(target);
    return new Blob([await converted.arrayBuffer()], { type: mime });
  };

  useEffect(() => {
    if (!error) return;
    showToast({ message: error, variant: "danger" });
    setError("");
  }, [error, showToast]);

  useEffect(() => {
    if (!success) return;
    showToast({
      message: "Audio ready — preview in the audio editor.",
      variant: "success",
    });
    setSuccess(false);
  }, [success, showToast]);

  useEffect(() => {
    if (!saved) return;
    showToast({
      message: `Saved to History as "${lastSavedName}". Open the History tab to listen or download.`,
      variant: "info",
    });
    setSaved(false);
  }, [saved, lastSavedName, showToast]);

  useEffect(() => {
    if (!downloadMenuOpen) return undefined;
    const onDoc = (e) => {
      if (downloadFormatRef.current?.contains(e.target)) return;
      setDownloadMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [downloadMenuOpen]);

  const downloadAudio = async (format) => {
    if (!audioBlob || downloadingFormat) return;
    const target = normalizeAudioFormat(format ?? exportFormat);
    setDownloadingFormat(target);
    setError("");
    try {
      const blob = await fetchAudioForFormat(target);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Audio-file.${target}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setDownloadingFormat(null);
    }
  };

  const openSaveModal = () => {
    if (!audioBlob) return;
    setSaveFileName("");
    setShowSaveModal(true);
  };

  const closeSaveModal = () => {
    if (saving) return;
    setShowSaveModal(false);
    setSaveFileName("");
  };

  const confirmSaveToHistory = async () => {
    if (!audioBlob || !saveFileName.trim()) return;
    if (!accessToken) {
      setError("You must be signed in to save to history.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const target = normalizeAudioFormat(exportFormat);
      const blobForSave =
        target === generatedFormat ? audioBlob : await fetchAudioForFormat(target);
      if (!(blobForSave instanceof Blob) || blobForSave.size <= 0) {
        throw new Error("Audio is not ready to save. Try again after preview loads.");
      }
      const fileName = sanitizeFileName(saveFileName);
      const scriptForSave = scriptTextForHistorySave(text);
      const audioOnlySave = isAudioOnlyScript(scriptForSave);
      const saved = await saveHistoryEntry(apiBaseUrl, accessToken, {
        scriptText: scriptForSave,
        fileName,
        language,
        gender: audioOnlySave ? "" : gender,
        speaker: audioOnlySave ? "" : speaker,
        audioFormat: target,
        audioBlob: blobForSave,
      });
      if (activityLogIdRef.current) {
        if (saved?.id) {
          await linkActivityLogHistory(accessToken, activityLogIdRef.current, saved.id);
        }
        await updateActivityLog(accessToken, activityLogIdRef.current, {
          textContent: scriptForSave,
          fileName,
          language,
          gender: audioOnlySave ? "" : gender,
          speaker: audioOnlySave ? "" : speaker,
          audioFormat: target,
          audioBlob: blobForSave,
          editRegions: editRegionsRef.current,
          linkedHistoryId: saved?.id,
        });
      }
      onHistorySaved?.();
      setLastSavedName(fileName);
      setSaved(true);
      setShowSaveModal(false);
      setSaveFileName("");
      activityLogIdRef.current = null;
      editRegionsRef.current = [];
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const onTxtChosen = (e) => {
    const f = e.target.files?.[0] || null;
    e.target.value = "";
    if (!f) return;
    if (!f.size) {
      setError("That file is empty.");
      return;
    }
    pendingRawScriptFileRef.current = f;
    setError("");
    const reader = new FileReader();
    reader.onload = () => {
      setText(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      setText("");
      setError(
        "Could not read a text preview of this file. It may still work if you click Generate."
      );
    };
    reader.readAsText(f);
  };

  const onScriptChange = (e) => {
    pendingRawScriptFileRef.current = null;
    setText(e.target.value);
  };

  const triggerTxtPick = () => txtInputRef.current?.click();

  const triggerAudioPick = () => audioUploadInputRef.current?.click();

  const onMainAudioChosen = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.size) {
      setError("That audio file is empty.");
      return;
    }
    setError("");
    setSuccess(true);
    setSaved(false);
    setAudioEditMode(false);
    setAudioEditSelection(null);
    setAddMenuOpen(false);
    setCorrectionLayer(null);
    setLoadedFromHistoryName("");
    activityLogIdRef.current = null;
    editRegionsRef.current = [];
    const fmt = formatFromFile(f);
    const mime = f.type?.split(";")[0]?.trim() || audioMimeType(fmt);
    try {
      const bytes = await f.arrayBuffer();
      if (!bytes.byteLength) {
        setError("That audio file is empty.");
        return;
      }
      const blob = new Blob([bytes], { type: mime });
      setGeneratedFormat(fmt);
      setExportFormat(fmt);
      setAudioBlob(blob);

      if (accessToken) {
        const scriptForLog = scriptTextForHistorySave(text);
        const audioOnlySave = isAudioOnlyScript(scriptForLog);
        const baseName = sanitizeFileName(f.name.replace(/\.[^.]+$/i, "") || "upload");
        recordActivityLog(accessToken, {
          activityType: "tts",
          textContent: scriptForLog,
          fileName: baseName,
          language,
          gender: audioOnlySave ? "" : gender,
          speaker: audioOnlySave ? "" : speaker,
          audioBlob: blob,
          audioFormat: fmt,
        })
          .then(({ id }) => {
            activityLogIdRef.current = id || null;
          })
          .catch((err) => {
            console.warn("Admin activity log (audio upload) failed:", err);
          });
      }
    } catch {
      setError("Could not read that audio file. Try a WAV or MP3 file.");
    }
  };

  const focusScript = () => {
    scriptRef.current?.focus();
    scriptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const canShowAddMenu = Boolean(audioEditMode && audioEditSelection);
  const canGenerateFromScript = Boolean(text.trim());

  const openCorrectionUpload = () => {
    if (!audioEditSelection) {
      setError("Select a region on the waveform first.");
      return;
    }
    correctionFileInputRef.current?.click();
  };

  const onCorrectionFileChosen = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setCorrectionLayer({ fileName: f.name, blob: f });
    setError("");
    if (audioEditSelection) {
      syncCorrectionAudio(f, f.name, audioEditSelection);
    }
  };

  const openCorrectionRecord = () => {
    if (!audioEditSelection) {
      setError("Select a region on the waveform first.");
      return;
    }
    setShowRecordModal(true);
  };

  const handleRecordSave = ({ blob, fileName }) => {
    setCorrectionLayer({ fileName, blob });
    setError("");
    if (audioEditSelection) {
      syncCorrectionAudio(blob, fileName, audioEditSelection);
    }
  };

  const handleCloneCorrection = async () => {
    if (!audioBlob || !correctionLayer || !audioEditSelection) {
      setError("Select a region and add correction audio before cloning.");
      return;
    }
    setCloning(true);
    setError("");
    showToast({
      message:
        "Cloning… The first run can take some minutes while voice models download and load. Please keep this tab open.",
      variant: "info",
    });
    try {
      const { startSec, endSec } = audioEditSelection;
      const result = await correctTtsSegment(apiBaseUrl, apiKey, {
        originalBlob: audioBlob,
        correctionBlob: correctionLayer.blob,
        startSec,
        endSec,
        language,
        accessToken,
        sarvamApiKey,
      });
      const correctedBytes = await result.arrayBuffer();
      if (!correctedBytes.byteLength) {
        throw new Error("Clone returned empty audio.");
      }
      const correctedMime =
        result.type?.split(";")[0]?.trim() || audioMimeType("wav");
      const correctedBlob = new Blob([correctedBytes], { type: correctedMime });
      pushEditRegion(startSec, endSec, "replaced");
      setAudioBlob(correctedBlob);
      setGeneratedFormat("wav");
      setExportFormat("wav");
      setCorrectionLayer(null);
      setAudioEditSelection(null);
      setAudioEditMode(false);
      setAddMenuOpen(false);
      setSuccess(true);

      if (accessToken) {
        const logId = await ensureActivityLog();
        if (logId) {
          const pendingName = pendingRawScriptFileRef.current?.name?.replace(/\.[^.]+$/i, "");
          const baseName = sanitizeFileName(
            lastSavedName || loadedFromHistoryName || pendingName || "tts_output"
          );
          const scriptForSave = scriptTextForHistorySave(text);
          const audioOnlySave = isAudioOnlyScript(scriptForSave);
          updateActivityLog(accessToken, logId, {
            textContent: scriptForSave,
            fileName: baseName,
            language,
            gender: audioOnlySave ? "" : gender,
            speaker: audioOnlySave ? "" : speaker,
            audioFormat: "wav",
            audioBlob: correctedBlob,
            editRegions: editRegionsRef.current,
          }).catch((err) => {
            console.warn("Admin activity log (TTS clone) failed:", err);
          });
        }
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setCloning(false);
    }
  };

  const handleDeleteClip = async () => {
    if (!audioBlob || !audioEditSelection) {
      setError("Select a region on the waveform first.");
      return;
    }
    setDeleting(true);
    setError("");
    const { startSec, endSec } = audioEditSelection;
    showToast({
      message: `Deleting region ${startSec.toFixed(2)}s – ${endSec.toFixed(2)}s from audio…`,
      variant: "info",
    });
    try {
      const { trimmedBlob, deletedBlob } = await deleteTtsClip(apiBaseUrl, apiKey, {
        originalBlob: audioBlob,
        startSec,
        endSec,
        language,
        accessToken,
        includeDeletedClip: true,
      });
      const trimmedBytes = await trimmedBlob.arrayBuffer();
      if (!trimmedBytes.byteLength) {
        throw new Error("Delete clip returned empty audio.");
      }
      const trimmedMime = trimmedBlob.type?.split(";")[0]?.trim() || audioMimeType("wav");
      const trimmedAudio = new Blob([trimmedBytes], { type: trimmedMime });

      setPreviousAudioBlob(audioBlob);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => {
        setPreviousAudioBlob(null);
        undoTimerRef.current = null;
      }, 30_000);

      editRegionsRef.current = mergeEditRegionEntry(
        editRegionsRef.current,
        buildEditRegionEntry(startSec, endSec, "deleted")
      );
      setAudioBlob(trimmedAudio);
      setGeneratedFormat("wav");
      setExportFormat("wav");
      setAudioEditSelection(null);
      setAddMenuOpen(false);
      setCorrectionLayer(null);
      showToast({
        message: "Region deleted — audio updated. Use Undo to revert.",
        variant: "success",
      });

      if (accessToken) {
        const logId = await ensureActivityLog();
        if (logId && deletedBlob) {
          try {
            const uploadResult = await uploadActivityLogCorrectionAudio(accessToken, logId, {
              startSec,
              endSec,
              fileName: "deleted_clip",
              audioBlob: deletedBlob,
              audioFormat: "wav",
            });
            if (uploadResult?.correctionAudioId) {
              editRegionsRef.current = attachCorrectionAudio(
                editRegionsRef.current,
                startSec,
                endSec,
                {
                  correctionAudioId: uploadResult.correctionAudioId,
                  correctionFileName: "deleted_clip",
                }
              );
            }
          } catch (err) {
            console.warn("Admin activity log (deleted clip audio) failed:", err);
          }
        }
        syncEditRegions(editRegionsRef.current);
        if (logId) {
          const pendingName = pendingRawScriptFileRef.current?.name?.replace(/\.[^.]+$/i, "");
          const baseName = sanitizeFileName(
            lastSavedName || loadedFromHistoryName || pendingName || "tts_output"
          );
          const scriptForSave = scriptTextForHistorySave(text);
          const audioOnlySave = isAudioOnlyScript(scriptForSave);
          updateActivityLog(accessToken, logId, {
            textContent: scriptForSave,
            fileName: baseName,
            language,
            gender: audioOnlySave ? "" : gender,
            speaker: audioOnlySave ? "" : speaker,
            audioFormat: "wav",
            audioBlob: trimmedAudio,
            editRegions: editRegionsRef.current,
          }).catch((err) => {
            console.warn("Admin activity log (TTS delete) failed:", err);
          });
        }
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setDeleting(false);
    }
  };

  const handleUndoDelete = () => {
    if (!previousAudioBlob) return;
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setAudioBlob(previousAudioBlob);
    setPreviousAudioBlob(null);
    setGeneratedFormat("wav");
    setExportFormat("wav");
    setAudioEditSelection(null);
    showToast({ message: "Delete revoked — original audio restored.", variant: "info" });
  };

  return (
    <div
      className={`studio-dashboard${audioBlob ? " studio-dashboard--audio-ready" : ""}`}
    >
      <input
        ref={txtInputRef}
        type="file"
        accept=".txt,.TXT,.text,text/plain,text/*"
        className="studio-sr-only"
        onChange={onTxtChosen}
      />
      <input
        ref={audioUploadInputRef}
        type="file"
        accept=".wav,.mp3,.WAV,.MP3,audio/wav,audio/mpeg,audio/*"
        className="studio-sr-only"
        onChange={onMainAudioChosen}
      />
      <input
        ref={correctionFileInputRef}
        type="file"
        accept=".wav,.mp3,audio/wav,audio/mpeg,audio/*"
        className="studio-sr-only"
        onChange={onCorrectionFileChosen}
      />

      <section className="studio-glass studio-card studio-card-script">
        <header className="studio-card-head">
          <h2 className="studio-card-title">Script editor</h2>
        </header>

        <div className="studio-card-body">
        <div className="studio-select-row">
          <label className="studio-field studio-field-grow">
            <span className="studio-field-icon" aria-hidden>
              <StudioIcon name="language" size={16} />
            </span>
            <StudioSelect
              aria-label="Language"
              value={language}
              onChange={onLanguageChange}
              options={LANGUAGES}
            />
          </label>
          <label className="studio-field studio-field-grow">
            <span className="studio-field-icon" aria-hidden>
              <StudioIcon name="gender" size={16} />
            </span>
            <StudioSelect
              aria-label="Gender"
              value={gender}
              onChange={onGenderChange}
              options={GENDERS}
            />
          </label>
          <label className="studio-field studio-field-grow">
            <span className="studio-field-icon" aria-hidden>
              <StudioIcon name="speaker" size={16} />
            </span>
            <StudioSelect
              aria-label="Speaker"
              value={speaker}
              onChange={setSpeaker}
              options={speakerOptions}
            />
          </label>
        </div>

        <SarvamApiKeyField
          value={sarvamApiKey}
          onChange={onSarvamKeyChange}
          id="tts-sarvam-api-key"
        />

        <textarea
          ref={scriptRef}
          className="studio-textarea"
          rows={10}
          placeholder="Enter the Script"
          value={text}
          onChange={onScriptChange}
        />

        <div className="studio-card-actions">
          <button type="button" className="studio-btn studio-btn-ghost" onClick={triggerTxtPick}>
            <StudioIcon name="upload" className="studio-btn-icon" size={18} />
            Upload txt File
          </button>
          <button
            type="button"
            className="studio-btn studio-btn-glow"
            disabled={loading || !canGenerateFromScript}
            title={
              canGenerateFromScript
                ? "Generate audio from script"
                : "Enter script text to enable Generate"
            }
            onClick={handleGenerate}
          >
            {loading ? (
              <>
                <Spinner animation="border" size="sm" className="studio-btn-spinner" />
                Generating…
              </>
            ) : (
              <>
                <StudioIcon name="generate" className="studio-btn-icon" size={18} />
                Generate Audio
              </>
            )}
          </button>
        </div>
        </div>
      </section>

      <section
        ref={audioSectionRef}
        className={`studio-glass studio-card studio-card-audio${correctionLayer ? " studio-card-audio--with-layer" : ""}`}
      >
        <header className="studio-card-head studio-card-head-split">
          <h2 className="studio-card-title">Audio editor</h2>
          <div className="studio-audio-toolbar">
            <button
              type="button"
              className={`studio-icon-btn${audioBlob && audioEditMode ? " is-active" : ""}`}
              title={
                audioBlob
                  ? audioEditMode
                    ? "Exit audio edit mode"
                    : "Edit audio — drag on the waveform to select a region"
                  : "Edit script"
              }
              onClick={() => {
                if (audioBlob) {
                  setAudioEditMode((v) => {
                    const next = !v;
                    if (!next) {
                      setAudioEditSelection(null);
                      setAddMenuOpen(false);
                      setCorrectionLayer(null);
                    }
                    return next;
                  });
                } else {
                  focusScript();
                }
              }}
            >
              <StudioIcon name="edit" size={18} />
            </button>
            <button
              type="button"
              className="studio-toolbar-btn"
              disabled={!audioBlob}
              onClick={openSaveModal}
            >
              <StudioIcon name="save" className="studio-toolbar-btn-icon" size={18} />
              Save
            </button>
            {/* <div
              ref={downloadFormatRef}
              className={`studio-download-format${downloadMenuOpen ? " is-open" : ""}`}
            >
              <button
                type="button"
                className="studio-download-format-btn"
                title={`Download ${exportFormat.toUpperCase()}`}
                aria-label={`Download ${exportFormat.toUpperCase()}`}
                disabled={!audioBlob || downloadingFormat !== null}
                onClick={() => downloadAudio(exportFormat)}
              >
                {downloadingFormat ? (
                  <Spinner animation="border" size="sm" className="studio-format-spinner" />
                ) : (
                  <StudioIcon name="wav-mp3" className="studio-download-format-icon" size={16} />
                )}
              </button>
              <span className="studio-download-format-label" aria-hidden>
                {exportFormat.toUpperCase()}
              </span>
              <button
                type="button"
                className="studio-download-format-toggle"
                aria-label="Choose download format"
                aria-haspopup="menu"
                aria-expanded={downloadMenuOpen}
                disabled={!audioBlob || downloadingFormat !== null}
                onClick={() => setDownloadMenuOpen((v) => !v)}
              >
                <IconChevronDown />
              </button>
              {downloadMenuOpen && (
                <div className="studio-download-format-menu" role="menu" aria-label="Download format">
                  {["wav", "mp3"].map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      role="menuitemradio"
                      aria-checked={exportFormat === fmt}
                      className={`studio-download-format-option${
                        exportFormat === fmt ? " is-selected" : ""
                      }`}
                      onClick={() => {
                        setExportFormat(fmt);
                        setDownloadMenuOpen(false);
                        downloadAudio(fmt);
                      }}
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div> */}
          </div>
        </header>

        <div className="studio-card-body studio-card-body-audio">
        {audioBlob && audioEditMode && (
          <div className="studio-audio-edit-hint" role="status">
            <span className="studio-audio-edit-hint-text">
              {loadedFromHistoryName && !correctionLayer && (
                <>
                  Editing <strong>{loadedFromHistoryName}</strong> from History —{" "}
                </>
              )}
              {correctionLayer
                ? "Preview correction below, then click Clone to replace the selected region."
                : "Select on the waveform. Click to hear a position, or drag to select. Use + to upload or record audio."}
            </span>
            {audioEditSelection && audioEditSelection.endSec > audioEditSelection.startSec && (
              <SelectionRangeEditor
                selection={audioEditSelection}
                duration={audioDuration}
                onChange={setAudioEditSelection}
                onClear={() => setAudioEditSelection(null)}
                onDelete={handleDeleteClip}
                deleting={deleting}
                canUndo={Boolean(previousAudioBlob)}
                onUndo={handleUndoDelete}
              />
            )}
            {!audioEditSelection && previousAudioBlob && (
              <span className="studio-audio-edit-hint-actions">
                <button
                  type="button"
                  className="studio-audio-edit-undo"
                  title="Undo last deletion — restores the audio before the cut"
                  onClick={handleUndoDelete}
                >
                  ↩ Undo delete
                </button>
              </span>
            )}
          </div>
        )}
        <div className="studio-preview-shell">
          <div className="studio-preview-body">
            {audioBlob ? (
              <div className="studio-preview-audio">
                <AudioPlayer
                  blob={audioBlob}
                  mimeType={audioMimeType(generatedFormat)}
                  variant="studio"
                  editMode={audioEditMode}
                  selectionSec={audioEditSelection}
                  onSelectionSecChange={setAudioEditSelection}
                  onDurationChange={setAudioDuration}
                  showAddMenu={canShowAddMenu}
                  addMenuOpen={addMenuOpen}
                  onAddMenuToggle={setAddMenuOpen}
                  onAddMenuUpload={openCorrectionUpload}
                  onAddMenuRecord={openCorrectionRecord}
                />
              </div>
            ) : (
              <>
                <div className="studio-preview-empty">
                  <p className="studio-preview-empty-title">No Preview Available</p>
                  <p className="studio-preview-empty-sub">Choose</p>
                </div>
                <div className="studio-preview-uploads">
                  <button type="button" className="studio-btn studio-btn-ghost" onClick={triggerTxtPick}>
                    <StudioIcon name="upload" className="studio-btn-icon" size={18} />
                    Upload txt File
                  </button>
                  <button
                    type="button"
                    className="studio-btn studio-btn-ghost"
                    onClick={triggerAudioPick}
                  >
                    <StudioIcon name="upload" className="studio-btn-icon" size={18} />
                    Upload Audio
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {correctionLayer && (
          <CorrectionLayerPanel
            fileName={correctionLayer.fileName}
            blob={correctionLayer.blob}
            cloning={cloning}
            onClone={handleCloneCorrection}
            onDelete={() => setCorrectionLayer(null)}
            onUpload={openCorrectionUpload}
            onRecord={openCorrectionRecord}
          />
        )}
        </div>
      </section>

      <RecordCorrectionModal
        open={showRecordModal}
        onClose={() => setShowRecordModal(false)}
        onSave={handleRecordSave}
      />

      <SaveAudioModal
        open={showSaveModal}
        fileName={saveFileName}
        saving={saving}
        onFileNameChange={setSaveFileName}
        onClose={closeSaveModal}
        onSave={confirmSaveToHistory}
      />
    </div>
  );
}
