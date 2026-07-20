/**
 * Login, registration, and forgot-password flows (from portable-auth).
 * Backend: POST /api/auth/register, token-login, forgot-password, verify-otp, reset-password
 */

import { useEffect, useRef, useState } from "react";
import { apiPost, joinAuthUrl } from "./authApi.js";
import { setAuthToken, setStoredUser } from "../../utils/authSession.js";
import { readApiError } from "../../utils/apiError.js";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";
import PasswordInput from "./PasswordInput.jsx";

const OTP_LENGTH = 6;

function OtpInput({ length, value, onChange, hasError }) {
  const refs = useRef([]);
  const digits = value.padEnd(length, " ").split("").slice(0, length);

  const setDigit = (index, char) => {
    const only = char.replace(/\D/g, "").slice(-1);
    const arr = digits.map((d) => (d === " " ? "" : d));
    arr[index] = only;
    onChange(arr.join("").trim());
    if (only && index < length - 1) refs.current[index + 1]?.focus();
  };

  const onKeyDown = (index, e) => {
    if (e.key === "Backspace" && !digits[index]?.trim() && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="auth-otp-row">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          className={`auth-otp-box${hasError ? " auth-otp-box--error" : ""}`}
          value={digits[i] === " " ? "" : digits[i]}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
        />
      ))}
    </div>
  );
}

import AsrLogo from "../AsrLogo.jsx";
import EtvLogo from "../EtvLogo.jsx";

