export function sarvamKeyHeaders(sarvamApiKey) {
  const trimmed = (sarvamApiKey || "").trim();
  if (!trimmed) return {};
  return { "x-sarvam-api-key": trimmed };
}

export function needsSarvamKeyForAsr(language) {
  return language === "English" || language === "Hindi" || language === "Telugu";
}

/** Remove any legacy persisted Sarvam key from sessionStorage. */
export function clearStoredSarvamApiKey() {
  try {
    sessionStorage.removeItem("etv_sarvam_api_key");
  } catch {
    /* sessionStorage unavailable */
  }
}
