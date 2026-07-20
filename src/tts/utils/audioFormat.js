export const AUDIO_FORMATS = ["wav", "mp3"];

export function normalizeAudioFormat(value) {
  const fmt = String(value || "wav").toLowerCase().replace(/^\./, "");
  return fmt === "mp3" ? "mp3" : "wav";
}

export function audioMimeType(format) {
  return normalizeAudioFormat(format) === "mp3" ? "audio/mpeg" : "audio/wav";
}

export function formatFromMimeType(mime) {
  if (!mime) return "wav";
  return mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : "wav";
}

export function formatLabel(format) {
  return normalizeAudioFormat(format).toUpperCase();
}

export function formatFromFile(file) {
  if (!file) return "wav";
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".mp3")) return "mp3";
  if (name.endsWith(".wav")) return "wav";
  return formatFromMimeType(file.type);
}
