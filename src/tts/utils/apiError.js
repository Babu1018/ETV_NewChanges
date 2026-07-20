/** Matches bulbul, bulbul_v3, bulbul:v3, etc. — never show these in the UI. */
const BULBUL_PATTERN = /bulbul(?:\s*[_:.]?\s*v?\d+(?:\.\d+)?)?/gi;

/** Remove vendor model names from any user-visible string (errors, toasts, transcripts). */
export function sanitizeUserMessage(message) {
  if (message == null || message === "") return message;
  return String(message)
    .replace(BULBUL_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^_+|_+$/g, "")
    .replace(/__+/g, "_")
    .trim();
}

/** File / input labels shown in forms (save name, uploaded file name, etc.). */
export function sanitizeDisplayValue(value) {
  return sanitizeUserMessage(value);
}

export async function readApiError(res) {
  const text = (await res.text()).trim();

  if (
    res.status === 500 &&
    (!text || text === "Internal Server Error" || text.startsWith("Proxy error"))
  ) {
    return (
      "API server is not reachable. Start the backend: uvicorn main:app --reload"
    );
  }

  if (text) {
    try {
      const data = JSON.parse(text);
      if (typeof data.detail === "string") return sanitizeUserMessage(data.detail);
      if (Array.isArray(data.detail)) {
        return data.detail
          .map((d) => {
            const loc = Array.isArray(d.loc) ? d.loc.filter((p) => p !== "body").join(".") : "";
            const msg = d.msg || JSON.stringify(d);
            return sanitizeUserMessage(loc ? `${loc}: ${msg}` : msg);
          })
          .join("; ");
      }
      if (data.transcription) return sanitizeUserMessage(String(data.transcription));
    } catch {
      /* plain text */
    }
    return sanitizeUserMessage(text);
  }

  return `Request failed (${res.status})`;
}

export function wrapNetworkError(err) {
  if (err instanceof TypeError) {
    return new Error(
      "Cannot reach the API server. From back_end: uvicorn main:app --reload (port 8000)."
    );
  }
  const msg = sanitizeUserMessage(err instanceof Error ? err.message : String(err));
  return new Error(msg || "Something went wrong. Please try again.");
}
