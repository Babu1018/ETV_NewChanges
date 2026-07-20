import { useEffect, useRef, useState } from "react";
import { downloadValidatorLog } from "../utils/adminLogsApi.js";

function ChevronDown({ className }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AdminNavActions({ active, onOpenLogs, onOpenUsers }) {
  const [detailedOpen, setDetailedOpen] = useState(false);
  const [downloading, setDownloading] = useState("");
  const detailedRef = useRef(null);

  useEffect(() => {
    if (!detailedOpen) return undefined;
    const onDocClick = (e) => {
      if (detailedRef.current && !detailedRef.current.contains(e.target)) {
        setDetailedOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setDetailedOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [detailedOpen]);

  const handleDownload = async (kind) => {
    setDetailedOpen(false);
    setDownloading(kind);
    try {
      await downloadValidatorLog(kind);
    } catch (e) {
      window.alert(String(e.message || e));
    } finally {
      setDownloading("");
    }
  };

  return (
    <div className="studio-nav-links admin-nav-links">
      <button
        type="button"
        className={`admin-nav-item${active === "logs" ? " is-active" : ""}`}
        onClick={onOpenLogs}
      >
        Users Logs
      </button>
      <button
        type="button"
        className={`admin-nav-item${active === "users" ? " is-active" : ""}`}
        onClick={onOpenUsers}
      >
        Manage Users
      </button>
      <div className="admin-nav-dropdown" ref={detailedRef}>
        <button
          type="button"
          className={`admin-nav-item admin-nav-item--dropdown${detailedOpen ? " is-open" : ""}`}
          onClick={() => setDetailedOpen((v) => !v)}
          aria-expanded={detailedOpen}
          aria-haspopup="menu"
        >
          Detailed Logs
          <ChevronDown className="admin-nav-chevron" />
        </button>
        {detailedOpen ? (
          <div className="admin-nav-dropdown-menu" role="menu">
            <button
              type="button"
              className="admin-nav-dropdown-item"
              role="menuitem"
              disabled={downloading === "asr"}
              onClick={() => handleDownload("asr")}
            >
              {downloading === "asr" ? "Downloading…" : "ASR Logs"}
            </button>
            <button
              type="button"
              className="admin-nav-dropdown-item"
              role="menuitem"
              disabled={downloading === "tts"}
              onClick={() => handleDownload("tts")}
            >
              {downloading === "tts" ? "Downloading…" : "TTS Logs"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
