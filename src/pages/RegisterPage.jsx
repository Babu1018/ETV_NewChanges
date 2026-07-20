import AuthLoginStandalone from "../components/auth/AuthLoginStandalone.jsx";
import { defaultAuthApiBaseUrl } from "../utils/authConfig.js";
import backgroundUrl from "../assets/background.jpeg";

export default function RegisterPage({ onRegisterSuccess, onGoLogin }) {
  return (
    <div className="auth-shell">
      <div
        className="auth-shell-bg"
        style={{ backgroundImage: `url(${backgroundUrl})` }}
        aria-hidden
      />
      <div className="hub-brand hub-brand--auth" aria-label="ETV Validator Studio">
        <span className="hub-brand-title">ETV</span>
        <span className="hub-brand-sub">Validator Studio</span>
      </div>
      <AuthLoginStandalone
        apiBaseUrl={defaultAuthApiBaseUrl}
        initialView="register"
        showSignUp={false}
        onGoToLogin={onGoLogin}
        onRegisterSuccess={onRegisterSuccess}
      />
    </div>
  );
}
