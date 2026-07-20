export const defaultApiBaseUrl =
  import.meta.env.VITE_ASR_API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "/asr";

export const defaultApiAuthKey =
  import.meta.env.VITE_API_AUTH_KEY || import.meta.env.VITE_API_KEY || "";
