import { useEffect, useState } from "react";
import AsrStudioApp from "./AsrStudioApp.jsx";
import TtsStudioApp from "./tts/TtsStudioApp.jsx";
import HubPage from "./pages/HubPage.jsx";
import LogsPage from "./pages/LogsPage.jsx";
import UsersPage from "./pages/UsersPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import { joinAuthUrl } from "./components/auth/authApi.js";
import { defaultAuthApiBaseUrl } from "./utils/authConfig.js";
import { readApiError } from "./utils/apiError.js";
import { fetchWithTimeout } from "./utils/fetchWithTimeout.js";
import {
  clearAuthSession,
  getAuthToken,
  isAuthenticated,
  isAdminUser,
  setStoredUser,
} from "./utils/authSession.js";
import {
  clearScreenHash,
  readScreenFromHash,
  writeScreenToHash,
} from "./utils/appScreen.js";

function goToScreen(setScreen, next) {
  setScreen(next);
  if (next === "hub" || next === "asr" || next === "tts" || next === "logs" || next === "users") {
    writeScreenToHash(next);
  }
}

export default function App() {
  const [screen, setScreen] = useState(() => (isAuthenticated() ? "boot" : "login"));
  const [bootError, setBootError] = useState("");

  useEffect(() => {
    if (!isAuthenticated()) return;

    let cancelled = false;

    async function boot() {
      try {
        const res = await fetchWithTimeout(joinAuthUrl(defaultAuthApiBaseUrl, "/api/users/me"), {
          headers: { Authorization: `Bearer ${getAuthToken()}` },
        }, 120_000);
        if (cancelled) return;
        if (res.ok) {
          const user = await res.json();
          setStoredUser(user);
          const next = readScreenFromHash();
          if ((next === "logs" || next === "users") && !isAdminUser(user)) {
            goToScreen(setScreen, "hub");
            return;
          }
          goToScreen(setScreen, next);
          return;
        }
        clearAuthSession();
        setBootError(
          res.status === 401
            ? "Session expired. Please sign in again."
            : await readApiError(res)
        );
        setScreen("login");
      } catch {
        if (cancelled) return;
        clearAuthSession();
        setBootError(
          "Cannot reach the API. Start the backend: uvicorn main:app --reload (in back_end)."
        );
        setScreen("login");
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = () => {
    clearAuthSession();
    clearScreenHash();
    setBootError("");
    setScreen("login");
  };

  if (screen === "boot") {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="hub-brand hub-brand--auth" aria-label="ETV Validator Studio">
            <span className="hub-brand-title">ETV</span>
            <span className="hub-brand-sub">Validator Studio</span>
          </div>
          <p className="auth-subtitle">Starting…</p>
        </div>
      </div>
    );
  }

  if (screen === "login") {
    return (
      <>
        {bootError ? (
          <div
            className="auth-boot-banner"
            role="alert"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 9999,
              padding: "0.65rem 1rem",
              background: "#fff5f5",
              color: "#b91c1c",
              fontSize: "0.875rem",
              textAlign: "center",
              borderBottom: "1px solid #fecaca",
            }}
          >
            {bootError}
          </div>
        ) : null}
        <LoginPage
          onLoginSuccess={() => {
            setBootError("");
            goToScreen(setScreen, "hub");
          }}
          onGoRegister={() => setScreen("register")}
        />
      </>
    );
  }

  if (screen === "register") {
    return (
      <RegisterPage
        onRegisterSuccess={() => setScreen("login")}
        onGoLogin={() => setScreen("login")}
      />
    );
  }

  if (screen === "hub") {
    return (
      <HubPage
        onOpenAsr={() => goToScreen(setScreen, "asr")}
        onOpenTts={() => goToScreen(setScreen, "tts")}
        onOpenLogs={() => goToScreen(setScreen, "logs")}
        onOpenUsers={() => goToScreen(setScreen, "users")}
        onSignOut={handleSignOut}
      />
    );
  }

  if (screen === "logs") {
    return (
      <LogsPage
        onBackToHub={() => goToScreen(setScreen, "hub")}
        onOpenUsers={() => goToScreen(setScreen, "users")}
        onSignOut={handleSignOut}
      />
    );
  }

  if (screen === "users") {
    return (
      <UsersPage
        onBackToHub={() => goToScreen(setScreen, "hub")}
        onOpenLogs={() => goToScreen(setScreen, "logs")}
        onSignOut={handleSignOut}
      />
    );
  }

  if (screen === "asr") {
    return (
      <AsrStudioApp
        onSignOut={handleSignOut}
        onBackToHub={() => goToScreen(setScreen, "hub")}
      />
    );
  }

  return (
    <TtsStudioApp
      onSignOut={handleSignOut}
      onBackToHub={() => goToScreen(setScreen, "hub")}
    />
  );
}
