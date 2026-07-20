export function normalizeAudioFormat(fmt) {
  const f = String(fmt || "wav").toLowerCase().replace(/^\./, "");
  if (f === "wave") return "wav";
  if (f === "mpeg") return "mp3";
  return f || "wav";
}

export function audioMimeType(fmt) {
  const f = normalizeAudioFormat(fmt);
  const map = {
    wav: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };
  return map[f] || "application/octet-stream";
}

export function formatFromFile(file) {
  if (!file?.name) return "wav";
  const ext = file.name.split(".").pop()?.toLowerCase();
  return normalizeAudioFormat(ext);
}
