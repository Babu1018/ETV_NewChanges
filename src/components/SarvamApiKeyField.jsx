import { useState } from "react";
import PasswordInput from "./auth/PasswordInput.jsx";

export default function SarvamApiKeyField({
  value,
  onChange,
  id = "sarvam-api-key",
  hint,
}) {
  const [selectMode, setSelectMode] = useState("default");

  const handleSelectChange = (e) => {
    const mode = e.target.value;
    setSelectMode(mode);
    onChange({ target: { value: "" } });
  };

  return (
    <div className="studio-sarvam-key" style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <label
          className="studio-sarvam-key-label"
          htmlFor={`${id}-select`}
          style={{
            margin: 0,
            fontWeight: "600",
            fontSize: "0.95rem",
            color: "#334155"
          }}
        >
          API Key Option (Default or Other)
        </label>
        <select
          id={`${id}-select`}
          value={selectMode}
          onChange={handleSelectChange}
          style={{
            padding: "0.25rem 0.5rem",
            border: "1px solid #cbd5e1",
            borderRadius: "8px",
            background: "#ffffff",
            color: "#0f172a",
            fontSize: "0.85rem",
            cursor: "pointer",
            width: "auto"
          }}
        >
          <option value="default">Default</option>
          <option value="custom">Other</option>
        </select>
      </div>

      <div style={{ marginTop: "0.5rem" }}>
        {selectMode === "custom" ? (
          <PasswordInput
            id={id}
            value={value}
            onChange={onChange}
            placeholder="Enter your custom API key"
            autoComplete="off"
            wrapClassName="users-create-password-wrap"
            inputClassName="studio-save-input studio-save-input--password"
            toggleClassName="auth-password-toggle"
          />
        ) : (
          <PasswordInput
            id={`${id}-default`}
            value={value}
            onChange={onChange}
            placeholder="Enter default API key"
            autoComplete="off"
            wrapClassName="users-create-password-wrap"
            inputClassName="studio-save-input studio-save-input--password"
            toggleClassName="auth-password-toggle"
          />
        )}
      </div>
      {hint ? <p className="studio-sarvam-key-hint">{hint}</p> : null}
    </div>
  );
}
