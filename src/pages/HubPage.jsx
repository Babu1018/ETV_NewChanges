import { Container } from "react-bootstrap";
import AdminNavActions from "../components/AdminNavActions.jsx";
import EtvLogo from "../components/EtvLogo.jsx";
import HubFeatureSlider from "../components/HubFeatureSlider.jsx";
import StudioProfileMenu from "../components/StudioProfileMenu.jsx";
import { getStoredUser, isAdminUser } from "../utils/authSession.js";
import backgroundUrl from "../assets/background.jpeg";
import etvLogo from "../assets/etv-logo.png";

export default function HubPage({ onOpenAsr, onOpenTts, onOpenLogs, onOpenUsers, onSignOut }) {
  const user = getStoredUser();
  const admin = isAdminUser(user);
  const displayName = user
    ? `${user.firstname || ""} ${user.lastname || ""}`.trim()
    : user?.email || "";

  return (
    <div className="app-studio hub-page">
      <div
        className="app-studio-bg"
        style={{ backgroundImage: `url(${backgroundUrl})` }}
        aria-hidden
      />
      <div className="app-studio-inner">
        <header className="studio-nav glass-nav glass-nav-dark">
          <Container fluid="lg" className="studio-nav-inner">
            <div className="studio-logo hub-studio-logo" aria-label="ETV Validator Studio">
              <img src={etvLogo} alt="ETV" className="hub-header-logo" draggable={false} />
            </div>
            <div className="studio-nav-right">
              {admin ? (
                <AdminNavActions
                  onOpenLogs={onOpenLogs}
                  onOpenUsers={onOpenUsers}
                />
              ) : null}
              <StudioProfileMenu
                user={user}
                displayName={displayName}
                onSignOut={onSignOut}
                isAdmin={admin}
                onOpenLogs={admin ? onOpenLogs : undefined}
                onOpenUsers={admin ? onOpenUsers : undefined}
              />
            </div>
          </Container>
        </header>

        <main className="studio-main hub-main">
          <Container fluid="lg" className="hub-layout">
            <section className="hub-left">
              <div className="hub-badge">
                <span className="hub-badge-icon" aria-hidden>
                  ✦
                </span>
                NEXT-GEN Platform
              </div>
              <h1 className="hub-title">Welcome</h1>
              <p className="hub-lead">
                Build multilingual voice and text experiences in seconds. <br/>Tap{" "}
                <strong>ASR</strong> for real-time speech-to-text or <strong>TTS</strong> for text to speech.
              </p>
              <div className="hub-launch-actions">
                <button type="button" className="hub-launch-btn hub-launch-btn--asr" onClick={onOpenAsr}>
                  <EtvLogo variant="white" alt="" className="hub-launch-btn-logo" />
                  Launch ASR
                </button>
                <button type="button" className="hub-launch-btn hub-launch-btn--tts" onClick={onOpenTts}>
                  <EtvLogo variant="white" alt="" className="hub-launch-btn-logo" />
                  Launch TTS
                </button>
              </div>
            </section>

            <section className="hub-right" aria-label="Platform features">
              <HubFeatureSlider />
            </section>
          </Container>
        </main>
      </div>
    </div>
  );
}
