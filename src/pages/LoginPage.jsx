import AuthLoginStandalone from "../components/auth/AuthLoginStandalone.jsx";
import { defaultAuthApiBaseUrl } from "../utils/authConfig.js";
import backgroundUrl from "../assets/background.jpeg";

export default function LoginPage({ onLoginSuccess, onGoRegister }) {
  return (
    <div className="auth-shell">
      <div
        className="auth-shell-bg"
        style={{ backgroundImage: `url(${backgroundUrl})` }}
        aria-hidden
      />
      <AuthLoginStandalone
        apiBaseUrl={defaultAuthApiBaseUrl}
        initialView="login"
        showEtvLogo
        showSignUp={Boolean(onGoRegister)}
        onGoToRegister={onGoRegister}
        onLoginSuccess={onLoginSuccess}
        fetchUserAfterLogin
      />
    </div>
  );
}
