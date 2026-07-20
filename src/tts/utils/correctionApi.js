import { sarvamKeyHeaders } from "../../utils/sarvamKeyStorage.js";

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function correctTtsSegment(apiBaseUrl, apiKey, {
  originalBlob,
  correctionBlob,
  startSec,
  endSec,
  language = "English",
  accessToken = "",
  sarvamApiKey = "",
}) {
  const base = apiBaseUrl.replace(/\/$/, "");
  const form = new FormData();
  const origName =
    originalBlob instanceof File && originalBlob.name ? originalBlob.name : "original.wav";
  const corrExt = correctionBlob.type?.includes("webm") ? "webm" : "wav";
  const origMime = originalBlob.type?.split(";")[0]?.trim() || "audio/wav";
  const corrMime = correctionBlob.type?.split(";")[0]?.trim() || "audio/wav";
  const [origBytes, corrBytes] = await Promise.all([
    originalBlob.arrayBuffer(),
    correctionBlob.arrayBuffer(),
  ]);
  form.append("original_audio", new Blob([origBytes], { type: origMime }), origName);
  form.append("correction_audio", new Blob([corrBytes], { type: corrMime }), `correction.${corrExt}`);
  form.append("mistake_start_sec", String(startSec));
  form.append("mistake_end_sec", String(endSec));
  form.append("language", language);
  const trimmedSarvam = (sarvamApiKey || "").trim();
  if (trimmedSarvam) form.append("sarvam_api_key", trimmedSarvam);

  const res = await fetch(`${base}/correct-tts`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      ...sarvamKeyHeaders(sarvamApiKey),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    let message = t || `Correction failed (${res.status})`;
    try {
      const parsed = JSON.parse(t);
      if (parsed.detail) {
        message = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
      }
    } catch {
      /* plain text body */
    }
    throw new Error(message);
  }
  return res.blob();
}

/**
 * Delete a selected region from audio.
 * When includeDeletedClip is true, returns { trimmedBlob, deletedBlob }.
 */
export async function deleteTtsClip(apiBaseUrl, apiKey, {
  originalBlob,
  startSec,
  endSec,
  language = "English",
  accessToken = "",
  includeDeletedClip = false,
}) {
  const base = apiBaseUrl.replace(/\/$/, "");
  const form = new FormData();
  const origName =
    originalBlob instanceof File && originalBlob.name ? originalBlob.name : "original.wav";
  const origMime = originalBlob.type?.split(";")[0]?.trim() || "audio/wav";
  const origBytes = await originalBlob.arrayBuffer();
  form.append("original_audio", new Blob([origBytes], { type: origMime }), origName);
  form.append("delete_start_sec", String(startSec));
  form.append("delete_end_sec", String(endSec));
  form.append("language", language);
  if (includeDeletedClip) {
    form.append("include_deleted_clip", "true");
  }

  const res = await fetch(`${base}/delete-clip`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    let message = t || `Delete clip failed (${res.status})`;
    try {
      const parsed = JSON.parse(t);
      if (parsed.detail) {
        message = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
      }
    } catch {
      /* plain text body */
    }
    throw new Error(message);
  }

  if (includeDeletedClip) {
    const data = await res.json();
    const mime = data.media_type || "audio/wav";
    return {
      trimmedBlob: base64ToBlob(data.trimmed_audio_base64, mime),
      deletedBlob: base64ToBlob(data.deleted_audio_base64, mime),
    };
  }

  return { trimmedBlob: await res.blob(), deletedBlob: null };
}
