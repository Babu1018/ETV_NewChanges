import { useCallback, useRef, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Form,
  Row,
  Spinner,
} from "react-bootstrap";
import AudioPlayer from "../../components/AudioPlayer.jsx";
import {
  mapMicrophoneError,
  requestMicrophoneStream,
} from "../utils/mediaCapture.js";

async function blobFromRecorderChunks(chunks, mimeType) {
  const type = mimeType.includes("webm") ? "audio/webm" : mimeType;
  const blob = new Blob(chunks, { type });
  return blob;
}

export default function ValidatorTab({ apiBaseUrl, apiKey }) {
  const [originalBlob, setOriginalBlob] = useState(null);
  const [correctionBlob, setCorrectionBlob] = useState(null);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(30);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [resultBlob, setResultBlob] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startRecording = async () => {
    setError("");
    chunksRef.current = [];
    try {
      const stream = await requestMicrophoneStream({ audio: true });
      streamRef.current = stream;
      const preferred =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
      const rec = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start(250);
      setRecording(true);
    } catch (e) {
      setError(mapMicrophoneError(e));
    }
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") {
      setRecording(false);
      stopStream();
      return;
    }
    rec.onstop = async () => {
      setRecording(false);
      stopStream();
      const blob = await blobFromRecorderChunks(
        chunksRef.current,
        rec.mimeType || "audio/webm"
      );
      setCorrectionBlob(blob);
      mediaRecorderRef.current = null;
    };
    rec.stop();
  };

  const onOriginalFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) {
      setOriginalBlob(null);
      return;
    }
    setOriginalBlob(f);
  };

  const deleteRecording = () => {
    setCorrectionBlob(null);
    chunksRef.current = [];
  };

  const handleCorrect = async () => {
    setError("");
    setSuccessMsg("");
    setResultBlob(null);

    if (!originalBlob) {
      setError("Please upload the original audio first.");
      return;
    }
    if (!correctionBlob) {
      setError("Please record a correction first.");
      return;
    }
    if (startSec >= endSec) {
      setError("Mistake Start must be less than Mistake End.");
      return;
    }

    const base = apiBaseUrl.replace(/\/$/, "");
    const form = new FormData();
    const origName =
      originalBlob instanceof File && originalBlob.name
        ? originalBlob.name
        : "original.wav";
    const corrExt =
      correctionBlob.type?.includes("webm") ? "webm" : "wav";
    form.append("original_audio", originalBlob, origName);
    form.append("correction_audio", correctionBlob, `correction.${corrExt}`);
    form.append("mistake_start_sec", String(startSec));
    form.append("mistake_end_sec", String(endSec));
    form.append("language", "English");

    setLoading(true);
    try {
      const r = await fetch(`${base}/correct-tts`, {
        method: "POST",
        headers: { "x-api-key": apiKey },
        body: form,
      });
      if (!r.ok) {
        const t = await r.text();
        setError(t || `HTTP ${r.status}`);
        return;
      }
      const blob = await r.blob();
      setResultBlob(blob);
      setSuccessMsg(
        `Corrected audio ready (replaced ${startSec.toFixed(3)}s – ${endSec.toFixed(3)}s). Timestamps reset suggestion: set start/end again for another pass.`
      );
      setStartSec(0);
      setEndSec(0);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  const downloadFinal = () => {
    if (!resultBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(resultBlob);
    a.download = "corrected_tts.wav";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="app-section">
      <h2 className="app-section-title">Validator &amp; voice correction</h2>
      <p className="app-section-sub">
        Upload the baseline take, record the corrected line, and mark the mistake window in seconds on
        the original timeline. First run may download large models—plan a short break for demos.
      </p>

      <Row className="g-3 mb-4">
        <Col lg={6}>
          <div className="app-panel h-100">
            <div className="app-panel-label">Original audio</div>
            <Form.Label className="small text-muted mb-1">Source file</Form.Label>
            <Form.Control
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              onChange={onOriginalFile}
            />
            {originalBlob ? (
              <AudioPlayer blob={originalBlob} mimeType={originalBlob.type || "audio/wav"} />
            ) : (
              <p className="text-muted small mt-3 mb-0">Drop a WAV or MP3 to begin.</p>
            )}
          </div>
        </Col>
        <Col lg={6}>
          <div className="app-panel h-100">
            <div className="app-panel-label">Correction recording</div>
            <div className="d-flex gap-2 flex-wrap mb-2">
              {!recording ? (
                <Button variant="danger" onClick={startRecording}>
                  Record
                </Button>
              ) : (
                <Button variant="secondary" onClick={stopRecording}>
                  Stop
                </Button>
              )}
            </div>
            {correctionBlob ? (
              <>
                <AudioPlayer blob={correctionBlob} mimeType={correctionBlob.type || "audio/wav"} />
                <div className="d-flex gap-2 mt-3 flex-wrap">
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(correctionBlob);
                      a.download = "correction_recording.webm";
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    Download take
                  </Button>
                  <Button variant="outline-danger" size="sm" onClick={deleteRecording}>
                    Discard
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-muted small mb-0">Record the replacement wording here.</p>
            )}
          </div>
        </Col>
      </Row>

      <div className="app-panel mb-4">
        <div className="app-panel-label">Mistake segment</div>
        <p className="text-muted small mb-3">
          Enter start and end times in <strong>seconds</strong> on the <strong>original</strong> file
          (e.g. <code>1.2</code> → <code>3.5</code>). Listen to the waveform and note where the error
          begins and ends.
        </p>
        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Start (s)</Form.Label>
              <Form.Control
                type="number"
                step="0.001"
                min={0}
                value={startSec}
                onChange={(e) => setStartSec(parseFloat(e.target.value) || 0)}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>End (s)</Form.Label>
              <Form.Control
                type="number"
                step="0.001"
                min={0}
                value={endSec}
                onChange={(e) => setEndSec(parseFloat(e.target.value) || 0)}
              />
            </Form.Group>
          </Col>
        </Row>
        {originalBlob && startSec < endSec && (
          <p className="small mt-3 mb-0">
            Replacing <strong>{startSec.toFixed(3)}s – {endSec.toFixed(3)}s</strong> (
            {(endSec - startSec).toFixed(3)}s)
          </p>
        )}
      </div>

      <hr className="app-hr" />

      {error && (
        <Alert variant="danger" className="mb-3">
          {error}
        </Alert>
      )}
      {successMsg && (
        <Alert variant="success" className="mb-3">
          {successMsg}
        </Alert>
      )}

      <p className="text-muted small mb-3">
        First <strong>Correct &amp; Clone</strong> can take several minutes while the server caches
        Hugging Face weights. Add <code>HF_TOKEN</code> in <code>back_end/.env</code> for faster
        downloads; do not refresh the page mid-job.
      </p>

      <Button variant="primary" size="lg" className="mb-4" disabled={loading} onClick={handleCorrect}>
        {loading ? (
          <>
            <Spinner animation="border" size="sm" className="me-2" />
            Processing…
          </>
        ) : (
          "Correct & clone"
        )}
      </Button>

      {resultBlob && (
        <div className="app-panel">
          <div className="app-panel-label">Corrected output</div>
          <AudioPlayer blob={resultBlob} mimeType="audio/wav" />
          <Button variant="outline-secondary" className="mt-3" onClick={downloadFinal}>
            Download final WAV
          </Button>
        </div>
      )}
    </div>
  );
}
