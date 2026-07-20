const STUDIO_SCREENS = new Set(["hub", "asr", "tts", "logs", "users"]);

export function isStudioScreen(screen) {
  return STUDIO_SCREENS.has(screen);
}

export function readScreenFromHash() {
  const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  return STUDIO_SCREENS.has(hash) ? hash : "hub";
}

export function writeScreenToHash(screen) {
  if (!STUDIO_SCREENS.has(screen)) return;
  const next = `#/${screen}`;
  if (window.location.hash !== next) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
  }
}

export function clearScreenHash() {
  if (window.location.hash) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
}
