/**
 * Auth API base for Vite proxy. Paths in auth UI are `/api/auth/...` (joined safely in authApi.js).
 * Use "" or "/api" in dev. Or VITE_AUTH_API_BASE_URL=http://127.0.0.1:8000 for direct API calls.
 */
export const defaultAuthApiBaseUrl =
  import.meta.env.VITE_AUTH_API_BASE_URL ?? "/api";