export default function AuthLoginStandalone({
  apiBaseUrl,
  appTitle = "Sign in",
  showEtvLogo = false,
  showAppLogo = false,
  onLoginSuccess,
  onRegisterSuccess,
  fetchUserAfterLogin = false,
  loginPath = "/api/auth/token-login",
  showSignUp = true,
  initialView = "login",
  onGoToRegister,
  onGoToLogin,
}) {
  const [view, setView] = useState(initialView);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactNo, setContactNo] = useState("");
  const [dob, setDob] = useState("");
  const [place, setPlace] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [pincode, setPincode] = useState("");
  const [gender, setGender] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    setError("");
  }, [view]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (!email.trim()) throw new Error("Please enter your email");
      if (!password) throw new Error("Please enter your password");
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) throw new Error("Please enter a valid email");

      const data = await apiPost(apiBaseUrl, loginPath, {
        email: email.trim(),
        password,
      });

      const token = data.access_token;
      if (!token) throw new Error("No access token received");

      setAuthToken(token);

      if (data.user) {
        setStoredUser(data.user);
        onLoginSuccess?.(token, data.user);
        return;
      }

      if (fetchUserAfterLogin) {
        const userRes = await fetchWithTimeout(
          joinAuthUrl(apiBaseUrl, "/api/users/me"),
          { headers: { Authorization: `Bearer ${token}` } },
          60_000
        );
        if (!userRes.ok) {
          throw new Error(await readApiError(userRes));
        }
        const user = await userRes.json();
        setStoredUser(user);
        onLoginSuccess?.(token, user);
        return;
      }

      onLoginSuccess?.(token, null);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSendOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (!email.trim()) throw new Error("Please enter your email");
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) throw new Error("Please enter a valid email");

      await apiPost(apiBaseUrl, "/api/auth/forgot-password", { email: email.trim() });
      setOtp("");
      setView("verify");
    } catch (err) {
      setError(err.message || "Failed to send verification code");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (otp.length !== OTP_LENGTH) {
        throw new Error(`Please enter the complete ${OTP_LENGTH}-digit code`);
      }
      const data = await apiPost(apiBaseUrl, "/api/auth/verify-otp", {
        email: email.trim(),
        otp,
      });
      setResetToken(data.reset_token);
      setNewPassword("");
      setConfirmPassword("");
      setView("reset");
    } catch (err) {
      setError(err.message || "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setLoading(true);
    setError("");
    try {
      await apiPost(apiBaseUrl, "/api/auth/forgot-password", { email: email.trim() });
      setOtp("");
    } catch (err) {
      setError(err.message || "Failed to resend code");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (!newPassword || !confirmPassword) throw new Error("Please fill in all fields");
      if (newPassword !== confirmPassword) throw new Error("Passwords do not match");
      if (newPassword.length < 6) throw new Error("Password must be at least 6 characters");

      await apiPost(apiBaseUrl, "/api/auth/reset-password", {
        email: email.trim(),
        token: resetToken,
        new_password: newPassword,
      });
      setView("success");
    } catch (err) {
      setError(err.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  const clearRegisterForm = () => {
    setFirstName("");
    setLastName("");
    setContactNo("");
    setDob("");
    setPlace("");
    setCity("");
    setStateVal("");
    setPincode("");
    setGender("");
    setRegPassword("");
    setRegConfirmPassword("");
  };

  const goLogin = () => {
    if (onGoToLogin) {
      onGoToLogin();
      return;
    }
    setView("login");
    setPassword("");
    setOtp("");
    setResetToken("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
  };

  const goRegister = () => {
    if (onGoToRegister) {
      onGoToRegister();
      return;
    }
    setError("");
    setView("register");
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (!firstName.trim() || !lastName.trim() || !email.trim() || !regPassword || !regConfirmPassword) {
        throw new Error("Please fill in required fields");
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) throw new Error("Please enter a valid email");
      if (regPassword !== regConfirmPassword) throw new Error("Passwords do not match");
      if (regPassword.length < 6) throw new Error("Password must be at least 6 characters");

      await apiPost(apiBaseUrl, "/api/auth/register", {
        firstname: firstName.trim(),
        lastname: lastName.trim(),
        email: email.trim(),
        password: regPassword,
        dob: dob || null,
        contactno: contactNo || null,
        place: place || null,
        city: city || null,
        state: stateVal || null,
        pincode: pincode || null,
        gender: gender || null,
      });

      clearRegisterForm();
      setView("register-success");
      onRegisterSuccess?.();
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const renderError = () =>
    error ? (
      <div className="auth-error">
        <span aria-hidden>⚠</span>
        <span>{error}</span>
      </div>
    ) : null;

  const btn = (label, busyLabel) => (
    <button type="submit" className="auth-btn" disabled={loading}>
      {loading ? busyLabel || "Please wait..." : label}
    </button>
  );

  const wrap = (children, wide = false) => (
    <div className="auth-page">
      <div className={`auth-card${wide ? " auth-card--wide" : ""}`}>{children}</div>
    </div>
  );

  if (view === "login") {
    return wrap(
      <>
        {showEtvLogo ? (
          <div className="auth-brand">
            {/* Use purple logo as requested for the login page */}
            <EtvLogo variant="purple" className="auth-etv-logo" />
          </div>
        ) : showAppLogo ? (
          <div className="auth-brand">
            <AsrLogo variant="login" />
          </div>
        ) : null}
        <h1 className="auth-title">{appTitle}</h1>
        <p className="auth-subtitle">Enter your email and password to continue.</p>
        {renderError()}
        <form onSubmit={handleLogin}>
          <input
            type="email"
            className="auth-input"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <PasswordInput
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <div className="auth-row">
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setError("");
                setView("forgot");
              }}
            >
              Forgot Password?
            </button>
          </div>
          {btn("Sign in", "Signing in...")}
        </form>
        {/* {showSignUp && (
          <div className="auth-footer">
            <span>Don&apos;t have an account? </span>
            <button type="button" className="auth-link" onClick={goRegister}>
              Sign up
            </button>
          </div>
        )} */}
      </>
    );
  }

  if (view === "register") {
    return wrap(
      <>
        <h1 className="auth-title">Create Account</h1>
        <p className="auth-subtitle">Register to access TTS Studio.</p>
        {renderError()}
        <form onSubmit={handleRegister}>
          <div className="auth-scroll-form">
            <div className="auth-form-row">
              <input
                type="text"
                className="auth-input"
                placeholder="First Name *"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
              <input
                type="text"
                className="auth-input"
                placeholder="Last Name *"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
            <div className="auth-form-row">
              <input
                type="email"
                className="auth-input"
                placeholder="Email *"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <input
                type="tel"
                className="auth-input"
                placeholder="Contact Number"
                value={contactNo}
                onChange={(e) => setContactNo(e.target.value)}
              />
            </div>
            <div className="auth-form-row">
              <input type="date" className="auth-input" value={dob} onChange={(e) => setDob(e.target.value)} />
              <input
                type="text"
                className="auth-input"
                placeholder="Place"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
              />
            </div>
            <div className="auth-form-row">
              <input
                type="text"
                className="auth-input"
                placeholder="City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
              <input
                type="text"
                className="auth-input"
                placeholder="State"
                value={stateVal}
                onChange={(e) => setStateVal(e.target.value)}
              />
            </div>
            <div className="auth-form-row">
              <input
                type="text"
                className="auth-input"
                placeholder="Pincode"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
              />
              <select className="auth-select" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">Select Gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <PasswordInput
              placeholder="Password *"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
            <PasswordInput
              placeholder="Confirm Password *"
              value={regConfirmPassword}
              onChange={(e) => setRegConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          {btn("Create Account", "Creating Account...")}
        </form>
        <div className="auth-footer">
          <span>Already have an account? </span>
          <button type="button" className="auth-link" onClick={goLogin}>
            Sign in
          </button>
        </div>
      </>,
      true
    );
  }

  if (view === "register-success") {
    return wrap(
      <>
        <div className="auth-success-icon">✓</div>
        <h1 className="auth-title">Account Created</h1>
        <p className="auth-subtitle">Registration successful. Please sign in with your credentials.</p>
        <button type="button" className="auth-btn" onClick={goLogin}>
          Go to Sign in
        </button>
      </>
    );
  }

  if (view === "forgot") {
    return wrap(
      <>
        <h1 className="auth-title">Forgot Password</h1>
        <p className="auth-subtitle">
          Please enter your registered email address below. We will send you a 6-digit verification code (OTP) to safely verify your identity and reset your account password.
        </p>
        {renderError()}
        <form onSubmit={handleForgotSendOtp}>
          <input
            type="email"
            className="auth-input"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {btn("Continue", "Sending...")}
        </form>
        <div className="auth-footer">
          <button type="button" className="auth-link" onClick={goLogin}>
            Back to Sign in
          </button>
        </div>
      </>
    );
  }

  if (view === "verify") {
    return wrap(
      <>
        <h1 className="auth-title">Verification</h1>
        <p className="auth-subtitle">
          Enter the {OTP_LENGTH}-digit code sent to <strong>{email}</strong>
        </p>
        {renderError()}
        <form onSubmit={handleVerifyOtp}>
          <OtpInput length={OTP_LENGTH} value={otp} onChange={setOtp} hasError={!!error} />
          {btn("Verify", "Verifying...")}
        </form>
        <div className="auth-footer">
          <span>Did not receive code? </span>
          <button type="button" className="auth-link" onClick={handleResendOtp} disabled={loading}>
            Resend code
          </button>
          <br />
          <button type="button" className="auth-link" style={{ marginTop: 12 }} onClick={goLogin}>
            Back to Sign in
          </button>
        </div>
      </>
    );
  }

  if (view === "reset") {
    return wrap(
      <>
        <h1 className="auth-title">Reset Password</h1>
        <p className="auth-subtitle">Choose a new password for your account.</p>
        {renderError()}
        <form onSubmit={handleResetPassword}>
          <PasswordInput
            placeholder="New Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
          <PasswordInput
            placeholder="Confirm New Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
          {btn("Reset Password", "Resetting...")}
        </form>
        <div className="auth-footer">
          <button type="button" className="auth-link" onClick={goLogin}>
            Back to Sign in
          </button>
        </div>
      </>
    );
  }

  if (view === "success") {
    return wrap(
      <>
        <div className="auth-success-icon">✓</div>
        <h1 className="auth-title">Password Updated</h1>
        <p className="auth-subtitle">You can now sign in with your new password.</p>
        <button type="button" className="auth-btn" onClick={goLogin}>
          Continue to Sign in
        </button>
      </>
    );
  }

  return null;
}
