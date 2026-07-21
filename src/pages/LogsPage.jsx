import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "react-bootstrap";
import { Container } from "react-bootstrap";
import AdminNavActions from "../components/AdminNavActions.jsx";
import StudioProfileMenu from "../components/StudioProfileMenu.jsx";
import StudioBreadcrumb from "../components/StudioBreadcrumb.jsx";
import WaveformInlinePlayer from "../components/WaveformInlinePlayer.jsx";
import { joinAuthUrl } from "../components/auth/authApi.js";
import { audioMimeType, normalizeAudioFormat } from "../utils/audioFormat.js";
import { readApiError, sanitizeUserMessage } from "../utils/apiError.js";
import { defaultAuthApiBaseUrl } from "../utils/authConfig.js";
import { getAuthToken, getStoredUser, isAdminUser } from "../utils/authSession.js";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";
import {
  downloadActivityLogEntry,
  downloadActivityLogsBulk,
} from "../utils/adminLogsApi.js";
import backgroundUrl from "../assets/background.jpeg";
import etvLogo from "../assets/etv-logo.png";

const PAGE_SIZE = 20;
const LOG_TEXT_PREVIEW_MAX = 30;

function truncateAtWord(text, maxLen) {
  const value = String(text || "").trim();
  if (!value || value.length <= maxLen) return value;
  const slice = value.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxLen * 0.35 ? slice.slice(0, lastSpace) : slice.trimEnd();
  return `${cut}…`;
}

function logsScriptShortPreview(preview, fullText) {
  const full = String(fullText || preview || "").trim();
  if (!full) return { short: "—", full: "—", isLong: false };

  const previewStr = String(preview || "").trim();
  const firstLine = full.split(/\r?\n/).find((line) => line.trim())?.trim() || full;

  let short;
  if (previewStr && previewStr.length < full.length && previewStr.length <= LOG_TEXT_PREVIEW_MAX) {
    short = previewStr;
  } else {
    short = truncateAtWord(firstLine, LOG_TEXT_PREVIEW_MAX);
  }

  const shortPlain = short.replace(/…$/, "").trim();
  const isLong = full.length > shortPlain.length;
  return { short: isLong ? short : full, full, isLong };
}

function buildPageNumbers(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const nums = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  const sorted = [...nums].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("ellipsis");
    out.push(sorted[i]);
  }
  return out;
}

function LogDateTime({ iso }) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const day = d.getDate();
  const month = d.toLocaleString("en-GB", { month: "short" }).toUpperCase();
  const year = d.getFullYear();
  const time = d
    .toLocaleString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();

  return (
    <span className="logs-col-when-stack">
      <span className="logs-col-when-date">
        {day} {month} {year},
      </span>
      <span className="logs-col-when-time">{time}</span>
    </span>
  );
}

function typeClass(type) {
  return type === "tts" ? "logs-type--tts" : "logs-type--asr";
}

function typeLabel(type) {
  return type === "tts" ? "TTS" : "ASR";
}

function statusClass(status) {
  if (status === "Saved") return "logs-status--saved";
  if (status === "Deleted") return "logs-status--deleted";
  return "logs-status--unsaved";
}

function statusLabel(status) {
  const normalized = status || "Unsaved";
  if (normalized === "Saved" || normalized === "Deleted" || normalized === "Unsaved") {
    return normalized;
  }
  return "Unsaved";
}

