import { audioMimeType, normalizeAudioFormat } from "./audioFormat.js";
import { readApiError, wrapNetworkError } from "./apiError.js";
import { joinAuthUrl } from "../components/auth/authApi.js";
import { defaultAuthApiBaseUrl } from "./authConfig.js";
import { getAuthToken } from "./authSession.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

/** Large audio uploads need more time than default auth calls. */
const ACTIVITY_LOG_TIMEOUT_MS = 120_000;

function resolveAccessToken(accessToken) {
  const token = String(accessToken || getAuthToken() || "").trim();
  if (!token) {
    throw new Error("You must be signed in to record activity.");
  }
  return token;
}

function authHeaders(accessToken) {
  return { Authorization: `Bearer ${resolveAccessToken(accessToken)}` };
}

async function buildAudioUpload(audioBlob, fileName, audioFormat) {
  if (!(audioBlob instanceof Blob) || audioBlob.size <= 0) {
    throw new Error("No audio to record.");
  }
  const fmt = normalizeAudioFormat(audioFormat);
  const uploadName = `${String(fileName || "recording")}.${fmt}`;
  const mime = audioBlob.type?.split(";")[0]?.trim() || audioMimeType(fmt);
  const bytes = await audioBlob.arrayBuffer();
  return {
    body: new Blob([bytes], { type: mime }),
    name: uploadName,
    format: fmt,
  };
}

function activityLogUrl(path = "") {
  const suffix = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return joinAuthUrl(defaultAuthApiBaseUrl, `/api/activity-logs${suffix}`);
}

/**
 * Record ASR/TTS activity for admin logs only (not user History).
 * @returns {Promise<{ id: string }>}
 */
export async function recordActivityLog(accessToken, payload) {
  const {
    activityType,
    textContent,
    fileName,
    language,
    validatorName = "",
    gender = "",
    speaker = "",
    audioBlob,
    audioFormat,
    editRegions,
    linkedHistoryId,
  } = payload;

  try {
    const upload = await buildAudioUpload(audioBlob, fileName, audioFormat);
    const form = new FormData();
    form.append("activity_type", activityType);
    form.append("text_content", String(textContent ?? ""));
    form.append("file_name", String(fileName ?? "recording"));
    form.append("language", String(language ?? ""));
    form.append("validator_name", String(validatorName ?? ""));
    form.append("gender", String(gender ?? ""));
    form.append("speaker", String(speaker ?? ""));
    form.append("audio_format", upload.format);
    if (editRegions != null) {
      form.append(
        "edit_regions",
        typeof editRegions === "string" ? editRegions : JSON.stringify(editRegions)
      );
    }
    if (linkedHistoryId) {
      form.append("linked_history_id", String(linkedHistoryId));
    }
    form.append("audio", upload.body, upload.name);

    const res = await fetchWithTimeout(
      activityLogUrl(),
      {
        method: "POST",
        headers: { ...authHeaders(accessToken) },
        body: form,
      },
      ACTIVITY_LOG_TIMEOUT_MS
    );
    if (!res.ok) throw new Error(await readApiError(res));
    return res.json();
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

/** Update the activity log when the user clicks Save (final file name / edits). */
export async function updateActivityLog(accessToken, logId, payload) {
  if (!logId) return null;

  const {
    textContent,
    fileName,
    language,
    validatorName = "",
    gender = "",
    speaker = "",
    audioBlob,
    audioFormat,
    editRegions,
    linkedHistoryId,
  } = payload;

  try {
    const upload = await buildAudioUpload(audioBlob, fileName, audioFormat);
    const form = new FormData();
    form.append("text_content", String(textContent ?? ""));
    form.append("file_name", String(fileName ?? "recording"));
    form.append("language", String(language ?? ""));
    form.append("validator_name", String(validatorName ?? ""));
    form.append("gender", String(gender ?? ""));
    form.append("speaker", String(speaker ?? ""));
    form.append("audio_format", upload.format);
    if (editRegions != null) {
      form.append(
        "edit_regions",
        typeof editRegions === "string" ? editRegions : JSON.stringify(editRegions)
      );
    }
    if (linkedHistoryId) {
      form.append("linked_history_id", String(linkedHistoryId));
    }
    form.append("audio", upload.body, upload.name);

    const res = await fetchWithTimeout(
      activityLogUrl(`/${logId}`),
      {
        method: "PATCH",
        headers: { ...authHeaders(accessToken) },
        body: form,
      },
      ACTIVITY_LOG_TIMEOUT_MS
    );
    if (!res.ok) throw new Error(await readApiError(res));
    return res.json();
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

/** Link activity log to a user History row after Save. */
export async function linkActivityLogHistory(accessToken, logId, historyId) {
  if (!logId || !historyId) return null;

  try {
    const res = await fetchWithTimeout(
      activityLogUrl(`/${logId}/history-link`),
      {
        method: "PATCH",
        headers: {
          ...authHeaders(accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ historyId: String(historyId) }),
      },
      30_000
    );
    if (!res.ok) throw new Error(await readApiError(res));
    return res.json();
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

/** Update TTS waveform selection / replacement regions (no audio re-upload). */
export async function patchActivityLogEditRegions(accessToken, logId, regions) {
  if (!logId) return null;

  try {
    const res = await fetchWithTimeout(
      activityLogUrl(`/${logId}/edit-regions`),
      {
        method: "PATCH",
        headers: {
          ...authHeaders(accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ regions: Array.isArray(regions) ? regions : [] }),
      },
      30_000
    );
    if (!res.ok) throw new Error(await readApiError(res));
    return res.json();
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

/** Sync ASR manual transcript edits to admin logs (no Save required). */
export async function patchActivityLogTranscriptEdit(
  accessToken,
  logId,
  { editedText, validatorName = "" }
) {
  if (!logId) return null;

  try {
    const res = await fetchWithTimeout(
      activityLogUrl(`/${logId}/transcript-edit`),
      {
        method: "PATCH",
        headers: {
          ...authHeaders(accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          editedText: String(editedText ?? ""),
          validatorName: String(validatorName ?? ""),
        }),
      },
      30_000
    );
    if (!res.ok) throw new Error(await readApiError(res));
    return res.json();
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

/** Store uploaded/recorded correction audio for a TTS edit region (admin logs). */
export async function uploadActivityLogCorrectionAudio(
  accessToken,
  logId,
  { startSec, endSec, fileName, audioBlob, audioFormat }
) {
  if (!logId) return null;

  try {
    const upload = await buildAudioUpload(audioBlob, fileName, audioFormat);
    const form = new FormData();
    form.append("start_sec", String(startSec));
    form.append("end_sec", String(endSec));
    form.append("file_name", String(fileName ?? "correction"));
    form.append("audio_format", upload.format);
    form.append("audio", upload.body, upload.name);

    const res = await fetchWithTimeout(
      activityLogUrl(`/${logId}/edit-correction-audio`),
      {
        method: "POST",
        headers: { ...authHeaders(accessToken) },
        body: form,
      },
      ACTIVITY_LOG_TIMEOUT_MS
    );
    if (!res.ok) throw new Error(await readApiError(res));
    return res.json();
  } catch (err) {
    throw wrapNetworkError(err);
  }
}
