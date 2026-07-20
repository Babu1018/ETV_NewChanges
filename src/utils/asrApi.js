import { readApiError, sanitizeUserMessage, wrapNetworkError } from "./apiError.js";
import { fetchWithTimeout, LONG_REQUEST_MS } from "./fetchWithTimeout.js";

const LANGUAGE_PATH = {
  English: "/english/transcribe",
  Hindi: "/hindi/transcribe",
  Telugu: "/telugu/transcribe",
};

function authHeaders(apiKey, accessToken, sarvamApiKey) {
  const h = {};
  if (apiKey) h["x-api-key"] = apiKey;
  if (accessToken) h["Authorization"] = `Bearer ${accessToken}`;
  const trimmedSarvam = (sarvamApiKey || "").trim();
  if (trimmedSarvam) h["x-sarvam-api-key"] = trimmedSarvam;
  return h;
}

/**
 * Legacy per-language transcription (kept for backward compat).
 * @param {string} language English | Hindi | Telugu
 * @param {File} audioFile
 * @param {string} apiKey
 * @param {string} [accessToken]
 */
export async function transcribeAudio(language, audioFile, apiKey, accessToken) {
  const path = LANGUAGE_PATH[language];
  if (!path) {
    throw new Error(`Unsupported language: ${language}`);
  }

  const form = new FormData();
  form.append("file", audioFile, audioFile.name);

  try {
    const res = await fetchWithTimeout(
      path,
      {
        method: "POST",
        headers: { ...authHeaders(apiKey, accessToken) },
        body: form,
      },
      LONG_REQUEST_MS
    );
    if (!res.ok) {
      throw new Error(await readApiError(res));
    }
    const data = await res.json();
    const text = data.transcription ?? data.text ?? "";
    if (!String(text).trim()) {
      throw new Error("Transcription returned empty text.");
    }
    return {
      text: sanitizeUserMessage(String(text)),
      activityLogId: data.activity_log_id ? String(data.activity_log_id) : null,
    };
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

/**
 * Unified transcription with IndicConformer mismatch highlights.
 * Routes English → Whisper, Hindi/Telugu → Sarvam saaras:v3 internally.
 *
 * @param {string} language "English" | "Hindi" | "Telugu"
 * @param {File} audioFile
 * @param {string} apiKey
 * @param {string} [validatorName]
 * @param {string} [apiBaseUrl] e.g. "/asr"
 * @param {string} [accessToken]
 */
export async function transcribeUnified(
  language,
  audioFile,
  apiKey,
  validatorName = "",
  apiBaseUrl = "/asr",
  accessToken = "",
  sarvamApiKey = ""
) {
  const form = new FormData();
  form.append("file", audioFile, audioFile.name);
  form.append("language", language);
  if (validatorName) form.append("validator_name", validatorName);
  const trimmedSarvam = (sarvamApiKey || "").trim();
  if (trimmedSarvam) form.append("sarvam_api_key", trimmedSarvam);

  try {
    const res = await fetchWithTimeout(
      `${apiBaseUrl}/transcribe`,
      {
        method: "POST",
        headers: { ...authHeaders(apiKey, accessToken, sarvamApiKey) },
        body: form,
      },
      LONG_REQUEST_MS
    );
    if (!res.ok) {
      throw new Error(await readApiError(res));
    }
    const data = await res.json();
    return {
      transcript: sanitizeUserMessage(String(data.transcript ?? "")),
      words: Array.isArray(data.words) ? data.words : [],
      mismatch_count: Number(data.mismatch_count ?? 0),
      total_words: Number(data.total_words ?? 0),
      accuracy: Number(data.accuracy ?? 1),
      language: data.language ?? language,
      processing_time_mins: Number(data.processing_time_mins ?? 0),
      ground_truth_available: Boolean(data.ground_truth_available),
      ground_truth_status: String(data.ground_truth_status ?? ""),
      groundTruth: String(data.ground_truth ?? ""),
      hasWordTimestamps: Boolean(data.has_word_timestamps),
      activityLogId: data.activity_log_id ? String(data.activity_log_id) : null,
    };
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

export async function logWordEdit(payload, apiKey, apiBaseUrl = "/asr") {
  try {
    const res = await fetch(`${apiBaseUrl}/word-edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(apiKey),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn("[logWordEdit] non-ok response:", res.status);
    }
  } catch (err) {
    console.warn("[logWordEdit] failed (non-critical):", err);
  }
}

export async function logWordDelete(payload, apiKey, apiBaseUrl = "/asr") {
  try {
    const res = await fetch(`${apiBaseUrl}/word-delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(apiKey),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn("[logWordDelete] non-ok response:", res.status);
    }
  } catch (err) {
    console.warn("[logWordDelete] failed (non-critical):", err);
  }
}

export async function logWordRevoke(payload, apiKey, apiBaseUrl = "/asr") {
  try {
    const res = await fetch(`${apiBaseUrl}/word-revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(apiKey),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn("[logWordRevoke] non-ok response:", res.status);
    }
  } catch (err) {
    console.warn("[logWordRevoke] failed (non-critical):", err);
  }
}

export async function saveTranscriptLog(payload, apiKey, apiBaseUrl = "/asr") {
  try {
    const res = await fetch(`${apiBaseUrl}/save-transcript`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(apiKey),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn("[saveTranscriptLog] non-ok response:", res.status);
    }
  } catch (err) {
    console.warn("[saveTranscriptLog] failed (non-critical):", err);
  }
}