function LogsPagination({ currentPage, totalPages, totalItems, loading, onPageChange }) {
  if (totalPages <= 1) return null;

  const start = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, totalItems);
  const pages = buildPageNumbers(currentPage, totalPages);

  return (
    <nav className="history-pagination logs-pagination" aria-label="Log table pages">
      <span className="history-pagination-range logs-pagination-range">
        Showing {start}–{end} of {totalItems}
      </span>
      <div className="history-page-list">
        <button
          type="button"
          className="history-page-btn"
          disabled={loading || currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </button>
        {pages.map((pageNum, idx) =>
          pageNum === "ellipsis" ? (
            <span key={`ellipsis-${idx}`} className="history-page-ellipsis" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={pageNum}
              type="button"
              className={`history-page-btn history-page-num${pageNum === currentPage ? " is-active" : ""}`}
              aria-label={`Page ${pageNum}`}
              aria-current={pageNum === currentPage ? "page" : undefined}
              disabled={loading}
              onClick={() => onPageChange(pageNum)}
            >
              {pageNum}
            </button>
          )
        )}
        <button
          type="button"
          className="history-page-btn"
          disabled={loading || currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

function IconDownload({ className }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function LogScriptModal({ open, title, label, body, onClose }) {
  if (!open) return null;

  return (
    <div className="studio-save-backdrop" role="presentation" onClick={onClose}>
      <div
        className="studio-save-modal history-script-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logs-script-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio-save-head history-script-modal-head">
          <div>
            <p className="logs-script-modal-kicker">{label}</p>
            <h3 id="logs-script-modal-title" className="studio-save-title">
              {title}
            </h3>
          </div>
          <div className="history-script-modal-actions">
            <button
              type="button"
              className="studio-save-close"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>
        <div className="history-script-modal-body logs-script-modal-body">{body}</div>
      </div>
    </div>
  );
}

function LogTextCell({ preview, fullText, label, fileName, onViewMore }) {
  const { short, full, isLong } = logsScriptShortPreview(preview, fullText);

  return (
    <div className="logs-text-cell">
      <span className="logs-text-label">{label}</span>
      <p className="logs-text-content">{short}</p>
      {isLong ? (
        <button
          type="button"
          className="history-view-more logs-text-toggle"
          onClick={() =>
            onViewMore({
              title: fileName || label,
              label,
              body: full,
            })
          }
        >
          View more
        </button>
      ) : null}
    </div>
  );
}

function LogsDeleteConfirmModal({ count, deleting, onCancel, onConfirm }) {
  if (!count) return null;

  return (
    <div
      className="studio-save-backdrop"
      role="presentation"
      onClick={deleting ? undefined : onCancel}
    >
      <div
        className="studio-save-modal history-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logs-delete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio-save-head">
          <h2 id="logs-delete-title" className="studio-save-title">
            Delete selected
          </h2>
          {!deleting ? (
            <button
              type="button"
              className="studio-save-close"
              aria-label="Close"
              onClick={onCancel}
            >
              ×
            </button>
          ) : null}
        </header>
        <div className="studio-save-body">
          <p className="history-confirm-message">
            Are you sure you want to delete <strong>{count}</strong> selected
            {count === 1 ? " log" : " logs"}? This cannot be undone.
          </p>
          <div className="history-confirm-actions">
            <button
              type="button"
              className="history-toolbar-btn"
              disabled={deleting}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="history-clear-btn history-confirm-danger"
              disabled={deleting}
              onClick={onConfirm}
            >
              {deleting ? <Spinner animation="border" size="sm" /> : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LogAudioCell({ entry, onDownload, downloadingId }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState("");
  const isDownloading = downloadingId === entry.id;
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    let url;
    let cancelled = false;

    async function loadAudio() {
      try {
        const res = await fetchWithTimeout(
          joinAuthUrl(
            defaultAuthApiBaseUrl,
            `/api/admin/logs/${entry.type}/${entry.id}/audio`
          ),
          { headers: { Authorization: `Bearer ${getAuthToken()}` } },
          30_000
        );
        if (!res.ok) throw new Error(await readApiError(res));
        const blob = await res.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      } catch (e) {
        if (!cancelled) setErr(sanitizeUserMessage(e.message || e));
      }
    }

    loadAudio();

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [entry.id, entry.type]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (err) return <span className="history-audio-error">{err}</span>;
  if (!src) {
    return (
      <span className="history-audio-loading">
        <Spinner animation="border" size="sm" />
        Loading…
      </span>
    );
  }

  const handleOptionClick = (kind) => {
    setOpen(false);
    onDownload(entry, kind);
  };

  const mime = entry.mimeType || audioMimeType(normalizeAudioFormat(entry.audioFormat));
  return (
    <div className="logs-audio-cell" ref={rootRef} style={{ position: "relative" }}>
      <WaveformInlinePlayer src={src} className="logs-inline-audio" />
      <button
        type="button"
        className="logs-download-btn"
        title="Download options"
        aria-label={`Download options for ${entry.fileName || "entry"}`}
        disabled={isDownloading}
        onClick={() => setOpen((v) => !v)}
      >
        {isDownloading ? <Spinner animation="border" size="sm" /> : <IconDownload />}
      </button>

      {open && (
        <div
          className="history-download-format-menu"
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            width: "180px",
            minWidth: "180px",
            maxWidth: "180px",
            background: "#ffffff",
            border: "1px solid #c7d9fb",
            borderRadius: "10px",
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
            padding: "0.25rem",
            zIndex: 1000
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="history-download-format-option"
            style={{ textAlign: "left", width: "100%" }}
            onClick={() => handleOptionClick("audio")}
          >
            Audio File (.wav)
          </button>
          <button
            type="button"
            role="menuitem"
            className="history-download-format-option"
            style={{ textAlign: "left", width: "100%" }}
            onClick={() => handleOptionClick("excel")}
          >
            Excel Summary (.xlsx)
          </button>
          <button
            type="button"
            role="menuitem"
            className="history-download-format-option"
            style={{ textAlign: "left", width: "100%" }}
            onClick={() => handleOptionClick("json")}
          >
            JSON Details (.json)
          </button>
          <button
            type="button"
            role="menuitem"
            className="history-download-format-option"
            style={{ textAlign: "left", width: "100%" }}
            onClick={() => handleOptionClick("bundle")}
          >
            ZIP Bundle (All Files)
          </button>
        </div>
      )}
    </div>
  );
}

function LogsToolbarDownload({ count, disabled, busy, onDownload }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const handleOptionClick = (kind) => {
    setOpen(false);
    onDownload(kind);
  };

  return (
    <div className="logs-download-dropdown" ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="history-toolbar-btn history-toolbar-btn--primary"
        disabled={disabled || busy || count === 0}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {busy ? (
          <Spinner animation="border" size="sm" className="me-1" />
        ) : (
          <IconDownload className="logs-download-icon me-1" />
        )}
        Download ({count})
      </button>

      {open && (
        <div
          className="history-download-format-menu"
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: "220px",
            minWidth: "220px",
            maxWidth: "220px",
            background: "#ffffff",
            border: "1px solid #c7d9fb",
            borderRadius: "10px",
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
            padding: "0.25rem",
            zIndex: 1000
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="history-download-format-option"
            style={{ textAlign: "left", width: "100%" }}
            onClick={() => handleOptionClick("bundle")}
          >
            ZIP Bundle (Audio & Details)
          </button>
          <button
            type="button"
            role="menuitem"
            className="history-download-format-option"
            style={{ textAlign: "left", width: "100%" }}
            onClick={() => handleOptionClick("excel")}
          >
            Excel Sheet (.xlsx)
          </button>
          <button
            type="button"
            role="menuitem"
            className="history-download-format-option"
            style={{ textAlign: "left", width: "100%" }}
            onClick={() => handleOptionClick("json")}
          >
            JSON Format (.json)
          </button>
          <button
            type="button"
            role="menuitem"
            className="history-download-format-option"
            style={{ textAlign: "left", width: "100%" }}
            onClick={() => handleOptionClick("audio")}
          >
            Audio Only
          </button>
        </div>
      )}
    </div>
  );
}

function editRegionStatusClass(status) {
  if (status === "deleted") return "logs-edit-region-line--deleted";
  if (status === "replaced") return "logs-edit-region-line--replaced";
  if (status === "selected") return "logs-edit-region-line--correction";
  return "";
}

function LogEditCorrectionAudio({ entry, audioId, fileName, label = "Audio" }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!audioId) return undefined;
    let url;
    let cancelled = false;

    async function loadAudio() {
      try {
        const res = await fetchWithTimeout(
          joinAuthUrl(
            defaultAuthApiBaseUrl,
            `/api/admin/logs/${entry.type}/${entry.id}/edit-audio/${audioId}`
          ),
          { headers: { Authorization: `Bearer ${getAuthToken()}` } },
          30_000
        );
        if (!res.ok) throw new Error(await readApiError(res));
        const blob = await res.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      } catch (e) {
        if (!cancelled) setErr(sanitizeUserMessage(e.message || e));
      }
    }

    loadAudio();

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [audioId, entry.id, entry.type]);

  if (!audioId) return null;
  if (err) return <span className="history-audio-error">{err}</span>;
  if (!src) {
    return (
      <span className="history-audio-loading logs-edit-correction-loading">
        <Spinner animation="border" size="sm" />
      </span>
    );
  }

  return (
    <div className="logs-edit-correction-audio">
      <span className="logs-edit-correction-label">{fileName || label}</span>
      <WaveformInlinePlayer src={src} className="logs-inline-audio logs-inline-audio--correction" />
    </div>
  );
}

function editRegionAudioLabel(region) {
  if (region.status === "deleted") return "Deleted clip";
  if (region.status === "replaced") return "Correction (replaced)";
  return "Correction (record or upload)";
}

function LogEditsModal({ open, entry, onClose }) {
  if (!open || !entry) return null;

  const regions = Array.isArray(entry.editRegions) ? entry.editRegions : [];

  return (
    <div className="studio-save-backdrop" role="presentation" onClick={onClose}>
      <div
        className="studio-save-modal history-script-modal logs-edits-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logs-edits-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio-save-head history-script-modal-head">
          <div>
            <p className="logs-script-modal-kicker">TTS edits</p>
            <h3 id="logs-edits-modal-title" className="studio-save-title">
              {entry.fileName || "Audio edits"}
            </h3>
          </div>
          <div className="history-script-modal-actions">
            <button type="button" className="studio-save-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </header>
        <div className="history-script-modal-body logs-edits-modal-body">
          {regions.length === 0 ? (
            <p className="logs-edits-empty">No edit regions recorded.</p>
          ) : (
            <ul className="logs-edits-modal-list">
              {regions.map((region, index) => (
                <li
                  key={`${region.startSec}-${region.endSec}-${region.correctionAudioId || index}`}
                  className="logs-edits-modal-item"
                >
                  <span
                    className={`logs-edit-region-line ${editRegionStatusClass(region.status)}`.trim()}
                  >
                    {region.label || "—"}
                  </span>
                  {region.correctionAudioId ? (
                    <LogEditCorrectionAudio
                      entry={entry}
                      audioId={region.correctionAudioId}
                      fileName={region.correctionFileName}
                      label={editRegionAudioLabel(region)}
                    />
                  ) : (
                    <span className="logs-edits-no-audio">No clip stored for this edit.</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function editRegionsCellPreview(regions) {
  if (!regions.length) return { text: "—", count: 0 };
  if (regions.length === 1) {
    return { text: regions[0].label || "—", count: 1 };
  }
  const first = regions[0].label || "Edit";
  return { text: `${first} (+${regions.length - 1} more)`, count: regions.length };
}

function LogEditRegionCell({ entry, onViewEdits }) {
  const regions = Array.isArray(entry.editRegions) ? entry.editRegions : [];
  if (!regions.length) {
    return entry.editRegionsDisplay ? (
      <div className="logs-text-cell">
        <p className="logs-text-content logs-edit-region-preview">
          {String(entry.editRegionsDisplay).split("\n").filter(Boolean)[0]}
        </p>
        <button type="button" className="history-view-more logs-text-toggle" onClick={() => onViewEdits(entry)}>
          View
        </button>
      </div>
    ) : (
      "—"
    );
  }

  const { text, count } = editRegionsCellPreview(regions);

  return (
    <div className="logs-text-cell">
      <span className="logs-text-label">{count === 1 ? "1 edit" : `${count} edits`}</span>
      <p className="logs-text-content logs-edit-region-preview">{text}</p>
      <button type="button" className="history-view-more logs-text-toggle" onClick={() => onViewEdits(entry)}>
        View
      </button>
    </div>
  );
}

function renderTranscriptDiffSegments(transcriptEdits, { compact = false } = {}) {
  const segments = Array.isArray(transcriptEdits?.segments) ? transcriptEdits.segments : [];
  if (!transcriptEdits?.hasEdits || segments.length === 0) return null;

  return (
    <div className={`logs-transcript-diff${compact ? " logs-transcript-diff--compact" : ""}`}>
      {segments.map((segment, index) => {
        const text = String(segment.text ?? "");
        if (!text) return null;
        if (segment.type === "add") {
          return (
            <span key={`add-${index}`} className="logs-diff-add">
              {text}
            </span>
          );
        }
        if (segment.type === "remove") {
          return (
            <span key={`remove-${index}`} className="logs-diff-remove">
              {text}
            </span>
          );
        }
        return (
          <span key={`equal-${index}`} className="logs-diff-equal">
            {text}
          </span>
        );
      })}
    </div>
  );
}

function transcriptEditsPlainText(transcriptEdits) {
  const segments = Array.isArray(transcriptEdits?.segments) ? transcriptEdits.segments : [];
  return segments.map((segment) => String(segment.text ?? "")).join("");
}

function transcriptEditsShortPreview(transcriptEdits, maxLen = LOG_TEXT_PREVIEW_MAX) {
  const full = transcriptEditsPlainText(transcriptEdits).trim();
  if (!full) return { short: "—", full: "—", isLong: false };

  const short = truncateAtWord(full, maxLen);
  const shortPlain = short.replace(/…$/, "").trim();
  const isLong = full.length > shortPlain.length;
  return { short: isLong ? short : full, full, isLong };
}

function LogTranscriptEditsCell({ entry, onViewMore }) {
  if (!entry.hasTranscriptEdits) return "—";

  const fullDiff = renderTranscriptDiffSegments(entry.transcriptEdits);
  if (!fullDiff) return "—";

  const { short } = transcriptEditsShortPreview(entry.transcriptEdits);

  return (
    <div className="logs-text-cell">
      <span className="logs-text-label">Manual edits</span>
      <p className="logs-text-content">{short}</p>
      <button
        type="button"
        className="history-view-more logs-text-toggle"
        onClick={() =>
          onViewMore({
            title: entry.fileName || "Manual edits",
            label: "Manual edits",
            body: fullDiff,
          })
        }
      >
        View more
      </button>
    </div>
  );
}

export default function LogsPage({ onBackToHub, onOpenUsers, onSignOut }) {
  const user = useMemo(() => getStoredUser(), []);
  const displayName = user
    ? `${user.firstname || ""} ${user.lastname || ""}`.trim()
    : user?.email || "";

  const [entries, setEntries] = useState([]);
  const [meta, setMeta] = useState({ total: 0, total_pages: 1 });
  const [page, setPage] = useState(1);
  const [activityType, setActivityType] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [textModal, setTextModal] = useState(null);
  const [editsModal, setEditsModal] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadingEntryId, setDownloadingEntryId] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const requestIdRef = useRef(0);
  const appliedSearchRef = useRef("");

  useEffect(() => {
    if (!isAdminUser(user)) {
      onBackToHub?.();
    }
  }, [onBackToHub, user]);

  useEffect(() => {
    if (!isAdminUser(user)) return undefined;

    const requestId = ++requestIdRef.current;
    let cancelled = false;

    async function loadLogs() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(page),
          page_size: String(PAGE_SIZE),
        });
        if (activityType !== "all") params.set("type", activityType);
        if (search.trim()) params.set("search", search.trim());

        const res = await fetchWithTimeout(
          joinAuthUrl(defaultAuthApiBaseUrl, `/api/admin/logs?${params}`),
          { headers: { Authorization: `Bearer ${getAuthToken()}` } },
          30_000
        );

        if (cancelled || requestId !== requestIdRef.current) return;

        if (!res.ok) {
          setError(await readApiError(res));
          setEntries([]);
          return;
        }

        const data = await res.json();
        if (cancelled || requestId !== requestIdRef.current) return;

        setEntries(Array.isArray(data.entries) ? data.entries : []);
        setMeta({
          total: data.total || 0,
          total_pages: data.total_pages || 1,
        });

        if (typeof data.page === "number" && data.page !== page && data.page < page) {
          setPage(data.page);
        }
      } catch (e) {
        if (cancelled || requestId !== requestIdRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setEntries([]);
      } finally {
        if (!cancelled && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }

    loadLogs();

    return () => {
      cancelled = true;
    };
  }, [page, search, activityType, user, reloadToken]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const delay = trimmed ? 300 : 0;
    const id = window.setTimeout(() => {
      if (appliedSearchRef.current === trimmed) return;
      appliedSearchRef.current = trimmed;
      setPage(1);
      setSearch(trimmed);
    }, delay);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const handleTypeChange = (value) => {
    setPage(1);
    setActivityType(value);
  };

  const pageIds = useMemo(() => entries.map((entry) => entry.id), [entries]);

  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected =
    pageIds.some((id) => selectedIds.has(id)) && !allPageSelected;

  const toggleOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleDownloadEntry = async (entry, kind = "bundle") => {
    setError("");
    setDownloadingEntryId(entry.id);
    try {
      await downloadActivityLogEntry(entry, kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingEntryId("");
    }
  };

  const handleDownloadSelected = async (kind = "bundle") => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    setError("");
    setDownloadBusy(true);
    try {
      await downloadActivityLogsBulk(ids, kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadBusy(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    setDeleteBusy(true);
    setError("");
    try {
      const res = await fetchWithTimeout(
        joinAuthUrl(defaultAuthApiBaseUrl, "/api/admin/logs"),
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${getAuthToken()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ids }),
        },
        30_000
      );

      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }

      setSelectedIds(new Set());
      setDeleteConfirmOpen(false);
      setReloadToken((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const rowOffset = (page - 1) * PAGE_SIZE;

  if (!isAdminUser(user)) {
    return null;
  }

  return (
    <div className="app-studio logs-page">
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
              <AdminNavActions active="logs" onOpenLogs={() => {}} onOpenUsers={onOpenUsers} />
              <StudioProfileMenu
                user={user}
                displayName={displayName}
                onSignOut={onSignOut}
                isAdmin
                onOpenUsers={onOpenUsers}
              />
            </div>
          </Container>
        </header>

        <main className="studio-main logs-main">
          <Container fluid="lg">
            <StudioBreadcrumb studioLabel="Users Logs" onHome={onBackToHub} />

            <div className="logs-toolbar history-toolbar">
              <input
                id="logs-search"
                type="search"
                className="history-search-input logs-search-input"
                placeholder="File name, script, user, language…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search by file name, script, user, or language"
              />
              <div className="logs-toolbar-actions">
                <select
                  id="logs-type"
                  className="logs-tail-select"
                  value={activityType}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  disabled={loading}
                >
                  <option value="all">All</option>
                  <option value="asr">ASR (Transcribe)</option>
                  <option value="tts">TTS (Generate)</option>
                </select>
                <LogsToolbarDownload
                  count={selectedIds.size}
                  disabled={loading || deleteBusy}
                  busy={downloadBusy}
                  onDownload={handleDownloadSelected}
                />
                <button
                  type="button"
                  className="history-toolbar-btn history-toolbar-btn--danger logs-toolbar-delete"
                  disabled={selectedIds.size === 0 || deleteBusy || loading}
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  {deleteBusy ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    `Delete (${selectedIds.size})`
                  )}
                </button>
              </div>
            </div>

            {error ? (
              <div className="history-alert" role="alert">
                {error}
              </div>
            ) : null}

            <div className={`logs-table-panel${loading ? " is-loading" : ""}`} aria-live="polite">
              {loading && entries.length === 0 ? (
                <p className="logs-table-empty">Loading activity logs…</p>
              ) : entries.length === 0 ? (
                <p className="logs-table-empty">No user activity logs yet.</p>
              ) : (
                <>
                  <div className="history-table-wrap logs-table-wrap">
                    <table className="history-table logs-table logs-activity-table">
                      <thead>
                        <tr>
                          <th className="history-col-check">
                            <input
                              type="checkbox"
                              className="history-checkbox"
                              aria-label="Select all on this page"
                              checked={allPageSelected}
                              disabled={loading || entries.length === 0}
                              ref={(el) => {
                                if (el) el.indeterminate = somePageSelected;
                              }}
                              onChange={toggleAllOnPage}
                            />
                          </th>
                          <th className="history-col-sno">#</th>
                          <th className="history-col-when">Date &amp; Time</th>
                          <th>Type</th>
                          <th>User</th>
                          <th>File Name</th>
                          <th>Status</th>
                          <th>Script / Transcript</th>
                          <th>Edits</th>
                          <th>Audio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((entry, idx) => {
                          const serialNo = rowOffset + idx + 1;
                          const checked = selectedIds.has(entry.id);
                          return (
                          <tr
                            key={`${entry.type}-${entry.id}`}
                            className={checked ? "history-row-selected" : ""}
                          >
                            <td className="history-col-check">
                              <input
                                type="checkbox"
                                className="history-checkbox"
                                aria-label={`Select row ${serialNo}`}
                                checked={checked}
                                onChange={() => toggleOne(entry.id)}
                              />
                            </td>
                            <td className="history-col-sno">{serialNo}</td>
                            <td className="history-col-when">
                              <LogDateTime iso={entry.createdAt} />
                            </td>
                            <td>
                              <span className={`logs-type-badge ${typeClass(entry.type)}`}>
                                {typeLabel(entry.type)}
                              </span>
                            </td>
                            <td className="logs-col-user">
                              <span className="logs-user-name">{entry.userName || "—"}</span>
                              <span className="logs-user-email">{entry.userEmail || "—"}</span>
                            </td>
                            <td className="logs-col-file">
                              <span className="logs-file-name">{entry.fileName || "—"}</span>
                              <span className="logs-file-meta">
                                {entry.language || "—"}
                                {entry.type === "asr" && entry.validatorName
                                  ? ` · ${entry.validatorName}`
                                  : ""}
                                {entry.type === "tts" && entry.gender && entry.gender !== "-"
                                  ? ` · ${entry.gender} ${entry.speaker || ""}`.trim()
                                  : ""}
                              </span>
                            </td>
                            <td className="logs-col-status">
                              <span
                                className={`logs-status-badge ${statusClass(entry.status)}`}
                                title={
                                  entry.status === "Unsaved"
                                    ? "Not saved to user History"
                                    : undefined
                                }
                              >
                                {statusLabel(entry.status)}
                              </span>
                            </td>
                            <td className="logs-col-text">
                              <LogTextCell
                                preview={entry.textPreview}
                                fullText={entry.textContent}
                                label={entry.type === "tts" ? "Script" : "Transcript"}
                                fileName={entry.fileName}
                                onViewMore={setTextModal}
                              />
                            </td>
                            <td className="logs-col-edit-region">
                              {entry.type === "tts" ? (
                                <LogEditRegionCell entry={entry} onViewEdits={setEditsModal} />
                              ) : entry.type === "asr" ? (
                                <LogTranscriptEditsCell entry={entry} onViewMore={setTextModal} />
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="logs-col-audio">
                              <LogAudioCell
                                entry={entry}
                                onDownload={handleDownloadEntry}
                                downloadingId={downloadingEntryId}
                              />
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <LogsPagination
                    currentPage={page}
                    totalPages={meta.total_pages}
                    totalItems={meta.total}
                    loading={loading}
                    onPageChange={setPage}
                  />
                </>
              )}
            </div>
          </Container>
        </main>
      </div>
      <LogScriptModal
        open={Boolean(textModal)}
        title={textModal?.title || ""}
        label={textModal?.label || ""}
        body={textModal?.body || ""}
        onClose={() => setTextModal(null)}
      />
      <LogEditsModal
        open={Boolean(editsModal)}
        entry={editsModal}
        onClose={() => setEditsModal(null)}
      />
      {deleteConfirmOpen ? (
        <LogsDeleteConfirmModal
          count={selectedIds.size}
          deleting={deleteBusy}
          onCancel={() => !deleteBusy && setDeleteConfirmOpen(false)}
          onConfirm={handleDeleteConfirmed}
        />
      ) : null}
    </div>
  );
}
