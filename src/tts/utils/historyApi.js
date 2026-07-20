import { audioMimeType, normalizeAudioFormat } from "./audioFormat.js";
import { readApiError, wrapNetworkError } from "./apiError.js";
import { fetchWithTimeout, LONG_REQUEST_MS } from "./fetchWithTimeout.js";
import {
  AUDIO_ONLY_VOICE_LABEL,
  isAudioOnlyScript,
  scriptTextForHistorySave,
} from "./historyScript.js";

/** History is private per logged-in user (JWT required). */
function historyHeaders(accessToken) {
  if (!accessToken) {
    throw new Error("You must be signed in to use history.");
  }
  return { Authorization: `Bearer ${accessToken}` };
}

function historyFetchOptions(accessToken, extra = {}) {
  return {
    cache: "no-store",
    headers: { ...historyHeaders(accessToken) },
    ...extra,
  };
}

/**
 * @param {string} apiBaseUrl e.g. "/tts"
 * @param {string} accessToken JWT from login
 */
export async function fetchHistoryList(apiBaseUrl, accessToken) {
  try {
    const res = await fetchWithTimeout(
      `${apiBaseUrl}/history`,
      historyFetchOptions(accessToken)
    );
    if (!res.ok) {
      throw new Error(await readApiError(res));
    }
    return res.json();
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

async function toHistoryUploadFile(audioBlob, fileName, audioFormat) {
  if (!(audioBlob instanceof Blob)) {
    throw new Error("No audio to save. Generate, upload, or clone audio first.");
  }
  if (audioBlob.size <= 0) {
    throw new Error("Audio file is empty. Re-upload or regenerate before saving.");
  }
  const fmt = normalizeAudioFormat(audioFormat);
  const uploadName = `${String(fileName || "untitled")}.${fmt}`;
  const mime = audioBlob.type?.split(";")[0]?.trim() || audioMimeType(fmt);
  const bytes = await audioBlob.arrayBuffer();
  if (!bytes.byteLength) {
    throw new Error("Audio file is empty. Re-upload or regenerate before saving.");
  }
  return {
    body: new Blob([bytes], { type: mime }),
    name: uploadName,
  };
}

export async function saveHistoryEntry(apiBaseUrl, accessToken, payload) {
  const { scriptText, fileName, language, gender, speaker, audioFormat, audioBlob } = payload;
  const upload = await toHistoryUploadFile(audioBlob, fileName, audioFormat);
  const storedScript = scriptTextForHistorySave(scriptText);
  const audioOnly = isAudioOnlyScript(storedScript);
  const form = new FormData();
  form.append("script_text", storedScript);
  form.append("file_name", String(fileName ?? "untitled"));
  form.append("language", String(language ?? ""));
  form.append("gender", audioOnly ? AUDIO_ONLY_VOICE_LABEL : String(gender ?? ""));
  form.append("speaker", audioOnly ? AUDIO_ONLY_VOICE_LABEL : String(speaker ?? ""));
  form.append("audio_format", normalizeAudioFormat(audioFormat));
  form.append("audio", upload.body, upload.name);
  const res = await fetchWithTimeout(
    `${apiBaseUrl}/history`,
    historyFetchOptions(accessToken, {
      method: "POST",
      body: form,
    })
  );
  if (!res.ok) {
    throw new Error(await readApiError(res));
  }
  return res.json();
}

export async function deleteHistoryEntry(apiBaseUrl, accessToken, id) {
  const historyId = encodeURIComponent(String(id ?? "").trim());
  const res = await fetchWithTimeout(
    `${apiBaseUrl}/history/${historyId}`,
    historyFetchOptions(accessToken, { method: "DELETE" })
  );
  if (!res.ok) {
    throw new Error(await readApiError(res));
  }
}

export async function clearAllHistory(apiBaseUrl, accessToken) {
  const res = await fetchWithTimeout(
    `${apiBaseUrl}/history`,
    historyFetchOptions(accessToken, { method: "DELETE" })
  );
  if (!res.ok) {
    throw new Error(await readApiError(res));
  }
}

export function historyAudioFetchUrl(apiBaseUrl, id) {
  const historyId = encodeURIComponent(String(id ?? "").trim());
  return `${apiBaseUrl}/history/${historyId}/audio`;
}

export async function fetchHistoryAudio(apiBaseUrl, accessToken, id, timeoutMs = LONG_REQUEST_MS) {
  try {
    const res = await fetchWithTimeout(
      historyAudioFetchUrl(apiBaseUrl, id),
      historyFetchOptions(accessToken),
      timeoutMs
    );
    if (!res.ok) {
      throw new Error(await readApiError(res));
    }
    return res.blob();
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

function historyDownloadFileName(item, format) {
  const stored = item.downloadName || `${item.fileName || "Audio-file"}.wav`;
  const dot = stored.lastIndexOf(".");
  const stem = dot > 0 ? stored.slice(0, dot) : stored;
  const fmt = normalizeAudioFormat(format ?? item.audioFormat);
  return `${stem}.${fmt}`;
}

async function convertHistoryAudioBlob(apiBaseUrl, apiKey, blob, sourceFormat, targetFormat) {
  const source = normalizeAudioFormat(sourceFormat);
  const target = normalizeAudioFormat(targetFormat);
  if (source === target) return blob;
  if (!apiKey) {
    throw new Error("API key is required to convert audio format. Set VITE_API_KEY in .env.local.");
  }

  const base = apiBaseUrl.replace(/\/$/, "");
  const sourceBytes = await blob.arrayBuffer();
  const form = new FormData();
  form.append(
    "file",
    new Blob([sourceBytes], { type: blob.type || audioMimeType(source) }),
    `audio.${source}`
  );
  form.append("audio_format", target);
  form.append("source_format", source);

  const res = await fetchWithTimeout(`${base}/convert-audio`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
  });
  if (!res.ok) {
    throw new Error(await readApiError(res));
  }
  const converted = await res.blob();
  const mime =
    res.headers.get("Content-Type")?.split(";")[0]?.trim() || audioMimeType(target);
  return new Blob([await converted.arrayBuffer()], { type: mime });
}

async function fetchHistoryAudioForFormat(apiBaseUrl, accessToken, apiKey, item, format) {
  const blob = await fetchHistoryAudio(apiBaseUrl, accessToken, item.id);
  const sourceFormat = normalizeAudioFormat(item.audioFormat);
  const targetFormat = normalizeAudioFormat(format);
  return convertHistoryAudioBlob(apiBaseUrl, apiKey, blob, sourceFormat, targetFormat);
}

function uniqueZipEntryName(name, used) {
  if (!used.has(name)) {
    used.set(name, 1);
    return name;
  }
  const count = used.get(name) + 1;
  used.set(name, count);
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    return `${name.slice(0, dot)} (${count})${name.slice(dot)}`;
  }
  return `${name} (${count})`;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadHistoryItems(
  apiBaseUrl,
  accessToken,
  items,
  { format, apiKey } = {}
) {
  if (!items?.length) return;
  const targetFormat = normalizeAudioFormat(format);

  if (items.length === 1) {
    const blob = await fetchHistoryAudioForFormat(
      apiBaseUrl,
      accessToken,
      apiKey,
      items[0],
      targetFormat
    );
    triggerBlobDownload(blob, historyDownloadFileName(items[0], targetFormat));
    return;
  }

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const usedNames = new Map();

  for (const item of items) {
    const blob = await fetchHistoryAudioForFormat(
      apiBaseUrl,
      accessToken,
      apiKey,
      item,
      targetFormat
    );
    const entryName = uniqueZipEntryName(
      historyDownloadFileName(item, targetFormat),
      usedNames
    );
    zip.file(entryName, blob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const stamp = new Date().toISOString().slice(0, 10);
  triggerBlobDownload(zipBlob, `Audio-files-${stamp}.zip`);
}
