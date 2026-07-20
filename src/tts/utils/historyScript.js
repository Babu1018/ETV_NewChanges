/** Stored in DB when the user saves uploaded audio without a script (upload/edit workflow). */
export const AUDIO_ONLY_RECORDING_LABEL = "Audio-only recording";

/** Shown in History Preview (and script modal) for upload-audio saves — not stored in DB. */
export const AUDIO_ONLY_PREVIEW_LABEL =
  "If the User Uploads an audio file instead of a text file";

/** Shown in History Voice column for upload-audio saves. */
export const AUDIO_ONLY_VOICE_LABEL = "-";

const LEGACY_AUDIO_ONLY_LABELS = new Set([
  "uploaded audio",
  "audio-only recording",
]);

export function isAudioOnlyScript(scriptText) {
  const trimmed = String(scriptText ?? "").trim();
  if (!trimmed) return true;
  if (trimmed === AUDIO_ONLY_RECORDING_LABEL) return true;
  return LEGACY_AUDIO_ONLY_LABELS.has(trimmed.toLowerCase());
}

/** Value sent to the API and stored in script_text / text_preview. */
export function scriptTextForHistorySave(scriptText) {
  const trimmed = String(scriptText ?? "").trim();
  return trimmed || AUDIO_ONLY_RECORDING_LABEL;
}

/** Max characters shown in the History table Preview cell before "View more". */
export const HISTORY_PREVIEW_CELL_MAX = 72;

/** Full script text for the preview modal and downloads. */
export function historyFullScript(scriptText, textPreview) {
  if (isAudioOnlyScript(scriptText) && isAudioOnlyScript(textPreview)) {
    return AUDIO_ONLY_PREVIEW_LABEL;
  }
  const script = String(scriptText ?? "").trim();
  if (script && !isAudioOnlyScript(script)) return script;
  const preview = String(textPreview ?? "").trim();
  if (preview && !isAudioOnlyScript(preview)) return preview;
  return AUDIO_ONLY_PREVIEW_LABEL;
}

/** Voice column: "-" for upload-audio saves; Male/Female when saved from script/TTS. */
export function historyVoiceLabel(scriptText, textPreview, gender) {
  if (isAudioOnlyScript(scriptText) && isAudioOnlyScript(textPreview)) {
    return AUDIO_ONLY_VOICE_LABEL;
  }
  const g = String(gender ?? "").trim();
  if (g === AUDIO_ONLY_VOICE_LABEL) return AUDIO_ONLY_VOICE_LABEL;
  if (g === "Male" || g === "Female") return g;
  return "—";
}

/** Short label for the Preview table cell. */
export function historyPreviewCell(scriptText, textPreview, maxLen = HISTORY_PREVIEW_CELL_MAX) {
  const full = historyFullScript(scriptText, textPreview);
  if (full.length <= maxLen) {
    return { full, short: full, showViewMore: false };
  }
  return {
    full,
    short: `${full.slice(0, maxLen).trimEnd()}…`,
    showViewMore: true,
  };
}

/** Preview column and tooltips in History. */
export function historyPreviewText(scriptText, textPreview) {
  if (isAudioOnlyScript(scriptText) && isAudioOnlyScript(textPreview)) {
    return AUDIO_ONLY_PREVIEW_LABEL;
  }
  const preview = String(textPreview ?? "").trim();
  const script = String(scriptText ?? "").trim();
  if (isAudioOnlyScript(script)) return AUDIO_ONLY_PREVIEW_LABEL;
  if (preview) return preview;
  if (script) return script.length > 120 ? `${script.slice(0, 120)}…` : script;
  return AUDIO_ONLY_PREVIEW_LABEL;
}

/** Load into the script editor — keep textarea empty for audio-only saves. */
export function scriptTextForEditor(scriptText) {
  return isAudioOnlyScript(scriptText) ? "" : String(scriptText ?? "");
}
