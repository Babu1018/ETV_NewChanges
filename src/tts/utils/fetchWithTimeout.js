const DEFAULT_MS = 120_000;

/** Long jobs (ASR/TTS transcribe) — match Vite proxy (30 min). */
export const LONG_REQUEST_MS = 1_800_000;

/**
 * fetch() that rejects if the server does not respond in time.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(
        "Request timed out. The API on port 8000 may still be starting (first start can take up to a minute). " +
          "From back_end run: uvicorn main:app --reload --host 127.0.0.1 --port 8000 " +
          "and wait until you see “Application startup complete”, then retry."
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
