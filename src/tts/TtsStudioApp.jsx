import { useCallback, useEffect, useState } from "react";
import { Alert, Container } from "react-bootstrap";
import GenerateTab from "./components/GenerateTab.jsx";
import HistoryTab from "./components/HistoryTab.jsx";
import EtvLogo from "../components/EtvLogo.jsx";
import StudioIcon from "../components/StudioIcon.jsx";
import StudioBreadcrumb from "../components/StudioBreadcrumb.jsx";
import StudioProfileMenu from "../components/StudioProfileMenu.jsx";
import { StudioToastProvider } from "../components/StudioToast.jsx";
import { defaultApiBaseUrl, defaultApiAuthKey } from "./utils/config.js";
import {
  deleteHistoryEntry,
  fetchHistoryAudio,
  fetchHistoryList,
} from "./utils/historyApi.js";
import { scriptTextForEditor } from "./utils/historyScript.js";
import { clearAuthSession, getAuthToken, getStoredUser } from "../utils/authSession.js";

const STUDIO_TAB_STORAGE_KEY = "tts_studio_active_tab";

function readStoredStudioTab() {
  try {
    const tab = sessionStorage.getItem(STUDIO_TAB_STORAGE_KEY);
    if (tab === "history" || tab === "generate") return tab;
  } catch {
    /* sessionStorage unavailable */
  }
  return "generate";
}

function writeStoredStudioTab(tab) {
  try {
    sessionStorage.setItem(STUDIO_TAB_STORAGE_KEY, tab);
  } catch {
    /* ignore */
  }
}

export default function TtsStudioApp({ onSignOut, onBackToHub }) {
  const apiBaseUrl = defaultApiBaseUrl;
  const apiKey = defaultApiAuthKey;
  const accessToken = getAuthToken();
  const [activeKey, setActiveKey] = useState(readStoredStudioTab);

  const setStudioTab = useCallback((tab) => {
    writeStoredStudioTab(tab);
    setActiveKey(tab);
  }, []);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyEditLoadingId, setHistoryEditLoadingId] = useState(null);
  const [generateLoadRequest, setGenerateLoadRequest] = useState(null);
  const [generateTabKey, setGenerateTabKey] = useState(0);
  const user = getStoredUser();

  const loadHistory = useCallback(async () => {
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
      const msg = String(e.message || e);
      setHistoryError(msg);
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [apiBaseUrl, accessToken]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (activeKey === "history") loadHistory();
  }, [activeKey, loadHistory]);

  const deleteHistoryItem = async (id) => {
    if (!accessToken) return;
    setHistoryError("");
    try {
      await deleteHistoryEntry(apiBaseUrl, accessToken, id);
      await loadHistory();
    } catch (e) {
      setHistoryError(String(e.message || e));
      throw e;
    }
  };

  const deleteHistoryItems = async (ids) => {
    if (!accessToken || ids.length === 0) return;
    setHistoryError("");
    try {
      await Promise.all(
        ids.map((id) => deleteHistoryEntry(apiBaseUrl, accessToken, id))
      );
      await loadHistory();
    } catch (e) {
      setHistoryError(String(e.message || e));
      throw e;
    }
  };

  const handleEditHistoryItem = async (item) => {
    if (!accessToken) {
      setHistoryError("You must be signed in to open saved clips.");
      return;
    }
    setHistoryEditLoadingId(item.id);
    setHistoryError("");
    try {
      const audioBlob = await fetchHistoryAudio(apiBaseUrl, accessToken, item.id);
      setGenerateLoadRequest({
        token: Date.now(),
        scriptText: scriptTextForEditor(item.scriptText || item.textPreview || ""),
        language: item.language || "English",
        gender: item.gender || "Female",
        speaker: item.speaker || "D",
        audioFormat: item.audioFormat || "wav",
        mimeType: item.mimeType,
        fileName: item.fileName || "",
        audioBlob,
      });
      setStudioTab("generate");
    } catch (e) {
      setHistoryError(String(e.message || e));
    } finally {
      setHistoryEditLoadingId(null);
    }
  };

  const handleSignOut = () => {
    try {
      sessionStorage.removeItem(STUDIO_TAB_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    clearAuthSession();
    onSignOut?.();
  };

  const handleLogoHome = () => {
    setStudioTab("generate");
    setGenerateLoadRequest(null);
    setHistoryError("");
    setHistoryEditLoadingId(null);
    setGenerateTabKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const displayName =
    user?.firstname || user?.first_name
      ? `${user.firstname || user.first_name} ${user.lastname || user.last_name || ""}`.trim()
      : user?.email || null;

  return (
    <StudioToastProvider>
      <div className="app-studio studio-fixed-layout">
        <div className="app-studio-bg" aria-hidden />
        <div className="app-studio-inner">
          <header className="studio-nav glass-nav">
            <Container fluid="lg" className="studio-nav-inner">
              <button
                type="button"
                className="studio-logo-btn"
                onClick={handleLogoHome}
                aria-label="TTS — go to Generate home"
              >
                <EtvLogo className="etv-logo-img--studio-nav" alt="TTS Studio" />
              </button>
              <div className="studio-nav-right">
                <nav className="studio-nav-links" aria-label="Primary">
                  <button
                    type="button"
                    className={`studio-nav-item${activeKey === "generate" ? " is-active" : ""}`}
                    onClick={() => setStudioTab("generate")}
                  >
                    <StudioIcon name="nav-generate" className="studio-nav-icon" size={18} alt="" />
                    Generate
                  </button>
                  <button
                    type="button"
                    className={`studio-nav-item${activeKey === "history" ? " is-active" : ""}`}
                    onClick={() => setStudioTab("history")}
                  >
                    <StudioIcon name="nav-history" className="studio-nav-icon" size={18} alt="" />
                    History
                  </button>
                </nav>
                <StudioProfileMenu
                  user={user}
                  displayName={displayName}
                  onSignOut={handleSignOut}
                />
              </div>
            </Container>
          </header>

          <main className="studio-main">
            <Container fluid="lg">
              <StudioBreadcrumb studioLabel="TTS" onHome={onBackToHub} />

              {!apiKey && (
                <Alert variant="danger" className="studio-alert studio-alert-danger mb-4">
                  Missing API key in environment. Set <code>VITE_API_KEY</code> or{" "}
                  <code>VITE_API_AUTH_KEY</code> in <code>/.env.local</code> (required for TTS
                  generate).
                </Alert>
              )}

              <div
                className="studio-tab-panel"
                hidden={activeKey !== "generate"}
                aria-hidden={activeKey !== "generate"}
              >
                <GenerateTab
                  key={generateTabKey}
                  tabActive={activeKey === "generate"}
                  apiBaseUrl={apiBaseUrl}
                  apiKey={apiKey}
                  accessToken={accessToken}
                  loadRequest={generateLoadRequest}
                  onLoadRequestConsumed={() => setGenerateLoadRequest(null)}
                  onHistorySaved={loadHistory}
                />
              </div>
              <div
                className="history-section"
                hidden={activeKey !== "history"}
                aria-hidden={activeKey !== "history"}
              >
                <HistoryTab
                  apiBaseUrl={apiBaseUrl}
                  apiKey={apiKey}
                  accessToken={accessToken}
                  historyItems={historyItems}
                  loading={historyLoading}
                  error={historyError}
                  editLoadingId={historyEditLoadingId}
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
