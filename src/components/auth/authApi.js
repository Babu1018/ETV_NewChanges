import { readApiError } from "../../utils/apiError.js";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";

/** Login/register can wait on DB; avoid aborting before the server responds. */
const AUTH_FETCH_MS = 60_000;

/**
 * Join base + path without duplicating `/api` (e.g. base `/api` + `/api/auth/register`).
 */
export function joinAuthUrl(base, path) {
  const b = (base || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (b.endsWith("/api") && (p === "/api" || p.startsWith("/api/"))) {
    return `${b}${p === "/api" ? "" : p.slice(4)}`;
  }
  return `${b}${p}`;
}

export async function apiPost(baseUrl, path, body) {
  const url = joinAuthUrl(baseUrl, path);
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    AUTH_FETCH_MS
  );
  if (!res.ok) {
    throw new Error(await readApiError(res));
  }
  return res.json().catch(() => ({}));
}
