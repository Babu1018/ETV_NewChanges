/**
 * API base for TTS routes. In dev, Vite proxies ``/tts`` → http://127.0.0.1:8000
 * (see vite.config.js). Override with VITE_API_BASE_URL if needed.
 */
export const defaultApiBaseUrl =
  import.meta.env.VITE_TTS_API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "/tts";

export const defaultApiAuthKey =
  import.meta.env.VITE_API_AUTH_KEY || import.meta.env.VITE_API_KEY || "";
