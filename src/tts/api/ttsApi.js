/** Join API base (e.g. ``/tts``) with a path segment. */
export function apiUrl(base, segment) {
  const b = String(base || "").replace(/\/$/, "");
  const s = String(segment || "").replace(/^\//, "");
  return `${b}/${s}`;
}
