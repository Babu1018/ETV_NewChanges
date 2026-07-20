/**
 * Microphone access for recording. Browsers only expose getUserMedia in a
 * secure context (HTTPS or localhost). Over plain HTTP in production,
 * navigator.mediaDevices is undefined.
 */

export function isSecureRecordingContext() {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const host = window.location?.hostname || "";
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export function isMicrophoneAvailable() {
  if (typeof navigator === "undefined") return false;
  if (navigator.mediaDevices?.getUserMedia) return true;
  const legacy =
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia;
  return Boolean(legacy);
}

export function microphoneUnavailableMessage() {
  if (!isSecureRecordingContext()) {
    return (
      "Microphone recording needs HTTPS (or localhost for development). " +
      "This site is using HTTP, so the browser blocks the microphone. " +
      "Open the app with https://… or enable SSL on your server."
    );
  }
  if (!isMicrophoneAvailable()) {
    return "Microphone recording is not supported in this browser.";
  }
  return "Microphone is not available.";
}

/**
 * @param {MediaStreamConstraints} [constraints]
 * @returns {Promise<MediaStream>}
 */
export async function requestMicrophoneStream(constraints = { audio: true }) {
  if (!isSecureRecordingContext()) {
    throw new Error(microphoneUnavailableMessage());
  }

  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  const legacy =
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia;

  if (!legacy) {
    throw new Error(microphoneUnavailableMessage());
  }

  return new Promise((resolve, reject) => {
    legacy.call(navigator, constraints, resolve, reject);
  });
}

export function mapMicrophoneError(err) {
  if (!err) return microphoneUnavailableMessage();
  if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
    return "Microphone permission denied. Allow microphone access in the browser, then try again.";
  }
  if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
    return "No microphone found. Connect a microphone and try again.";
  }
  if (err.name === "NotReadableError" || err.name === "TrackStartError") {
    return "Microphone is in use by another application.";
  }
  const msg = String(err.message || err);
  if (msg.includes("getUserMedia") && !isSecureRecordingContext()) {
    return microphoneUnavailableMessage();
  }
  return msg;
}
