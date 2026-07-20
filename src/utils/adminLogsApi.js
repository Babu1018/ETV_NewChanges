import { joinAuthUrl } from "../components/auth/authApi.js";
import { readApiError } from "./apiError.js";
import { defaultAuthApiBaseUrl } from "./authConfig.js";
import { getAuthToken } from "./authSession.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

const LOG_FILENAMES = {
  asr: "asr_validator.log",
  tts: "tts_validator.log",
};

export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(header, fallback) {
  if (!header) return fallback;
  const match = header.match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || fallback;
}

export function downloadTextFile(filename, content) {
  const safeName = (filename || "log").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").slice(0, 120) || "log";
  const withExt = safeName.toLowerCase().endsWith(".txt") ? safeName : `${safeName}.txt`;
  const blob = new Blob([String(content ?? "")], { type: "text/plain;charset=utf-8" });
  triggerBlobDownload(blob, withExt);
}

export async function downloadValidatorLog(logKind) {
  const kind = String(logKind || "").toLowerCase();
  if (!LOG_FILENAMES[kind]) {
    throw new Error("Invalid log type");
  }

  const res = await fetchWithTimeout(
    joinAuthUrl(defaultAuthApiBaseUrl, `/api/admin/validator-logs/${kind}`),
    {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    },
    60_000
  );

  if (!res.ok) {
    throw new Error(await readApiError(res));
  }

  const blob = await res.blob();
  triggerBlobDownload(blob, LOG_FILENAMES[kind]);
}

export async function downloadActivityLogEntry(entry, kind = "bundle") {
  const type = entry?.type;
  const id = entry?.id;
  if (!type || !id) {
    throw new Error("Invalid log entry");
  }

  const res = await fetchWithTimeout(
    joinAuthUrl(
      defaultAuthApiBaseUrl,
      `/api/admin/logs/${type}/${id}/download?kind=${encodeURIComponent(kind)}`
    ),
    {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    },
    120_000
  );

  if (!res.ok) {
    throw new Error(await readApiError(res));
  }

  const blob = await res.blob();
  const fallback =
    kind === "audio"
      ? entry.downloadName || "audio.wav"
      : kind === "excel"
        ? `${entry.fileName || "log"}_summary.xlsx`
      : kind === "text"
        ? `${entry.fileName || "log"}.txt`
        : `${entry.fileName || "log"}.zip`;
  triggerBlobDownload(blob, filenameFromDisposition(res.headers.get("Content-Disposition"), fallback));
}

export async function downloadActivityLogsBulk(ids, kind = "bundle") {
  if (!ids?.length) {
    throw new Error("No entries selected");
  }

  const res = await fetchWithTimeout(
    joinAuthUrl(defaultAuthApiBaseUrl, "/api/admin/logs/download-bulk"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids, kind }),
    },
    180_000
  );

  if (!res.ok) {
    throw new Error(await readApiError(res));
  }

  const blob = await res.blob();
  const stamp = new Date().toISOString().slice(0, 10);
  const fallback =
    kind === "audio"
      ? ids.length === 1
        ? "audio.wav"
        : `users_logs_audio_${stamp}.zip`
      : kind === "excel"
        ? ids.length === 1
          ? "users_log_summary.xlsx"
          : `users_logs_${stamp}.xlsx`
      : ids.length === 1
        ? "users_log.zip"
        : `users_logs_${stamp}.zip`;
  triggerBlobDownload(blob, filenameFromDisposition(res.headers.get("Content-Disposition"), fallback));
}
