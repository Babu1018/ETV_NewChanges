import { useCallback, useEffect, useState } from "react";
import { Alert, Container } from "react-bootstrap";
import TranscribeTab from "./components/TranscribeTab.jsx";
import HistoryTab from "./components/HistoryTab.jsx";
import EtvLogo from "./components/EtvLogo.jsx";
import StudioIcon from "./components/StudioIcon.jsx";
import StudioBreadcrumb from "./components/StudioBreadcrumb.jsx";
import StudioProfileMenu from "./components/StudioProfileMenu.jsx";
import { StudioToastProvider } from "./components/StudioToast.jsx";
import { defaultApiBaseUrl, defaultApiAuthKey } from "./utils/config.js";
import { sanitizeUserMessage } from "./utils/apiError.js";
import { getAuthToken, getStoredUser } from "./utils/authSession.js";
import {
  deleteHistoryEntries,
  deleteHistoryEntry,
  fetchHistoryAudio,
  fetchHistoryList,
} from "./utils/historyApi.js";

// Pure-JS diff — mirrors the same logic in HistoryTab
function computeDiff(original, edited) {
  original = original || "";
  edited = edited || "";
  if (original === edited || !original) return { hasEdits: false, segments: [] };
  const origWords = original.split(/(\s+)/);
  const editWords = edited.split(/(\s+)/);
  const m = origWords.length, n = editWords.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = origWords[i] === editWords[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const segs = [];
  let i = 0, j = 0, eq = "", add = "", rem = "";
  const flush = () => {
    if (rem) { segs.push({ type: "remove", text: rem }); rem = ""; }
    if (add) { segs.push({ type: "add",    text: add }); add = ""; }
    if (eq)  { segs.push({ type: "equal",  text: eq });  eq  = ""; }
  };
  while (i < m || j < n) {
    if (i < m && j < n && origWords[i] === editWords[j]) {
      if (rem || add) flush(); eq += origWords[i]; i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      if (eq) flush(); add += editWords[j]; j++;
    } else {
      if (eq) flush(); rem += origWords[i]; i++;
    }
  }
  flush();
  return { hasEdits: true, segments: segs };
}
export default function AsrStudioApp({ onSignOut, onBackToHub }) {
  const apiBaseUrl = defaultApiBaseUrl;
  const apiKey = defaultApiAuthKey;
  const user = getStoredUser();
  const [activeKey, setActiveKey] = useState("transcribe");
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyEditLoadingId, setHistoryEditLoadingId] = useState(null);
  const [transcribeLoadRequest, setTranscribeLoadRequest] = useState(null);
  // diffMap: Map<historyId, diffResult> — computed on frontend, never stored in DB
  const [diffMap, setDiffMap] = useState(() => new Map());

  const displayName = user
    ? `${user.firstname || ""} ${user.lastname || ""}`.trim()
    : "";

  const loadHistory = useCallback(async () => {
    const accessToken = getAuthToken();
    if (!accessToken) {
      setHistoryItems([]);
      return;
    }
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const items = await fetchHistoryList(apiBaseUrl, accessToken);
      setHistoryItems(items);
    } catch (e) {
      setHistoryError(sanitizeUserMessage(e.message || e));
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (activeKey === "history") loadHistory();
  }, [activeKey, loadHistory]);

  const deleteHistoryItem = async (id) => {
    const accessToken = getAuthToken();
    setHistoryError("");
    try {
      await deleteHistoryEntry(apiBaseUrl, accessToken, id);
      await loadHistory();
    } catch (e) {
      const msg = sanitizeUserMessage(e.message || e);
      if (msg.toLowerCase().includes("history entry not found")) {
        await loadHistory();
        setHistoryError("That entry is no longer saved. History refreshed.");
        return;
      }
      setHistoryError(msg);
    }
  };

  const deleteHistoryItems = async (ids) => {
    const accessToken = getAuthToken();
    setHistoryError("");
    try {
      await deleteHistoryEntries(apiBaseUrl, accessToken, ids);
      await loadHistory();
    } catch (e) {
      const msg = sanitizeUserMessage(e.message || e);
      if (msg.toLowerCase().includes("history entry not found")) {
        await loadHistory();
        setHistoryError("Some entries were already removed. History refreshed.");
        return;
      }
      setHistoryError(msg);
    }
  };

  const handleEditHistoryItem = async (item) => {
    const accessToken = getAuthToken();
    setHistoryEditLoadingId(item.id);
    setHistoryError("");
    try {
      const audioBlob = await fetchHistoryAudio(apiBaseUrl, accessToken, item.id);
      setTranscribeLoadRequest({
        token: Date.now(),
        transcriptText: sanitizeUserMessage(item.transcriptText || item.textPreview || ""),
        language: item.language || "English",
        validatorName: item.validatorName || "",
        audioFormat: item.audioFormat || "wav",
        mimeType: item.mimeType,
        fileName: item.fileName || "",
        audioBlob,
      });
      setActiveKey("transcribe");
    } catch (e) {
      setHistoryError(sanitizeUserMessage(e.message || e));
    } finally {
      setHistoryEditLoadingId(null);
    }
  };

  const welcomeTitle =
    activeKey === "history"
      ? "Your history"
      : displayName
        ? `Welcome, ${displayName}!`
        : "Welcome Validator!";

  return (
    <StudioToastProvider>
      <div className="app-studio studio-fixed-layout">
        <div className="app-studio-bg" aria-hidden />
        <div className="app-studio-inner">
          <header className="studio-nav glass-nav">
            <Container fluid="lg" className="studio-nav-inner">
              <button
                type="button"
                className="studio-logo"
                onClick={() => setActiveKey("transcribe")}
                aria-label="Go to Transcribe"
              >
                <EtvLogo className="etv-logo-img--studio-nav" alt="ASR Studio" />
              </button>
              <div className="studio-nav-right">
                <nav className="studio-nav-links" aria-label="Primary">
                  <button
                    type="button"
                    className={`studio-nav-item${activeKey === "transcribe" ? " is-active" : ""}`}
                    onClick={() => setActiveKey("transcribe")}
                  >
                    <StudioIcon name="nav-transcribe" className="studio-nav-icon" size={18} alt="" />
                    Transcribe
                  </button>
                  <button
                    type="button"
                    className={`studio-nav-item${activeKey === "history" ? " is-active" : ""}`}
                    onClick={() => setActiveKey("history")}
                  >
                    <StudioIcon name="nav-history" className="studio-nav-icon" size={18} alt="" />
                    History
                  </button>
                </nav>
                <StudioProfileMenu user={user} displayName={displayName} onSignOut={onSignOut} />
              </div>
            </Container>
          </header>

          <main className="studio-main">
            <Container fluid="lg">
              <StudioBreadcrumb studioLabel="ASR" onHome={onBackToHub} />

              {!apiKey && (
                <Alert variant="warning" className="studio-alert mb-4">
                  Set <code>VITE_API_AUTH_KEY</code> in <code>.env.local</code> (must match backend{" "}
                  <code>API_AUTH_KEY</code> for Hindi/Telugu transcription).
                </Alert>
              )}

              <div
                className="studio-tab-panel"
                hidden={activeKey !== "transcribe"}
                aria-hidden={activeKey !== "transcribe"}
              >
                <TranscribeTab
                  tabActive={activeKey === "transcribe"}
                  apiBaseUrl={apiBaseUrl}
                  apiKey={apiKey}
                  accessToken={getAuthToken()}
                  loadRequest={transcribeLoadRequest}
                  onLoadRequestConsumed={() => setTranscribeLoadRequest(null)}
                  onHistorySaved={({ id, originalTranscript, finalTranscript } = {}) => {
                    if (id && originalTranscript) {
                      const diff = computeDiff(originalTranscript, finalTranscript);
                      if (diff.hasEdits) {
                        setDiffMap((prev) => {
                          const next = new Map(prev);
                          next.set(id, diff);
                          return next;
                        });
                      }
                    }
                    loadHistory();
                  }}
                />
              </div>
              <div
                className="history-section"
                hidden={activeKey !== "history"}
                aria-hidden={activeKey !== "history"}
              >
                <HistoryTab
                  apiBaseUrl={apiBaseUrl}
                  accessToken={getAuthToken()}
                  historyItems={historyItems}
                  loading={historyLoading}
                  error={historyError}
                  editLoadingId={historyEditLoadingId}
                  diffMap={diffMap}
                  onEditItem={handleEditHistoryItem}
                  onDeleteItem={deleteHistoryItem}
                  onDeleteItems={deleteHistoryItems}
                />
              </div>
            </Container>
          </main>
        </div>
      </div>
    </StudioToastProvider>
  );
}
