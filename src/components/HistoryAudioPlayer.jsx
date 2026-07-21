import { useCallback, useEffect, useState } from "react";
import { Spinner } from "react-bootstrap";
import WaveformInlinePlayer from "./WaveformInlinePlayer.jsx";
import { sanitizeUserMessage } from "../utils/apiError.js";
import { getAuthToken } from "../utils/authSession.js";
import { LONG_REQUEST_MS } from "../utils/fetchWithTimeout.js";

/**
 * Inline audio player for ASR/TTS History "Listen Input" cells.
 * Loads audio with a fresh JWT and a long timeout for large uploads,
 * rendering real visual audio waveforms using WaveSurfer.
 */
export default function HistoryAudioPlayer({
  apiBaseUrl,
  itemId,
  audioFormat,
  mimeType,
  fetchAudioBlob,
}) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const loadAudio = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setErr("You must be signed in to play audio.");
      setLoading(false);
      setSrc(null);
      return;
    }

    setLoading(true);
    setErr("");
    setSrc(null);

    try {
      const blob = await fetchAudioBlob(apiBaseUrl, token, itemId, LONG_REQUEST_MS);
      if (!blob?.size) {
        throw new Error("Audio file is empty.");
      }
      setSrc(URL.createObjectURL(blob));
    } catch (e) {
      setErr(sanitizeUserMessage(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, itemId, fetchAudioBlob]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = getAuthToken();
      if (!token) {
        if (!cancelled) {
          setErr("You must be signed in to play audio.");
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setLoading(true);
        setErr("");
        setSrc(null);
      }

      try {
        const blob = await fetchAudioBlob(apiBaseUrl, token, itemId, LONG_REQUEST_MS);
        if (cancelled) return;
        if (!blob?.size) {
          throw new Error("Audio file is empty.");
        }
        setSrc(URL.createObjectURL(blob));
      } catch (e) {
        if (!cancelled) setErr(sanitizeUserMessage(e.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, itemId, fetchAudioBlob]);

  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  if (err) {
    return (
      <span className="history-audio-error">
        {err}{" "}
        <button type="button" className="history-view-more" onClick={loadAudio}>
          Retry
        </button>
      </span>
    );
  }

  if (loading || !src) {
    return (
      <span className="history-audio-loading">
        <Spinner animation="border" size="sm" />
        Loading audio…
      </span>
    );
  }

  return <WaveformInlinePlayer src={src} className="history-audio-player" />;
}
