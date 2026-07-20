import { audioMimeType, formatFromFile, normalizeAudioFormat } from "./audioFormat.js";
import { readApiError, sanitizeUserMessage, wrapNetworkError } from "./apiError.js";
import { fetchWithTimeout, LONG_REQUEST_MS } from "./fetchWithTimeout.js";

function sanitizeHistoryItem(item) {
  if (!item || typeof item !== "object") return item;
  return {
    ...item,
    transcriptText: sanitizeUserMessage(item.transcriptText ?? ""),
    textPreview: sanitizeUserMessage(item.textPreview ?? ""),
    fileName: sanitizeUserMessage(item.fileName ?? ""),
    validatorName: sanitizeUserMessage(item.validatorName ?? ""),
  };
}

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

export async function fetchHistoryList(apiBaseUrl, accessToken) {
  try {
    const res = await fetchWithTimeout(
      `${apiBaseUrl}/history`,
      historyFetchOptions(accessToken)
    );
    if (!res.ok) throw new Error(await readApiError(res));
    const items = await res.json();
    return Array.isArray(items) ? items.map(sanitizeHistoryItem) : items;
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

export async function saveHistoryEntry(apiBaseUrl, accessToken, payload) {
  const { transcriptText, fileName, language, validatorName, audioBlob, audioFormat } =
    payload;
  if (!(audioBlob instanceof Blob) || audioBlob.size <= 0) {
    throw new Error("No audio to save. Upload and transcribe first.");
  }
  const fmt = normalizeAudioFormat(audioFormat);
  const uploadName = `${String(fileName || "untitled")}.${fmt}`;
  const mime = audioBlob.type?.split(";")[0]?.trim() || audioMimeType(fmt);
  const bytes = await audioBlob.arrayBuffer();

  const form = new FormData();
  form.append("transcript_text", String(transcriptText ?? ""));
  form.append("file_name", String(fileName ?? "untitled"));
  form.append("language", String(language ?? ""));
  form.append("validator_name", String(validatorName ?? ""));
  form.append("audio_format", fmt);
  form.append("audio", new Blob([bytes], { type: mime }), uploadName);

  const res = await fetchWithTimeout(
    `${apiBaseUrl}/history`,
    historyFetchOptions(accessToken, {
      method: "POST",
      body: form,
    }),
    120_000
  );
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json();
}

export async function deleteHistoryEntry(apiBaseUrl, accessToken, id) {
  const historyId = encodeURIComponent(String(id ?? "").trim());
  const res = await fetchWithTimeout(
    `${apiBaseUrl}/history/${historyId}`,
    historyFetchOptions(accessToken, { method: "DELETE" })
  );
  if (!res.ok) throw new Error(await readApiError(res));
}

export async function clearAllHistory(apiBaseUrl, accessToken) {
  const res = await fetchWithTimeout(
    `${apiBaseUrl}/history`,
    historyFetchOptions(accessToken, { method: "DELETE" })
  );
  if (!res.ok) throw new Error(await readApiError(res));
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
    if (!res.ok) throw new Error(await readApiError(res));
    return res.blob();
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

export const HISTORY_PREVIEW_MAX = 100;

export function historyFullText(item) {
  const full = sanitizeUserMessage(String(item?.transcriptText ?? item?.textPreview ?? "").trim());
  return full || "—";
}

export function isHistoryPreviewLong(item, maxLen = HISTORY_PREVIEW_MAX) {
  const full = String(item?.transcriptText ?? item?.textPreview ?? "").trim();
  return full.length > maxLen;
}

export function historyTablePreview(item, maxLen = HISTORY_PREVIEW_MAX) {
  const full = sanitizeUserMessage(String(item?.transcriptText ?? item?.textPreview ?? "").trim());
  if (!full) return "—";
  if (full.length <= maxLen) return full;
  return `${full.slice(0, maxLen)}…`;
}

/** @deprecated use historyTablePreview / historyFullText */
export function historyPreviewText(transcriptText, textPreview) {
  const preview = String(textPreview ?? "").trim();
  const full = String(transcriptText ?? "").trim();
  if (preview) return preview.length > 120 ? `${preview.slice(0, 120)}…` : preview;
  if (full) return full.length > 120 ? `${full.slice(0, 120)}…` : full;
  return "—";
}

export async function deleteHistoryEntries(apiBaseUrl, accessToken, ids) {
  for (const id of ids) {
    await deleteHistoryEntry(apiBaseUrl, accessToken, id);
  }
}

export { formatFromFile };
