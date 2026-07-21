import { useEffect, useMemo, useState } from "react";
import { Spinner } from "react-bootstrap";
import StudioIcon from "./StudioIcon.jsx";
import HistoryAudioPlayer from "./HistoryAudioPlayer.jsx";
import {
  fetchHistoryAudio,
  historyFullText,
  historyTablePreview,
  isHistoryPreviewLong,
} from "../utils/historyApi.js";
import { sanitizeUserMessage } from "../utils/apiError.js";
import { downloadHistoryZip } from "../utils/historyZip.js";

const HISTORY_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Pure-JS diff engine (mirrors Python's difflib SequenceMatcher logic)
// Produces same segment format as backend: {type: "equal"|"add"|"remove", text}
// ---------------------------------------------------------------------------
function computeDiff(original, edited) {
  original = original || "";
  edited = edited || "";
  if (original === edited) return { hasEdits: false, segments: [] };

  // Word-level diff for readability
  const origWords = original.split(/(\s+)/);
  const editWords = edited.split(/(\s+)/);

  const m = origWords.length;
  const n = editWords.length;

  // Build LCS table
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (origWords[i] === editWords[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const segments = [];
  let i = 0, j = 0;
  let equalBuf = "", addBuf = "", removeBuf = "";

  const flush = () => {
    if (removeBuf) { segments.push({ type: "remove", text: removeBuf }); removeBuf = ""; }
    if (addBuf)    { segments.push({ type: "add",    text: addBuf });    addBuf = ""; }
    if (equalBuf)  { segments.push({ type: "equal",  text: equalBuf });  equalBuf = ""; }
  };

  while (i < m || j < n) {
    if (i < m && j < n && origWords[i] === editWords[j]) {
      if (removeBuf || addBuf) flush();
      equalBuf += origWords[i];
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      if (equalBuf) flush();
      addBuf += editWords[j];
      j++;
    } else {
      if (equalBuf) flush();
      removeBuf += origWords[i];
      i++;
    }
  }
  flush();

  return { hasEdits: true, segments };
}

// ---------------------------------------------------------------------------
// Diff renderer — same colour logic as admin logs
// ---------------------------------------------------------------------------
function renderHistoryDiff(transcriptEdits) {
  const segments = Array.isArray(transcriptEdits?.segments) ? transcriptEdits.segments : [];
  if (!transcriptEdits?.hasEdits || segments.length === 0) return null;

  // Inline spans only — no wrapper div — so CSS white-space:nowrap truncates to 1 line
  return segments.map((seg, i) => {
    const text = String(seg.text ?? "");
    if (!text) return null;
    if (seg.type === "add")    return <span key={i} className="logs-diff-add">{text}</span>;
    if (seg.type === "remove") return <span key={i} className="logs-diff-remove">{text}</span>;
    return <span key={i} className="logs-diff-equal">{text}</span>;
  });
}

function renderHistoryDiffFull(transcriptEdits) {
  const segments = Array.isArray(transcriptEdits?.segments) ? transcriptEdits.segments : [];
  if (!transcriptEdits?.hasEdits || segments.length === 0) return null;

  return (
    <div className="logs-transcript-diff">
      {segments.map((seg, i) => {
        const text = String(seg.text ?? "");
        if (!text) return null;
        if (seg.type === "add")    return <span key={i} className="logs-diff-add">{text}</span>;
        if (seg.type === "remove") return <span key={i} className="logs-diff-remove">{text}</span>;
        return <span key={i} className="logs-diff-equal">{text}</span>;
      })}
    </div>
  );
}

function getPageNumbers(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set([1, total, current, current - 1, current + 1]);
  return [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.getDate();
  const month = d.toLocaleString("en-GB", { month: "short" }).toUpperCase();
  const year = d.getFullYear();
  const time = d
    .toLocaleString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
  return `${day} ${month} ${year}, ${time}`;
}

function historyItemSearchBlob(item) {
  const when = formatDate(item.createdAt);
  const language = String(item.language ?? "");
  const validator = String(item.validatorName ?? "");
  const preview = historyFullText(item);
  const iso = String(item.createdAt ?? "");
  return [when, language, validator, preview, iso].join(" ").toLowerCase();
}

function itemMatchesSearch(item, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return historyItemSearchBlob(item).includes(q);
}

function downloadTranscriptText(item) {
  const blob = new Blob([item.transcriptText || item.textPreview || ""], {
    type: "text/plain;charset=utf-8",
  });
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = `${item.fileName || "transcript"}.txt`;
  a.click();
  URL.revokeObjectURL(u);
}

function ModalBackdrop({ onClose, children }) {
  const handleClick = (e) => {
    e.stopPropagation();
    onClose?.();
  };
  if (!onClose) {
    return <div className="studio-save-backdrop">{children}</div>;
  }
  return (
    <div className="studio-save-backdrop" role="presentation" onClick={handleClick}>
      {children}
    </div>
  );
}

function PreviewModal({ item, diff, onClose }) {
  if (!item) return null;
  const title = item.fileName?.trim() || "Transcript preview";
  const hasDiff = diff?.hasEdits === true;
  const body = hasDiff
    ? renderHistoryDiffFull(diff)
    : historyFullText(item);

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        className="studio-save-modal history-script-modal history-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio-save-head history-script-modal-head">
          <div>
            <p className="logs-script-modal-kicker">TRANSCRIPT</p>
            <h3 id="history-preview-title" className="studio-save-title">
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
        <div className="history-script-modal-body history-preview-body">{body}</div>
      </div>
    </ModalBackdrop>
  );
}

function DeleteConfirmModal({ count, deleting, onCancel, onConfirm }) {
  return (
    <ModalBackdrop onClose={deleting ? undefined : onCancel}>
      <div
        className="history-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-delete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="studio-save-head">
          <h2 id="history-delete-title" className="studio-save-title">
            Delete selected
          </h2>
          {!deleting && (
            <button
              type="button"
              className="studio-save-close"
              aria-label="Close"
              onClick={onCancel}
            >
              ×
            </button>
          )}
        </div>
        <div className="history-confirm-body">
          <p>
            Are you sure you want to delete <strong>{count}</strong> selected
            {count === 1 ? " entry" : " entries"}? This cannot be undone.
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
              className="history-toolbar-btn history-toolbar-btn--danger"
              disabled={deleting}
              onClick={onConfirm}
            >
              {deleting ? <Spinner animation="border" size="sm" /> : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

export default function HistoryTab({
  apiBaseUrl,
  accessToken,
  historyItems,
  loading,
  error,
  editLoadingId,
  diffMap,
  onEditItem,
  onDeleteItem,
  onDeleteItems,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [previewItem, setPreviewItem] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = useMemo(
    () => historyItems.filter((item) => itemMatchesSearch(item, searchQuery)),
    [historyItems, searchQuery]
  );

  const itemIds = useMemo(() => historyItems.map((i) => i.id), [historyItems]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / HISTORY_PAGE_SIZE));

  const pageItems = useMemo(() => {
    const start = (page - 1) * HISTORY_PAGE_SIZE;
    return filteredItems.slice(start, start + HISTORY_PAGE_SIZE);
  }, [filteredItems, page]);

  const rangeStart =
    filteredItems.length === 0 ? 0 : (page - 1) * HISTORY_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * HISTORY_PAGE_SIZE, filteredItems.length);

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => itemIds.includes(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [itemIds]);

  const selectedItems = useMemo(
    () => filteredItems.filter((i) => selectedIds.has(i.id)),
    [filteredItems, selectedIds]
  );

  const pageIds = useMemo(() => pageItems.map((i) => i.id), [pageItems]);

  const allPageSelected =
    pageItems.length > 0 && pageItems.every((i) => selectedIds.has(i.id));
  const somePageSelected =
    pageItems.some((i) => selectedIds.has(i.id)) && !allPageSelected;

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

  const pageNumbers = getPageNumbers(page, totalPages);
  const showPagination = filteredItems.length > HISTORY_PAGE_SIZE;

  const handleDownloadAll = async () => {
    if (selectedItems.length === 0) return;
    setZipBusy(true);
    try {
      await downloadHistoryZip(apiBaseUrl, accessToken, selectedItems);
    } catch (e) {
      console.error(e);
    } finally {
      setZipBusy(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setDeleteBusy(true);
    try {
      if (onDeleteItems) await onDeleteItems(ids);
      else {
        for (const id of ids) await onDeleteItem(id);
      }
      setSelectedIds(new Set());
      setDeleteConfirmOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  const bulkBusy = zipBusy || deleteBusy;

  return (
    <div className="history-tab">
      {error && (
        <div className="history-alert" role="alert">
          {sanitizeUserMessage(error)}
        </div>
      )}

      {loading && historyItems.length === 0 ? (
        <div className="history-empty">
          <Spinner animation="border" size="sm" className="me-2" />
          Loading history…
        </div>
      ) : historyItems.length === 0 ? (
        <div className="history-empty">
          <div className="history-empty-icon" aria-hidden>
            🎤
          </div>
          <p className="history-empty-title">No saved transcripts yet</p>
          <p className="history-empty-sub">
            Transcribe audio in the Transcribe tab, then use <strong>Save</strong>.
          </p>
        </div>
      ) : (
        <>
          <div className="history-toolbar">
            <div className="history-toolbar-start">
              <input
                id="history-search"
                type="search"
                className="history-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="When, language, validator, preview…"
                aria-label="Search history by when, language, validator, or preview"
              />
            </div>
            <div className="history-toolbar-actions">
              <button
                type="button"
                className="history-toolbar-btn history-toolbar-btn--primary"
                disabled={selectedIds.size === 0 || bulkBusy || loading}
                onClick={handleDownloadAll}
              >
                {zipBusy ? (
                  <Spinner animation="border" size="sm" />
                ) : (
                  `Download (${selectedIds.size})`
                )}
              </button>
              <button
                type="button"
                className="history-toolbar-btn history-toolbar-btn--danger"
                disabled={selectedIds.size === 0 || bulkBusy || loading}
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
          <div className="history-table-wrap">
            {filteredItems.length === 0 ? (
              <div className="history-search-empty">
                <p className="history-search-empty-title">No matching records</p>
                <p className="history-search-empty-sub">
                  Try another keyword for <strong>When</strong>, <strong>Language</strong>,{" "}
                  <strong>Validator</strong>, or <strong>Preview</strong>.
                </p>
                <button
                  type="button"
                  className="history-toolbar-btn"
                  onClick={() => setSearchQuery("")}
                >
                  Clear search
                </button>
              </div>
            ) : (
            <table className="history-table">
              <thead>
                <tr>
                  <th className="history-col-check">
                    <input
                      type="checkbox"
                      className="history-checkbox"
                      aria-label="Select all on this page"
                      checked={allPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = somePageSelected;
                      }}
                      onChange={toggleAllOnPage}
                    />
                  </th>
                  <th>S.No</th>
                  <th>When</th>
                  <th>Language</th>
                  <th>Validator</th>
                  <th>Output</th>
                  <th>Listen Input</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item, index) => {
                  const diff = diffMap?.get(item.id) ?? null;
                  const hasDiff = diff?.hasEdits === true;
                  const tablePreview = hasDiff
                    ? renderHistoryDiff(diff)
                    : historyTablePreview(item);
                  const showViewMore = hasDiff || isHistoryPreviewLong(item);
                  const checked = selectedIds.has(item.id);
                  const serialNo = rangeStart + index;
                  return (
                    <tr key={item.id} className={checked ? "history-row-selected" : ""}>
                      <td className="history-col-check">
                        <input
                          type="checkbox"
                          className="history-checkbox"
                          aria-label={`Select row ${serialNo}`}
                          checked={checked}
                          onChange={() => toggleOne(item.id)}
                        />
                      </td>
                      <td className="history-col-sno">{serialNo}</td>
                      <td className="history-col-when">{formatDate(item.createdAt)}</td>
                      <td className="history-col-lang">{item.language}</td>
                      <td className="history-col-voice">{item.validatorName || "—"}</td>
                      <td className="history-col-preview">
                        <div className="history-preview-text">
                          {hasDiff ? tablePreview : <span>{tablePreview}</span>}
                        </div>
                        {showViewMore && (
                          <button
                            type="button"
                            className="history-view-more"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewItem(item);
                            }}
                          >
                            View more
                          </button>
                        )}
                      </td>
                      <td className="history-col-listen">
                        <HistoryAudioPlayer
                          apiBaseUrl={apiBaseUrl}
                          itemId={item.id}
                          audioFormat={item.audioFormat}
                          mimeType={item.mimeType}
                          fetchAudioBlob={fetchHistoryAudio}
                        />
                      </td>
                      <td className="history-col-action">
                        <div className="history-action-group">
                          <button
                            type="button"
                            className="history-action-btn"
                            aria-label="Edit transcript"
                            title="Edit in Transcribe tab"
                            disabled={editLoadingId === item.id}
                            onClick={() => onEditItem?.(item)}
                          >
                            {editLoadingId === item.id ? (
                              <Spinner animation="border" size="sm" />
                            ) : (
                              <StudioIcon name="edit" size={18} />
                            )}
                          </button>
                          <button
                            type="button"
                            className="history-action-btn"
                            aria-label="Download transcript"
                            title="Download .txt"
                            onClick={() => downloadTranscriptText(item)}
                          >
                            <StudioIcon name="wav-mp3" size={18} />
                          </button>
                          <button
                            type="button"
                            className="history-action-btn"
                            aria-label="Delete"
                            title="Delete"
                            onClick={() => onDeleteItem(item.id)}
                          >
                            <StudioIcon name="trash" size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
          {showPagination && (
            <nav className="history-pagination" aria-label="History table pages">
              <button
                type="button"
                className="history-page-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <div className="history-page-list">
                {pageNumbers.map((num, idx) => {
                  const prev = pageNumbers[idx - 1];
                  const gap = prev != null && num - prev > 1;
                  return (
                    <span key={num} className="history-page-item">
                      {gap && <span className="history-page-ellipsis" aria-hidden>…</span>}
                      <button
                        type="button"
                        className={`history-page-btn history-page-num${
                          num === page ? " is-active" : ""
                        }`}
                        aria-current={num === page ? "page" : undefined}
                        onClick={() => setPage(num)}
                      >
                        {num}
                      </button>
                    </span>
                  );
                })}
              </div>
              <button
                type="button"
                className="history-page-btn"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}

      <PreviewModal
        item={previewItem}
        diff={previewItem ? (diffMap?.get(previewItem.id) ?? null) : null}
        onClose={() => setPreviewItem(null)}
      />
      {deleteConfirmOpen && (
        <DeleteConfirmModal
          count={selectedIds.size}
          deleting={deleteBusy}
          onCancel={() => !deleteBusy && setDeleteConfirmOpen(false)}
          onConfirm={handleDeleteConfirmed}
        />
      )}
    </div>
  );
}
