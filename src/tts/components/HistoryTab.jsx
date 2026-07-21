import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "react-bootstrap";
import BrandLogo from "./BrandLogo.jsx";
import StudioIcon from "../../components/StudioIcon.jsx";
import { audioMimeType, formatLabel, normalizeAudioFormat } from "../utils/audioFormat.js";
import HistoryAudioPlayer from "../../components/HistoryAudioPlayer.jsx";
import { downloadHistoryItems, fetchHistoryAudio } from "../utils/historyApi.js";
import { sanitizeUserMessage } from "../../utils/apiError.js";
import {
  historyFullScript,
  historyPreviewCell,
  historyPreviewText,
  historyVoiceLabel,
} from "../utils/historyScript.js";

const HISTORY_PAGE_SIZE = 20;
const HISTORY_DOWNLOAD_MENU_WIDTH = 88;

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

function HistoryPagination({ currentPage, totalPages, totalItems, onPageChange }) {
  if (totalPages <= 1) return null;

  const start = (currentPage - 1) * HISTORY_PAGE_SIZE + 1;
  const end = Math.min(currentPage * HISTORY_PAGE_SIZE, totalItems);
  const pages = buildPageNumbers(currentPage, totalPages);

  return (
    <nav className="history-pagination" aria-label="History pages">
      <span className="history-pagination-range">
        Showing {start}–{end} of {totalItems}
      </span>
      <div className="history-pagination-controls">
        <button
          type="button"
          className="history-pagination-btn"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </button>
        {pages.map((page, idx) =>
          page === "ellipsis" ? (
            <span key={`ellipsis-${idx}`} className="history-pagination-ellipsis" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={page}
              type="button"
              className={`history-pagination-btn${page === currentPage ? " is-active" : ""}`}
              aria-label={`Page ${page}`}
              aria-current={page === currentPage ? "page" : undefined}
              onClick={() => onPageChange(page)}
            >
              {page}
            </button>
          )
        )}
        <button
          type="button"
          className="history-pagination-btn"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
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

function historyItemSearchHaystack(item) {
  const voice = historyVoiceLabel(item.scriptText, item.textPreview, item.gender);
  return [
    formatDate(item.createdAt),
    item.language,
    voice,
    historyPreviewText(item.scriptText, item.textPreview),
    historyFullScript(item.scriptText, item.textPreview),
  ]
    .join(" ")
    .toLowerCase();
}

function matchesHistorySearch(item, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return historyItemSearchHaystack(item).includes(q);
}

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HistoryDownloadDropdown({
  items,
  disabled,
  apiBaseUrl,
  apiKey,
  accessToken,
  onError,
  onBusyChange,
  variant = "row",
  label = "Download",
}) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [menuCoords, setMenuCoords] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const isToolbar = variant === "toolbar";

  const updateMenuPosition = () => {
    if (isToolbar) return;
    const anchor = buttonRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 80;
    const menuWidth = HISTORY_DOWNLOAD_MENU_WIDTH;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openAbove = spaceBelow < menuHeight + gap && spaceAbove > spaceBelow;
    const centeredLeft = rect.left + rect.width / 2 - menuWidth / 2;

    setMenuCoords({
      left: Math.min(
        Math.max(8, centeredLeft),
        window.innerWidth - menuWidth - 8
      ),
      top: openAbove ? rect.top - menuHeight - gap : rect.bottom + gap,
    });
  };

  useLayoutEffect(() => {
    if (!open || isToolbar) {
      setMenuCoords(null);
      return undefined;
    }

    updateMenuPosition();
    const raf = requestAnimationFrame(updateMenuPosition);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, isToolbar]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const runDownload = async (format) => {
    if (!items?.length || downloading) return;
    setOpen(false);
    setDownloading(true);
    onBusyChange?.(true);
    onError("");
    try {
      await downloadHistoryItems(apiBaseUrl, accessToken, items, { format, apiKey });
    } catch (e) {
      onError(String(e.message || e));
    } finally {
      setDownloading(false);
      onBusyChange?.(false);
    }
  };

  const menu = open && (
      <div
        ref={menuRef}
        className={`history-download-format-menu${
          isToolbar ? "" : " history-download-format-menu--floating"
        }${!isToolbar && menuCoords ? " is-positioned" : ""}`}
        role="menu"
        aria-label="Download format"
        style={
          isToolbar
            ? undefined
            : menuCoords
              ? {
                  position: "fixed",
                  left: menuCoords.left,
                  top: menuCoords.top,
                  zIndex: 10000,
                }
              : undefined
        }
      >
        {["wav", "mp3"].map((fmt) => (
          <button
            key={fmt}
            type="button"
            role="menuitem"
            className="history-download-format-option"
            onClick={() => runDownload(fmt)}
          >
            {formatLabel(fmt)}
          </button>
        ))}
      </div>
    );

  return (
    <div
      ref={rootRef}
      className={`history-download-dropdown history-download-dropdown--${variant}${
        open ? " is-open" : ""
      }`}
    >
      <button
        ref={buttonRef}
        type="button"
        className={isToolbar ? "history-toolbar-btn" : "history-action-btn"}
        aria-label="Download"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Download"
        disabled={disabled || downloading || !items?.length}
        onClick={() => setOpen((value) => !value)}
      >
        {downloading ? (
          <Spinner animation="border" size="sm" className={isToolbar ? "me-1" : undefined} />
        ) : (
          <StudioIcon
            name="wav-mp3"
            size={isToolbar ? 16 : 18}
            className={isToolbar ? "me-1" : undefined}
          />
        )}
        {isToolbar ? label : null}
      </button>
      {isToolbar ? menu : menu && createPortal(menu, document.body)}
    </div>
  );
}

function HistoryConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  busy = false,
  onClose,
  onConfirm,
}) {
  if (!open) return null;

  return (
    <div
      className="studio-save-backdrop"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onClose?.();
      }}
    >
      <div
        className="studio-save-modal history-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio-save-head">
          <h3 id="history-confirm-title" className="studio-save-title">{title}</h3>
          <button type="button" className="studio-save-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <IconClose />
          </button>
        </header>
        <div className="studio-save-body">
          <p className="history-confirm-message">{message}</p>
          <div className="history-confirm-actions">
            <button type="button" className="history-toolbar-btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="history-clear-btn history-confirm-danger" onClick={onConfirm} disabled={busy}>
              {busy ? <Spinner animation="border" size="sm" /> : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>

  );
}

function downloadScriptText(script, fileName) {
  const blob = new Blob([script], { type: "text/plain;charset=utf-8" });
  const safe =
    String(fileName ?? "script")
      .trim()
      .replace(/[^\w\-. ]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/^_+|_+$/g, "") || "script";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function HistoryScriptModal({ open, title, script, fileName, onClose }) {
  if (!open) return null;

  return (
    <div
      className="studio-save-backdrop"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        onClose?.();
      }}
    >
      <div
        className="studio-save-modal history-script-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-script-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio-save-head history-script-modal-head">
          <div>
            <p className="logs-script-modal-kicker">SCRIPT</p>
            <h3 id="history-script-modal-title" className="studio-save-title">
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
              <IconClose />
            </button>
          </div>
        </header>
        <div className="history-script-modal-body">{script}</div>
      </div>
    </div>
  );
}

function HistoryPreviewCell({ item, disabled, onViewMore }) {
  const { short, full, showViewMore } = historyPreviewCell(
    item.scriptText,
    item.textPreview
  );

  return (
    <td className="history-col-preview">
      <div className="history-preview-cell">
        <span className="history-preview-text" title={!showViewMore ? full : undefined}>
          {short}
        </span>
        {showViewMore && (
          <button
            type="button"
            className="history-view-more"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onViewMore(item);
            }}
          >
            View more
          </button>
        )}
      </div>
    </td>
  );
}

export default function HistoryTab({
  apiBaseUrl,
  apiKey,
  accessToken,
  historyItems,
  loading,
  error,
  editLoadingId,
  onEditItem,
  onDeleteItem,
  onDeleteItems,
}) {

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [scriptView, setScriptView] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const selectAllRef = useRef(null);

  const openScriptView = (item) => {
    setScriptView({
      title: item.fileName?.trim() || "Script",
      script: historyFullScript(item.scriptText, item.textPreview),
      fileName: item.fileName,
    });
  };

  const displayError = localError || error;
  const itemIds = useMemo(() => historyItems.map((item) => item.id), [historyItems]);

  const filteredItems = useMemo(
    () => historyItems.filter((item) => matchesHistorySearch(item, searchQuery)),
    [historyItems, searchQuery]
  );

  const filteredItemIds = useMemo(
    () => filteredItems.map((item) => item.id),
    [filteredItems]
  );

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / HISTORY_PAGE_SIZE));

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * HISTORY_PAGE_SIZE;
    return filteredItems.slice(start, start + HISTORY_PAGE_SIZE);
  }, [filteredItems, currentPage]);

  const selectedCount = selectedIds.size;
  const allFilteredSelected =
    filteredItemIds.length > 0 && filteredItemIds.every((id) => selectedIds.has(id));
  const someFilteredSelected =
    filteredItemIds.some((id) => selectedIds.has(id)) && !allFilteredSelected;

  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(itemIds);
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [itemIds]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(1, page), totalPages));
  }, [totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (el) el.indeterminate = someFilteredSelected;
  }, [someFilteredSelected]);

  const closeConfirm = () => setConfirmDialog(null);

  const toggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredItemIds.forEach((id) => next.delete(id));
      } else {
        filteredItemIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const selectedItems = useMemo(
    () => historyItems.filter((item) => selectedIds.has(item.id)),
    [historyItems, selectedIds]
  );

  const downloadLabel =
    selectedCount > 0 ? `Download (${selectedCount})` : "Download";
  const deleteLabel = selectedCount > 0 ? `Delete (${selectedCount})` : "Delete";

  const requestDeleteSelected = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setConfirmDialog({
      title: ids.length === 1 ? "Delete selected clip?" : `Delete ${ids.length} clips?`,
      message:
        ids.length === 1
          ? "This saved clip will be permanently removed."
          : `This will permanently remove ${ids.length} saved clips.`,
      confirmLabel: "Delete",
      onConfirm: async () => {
        closeConfirm();
        setBulkBusy(true);
        setLocalError("");
        try {
          if (onDeleteItems) {
            await onDeleteItems(ids);
          } else {
            for (const id of ids) {
              await onDeleteItem(id);
            }
          }
          setSelectedIds(new Set());
        } catch (e) {
          setLocalError(String(e.message || e));
        } finally {
          setBulkBusy(false);
        }
      },
    });
  };

  const requestDeleteOne = (id) => {
    setConfirmDialog({
      title: "Delete this clip?",
      message: "This saved clip will be permanently removed.",
      confirmLabel: "Delete",
      onConfirm: async () => {
        closeConfirm();
        setLocalError("");
        try {
          await onDeleteItem(id);
          setSelectedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        } catch (e) {
          setLocalError(String(e.message || e));
        }
      },
    });
  };


  return (
    <div className="history-tab">
      {displayError && (
        <div className="history-alert" role="alert">
          {displayError}
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
            <BrandLogo variant="studio" className="brand-logo--history-empty" />
          </div>
          <p className="history-empty-title">No saved clips yet</p>
          <p className="history-empty-sub">
            Generate audio in the Generate tab, then use <strong>Save</strong> and enter a file name.
          </p>
        </div>
      ) : (
        <>
          <div className="history-toolbar">
            <div className="history-toolbar-left">
              <label className="history-search-label">
                <span className="studio-sr-only">Search history</span>
                <input
                  type="search"
                  className="history-search-input"
                  placeholder="Search When, Language, Voice, Preview…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={bulkBusy || loading}
                  aria-label="Search by When, Language, Voice, or Preview"
                />
              </label>
            </div>
            <div className="history-toolbar-actions">
              <HistoryDownloadDropdown
                variant="toolbar"
                items={selectedItems}
                label={downloadLabel}
                disabled={selectedCount === 0 || bulkBusy || loading}
                apiBaseUrl={apiBaseUrl}
                apiKey={apiKey}
                accessToken={accessToken}
                onError={setLocalError}
                onBusyChange={setBulkBusy}
              />
              <button
                type="button"
                className="history-toolbar-btn history-toolbar-btn-danger"
                disabled={selectedCount === 0 || bulkBusy || loading}
                onClick={requestDeleteSelected}
              >
                {deleteLabel}
              </button>
            </div>
          </div>
          <div className="history-table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th className="history-col-select">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className="history-checkbox"
                      aria-label={
                        searchQuery.trim()
                          ? "Select all matching search results"
                          : "Select all clips"
                      }
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      disabled={bulkBusy || loading || filteredItemIds.length === 0}
                    />
                  </th>
                  <th>S.No</th>
                  <th>When</th>
                  <th>Language</th>
                  <th>Voice</th>
                  <th>Preview</th>
                  <th>Listen</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="history-table-empty">
                      No clips match your search. Try When, Language, Voice, or Preview text.
                    </td>
                  </tr>
                ) : null}
                {paginatedItems.map((item, index) => {
                  const checked = selectedIds.has(item.id);
                  const rowNumber = (currentPage - 1) * HISTORY_PAGE_SIZE + index + 1;
                  return (
                  <tr key={item.id} className={checked ? "is-selected" : ""}>
                    <td className="history-col-select">
                      <input
                        type="checkbox"
                        className="history-checkbox"
                        aria-label={`Select row ${rowNumber}`}
                        checked={checked}
                        onChange={() => toggleRow(item.id)}
                        disabled={bulkBusy || loading}
                      />
                    </td>
                    <td className="history-col-sno">{rowNumber}</td>
                    <td className="history-col-when">{formatDate(item.createdAt)}</td>
                    <td className="history-col-lang">{item.language}</td>
                    <td className="history-col-voice">
                      {historyVoiceLabel(item.scriptText, item.textPreview, item.gender)}
                    </td>
                    <HistoryPreviewCell
                      item={item}
                      disabled={bulkBusy || loading}
                      onViewMore={openScriptView}
                    />
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
                          aria-label="Edit in audio editor"
                          title="Edit in audio editor"
                          disabled={editLoadingId === item.id || bulkBusy}
                          onClick={() => onEditItem?.(item)}
                        >
                          {editLoadingId === item.id ? (
                            <Spinner animation="border" size="sm" />
                          ) : (
                            <StudioIcon name="edit" size={18} />
                          )}
                        </button>
                        <HistoryDownloadDropdown
                          items={[item]}
                          disabled={bulkBusy}
                          apiBaseUrl={apiBaseUrl}
                          apiKey={apiKey}
                          accessToken={accessToken}
                          onError={setLocalError}
                          onBusyChange={setBulkBusy}
                        />
                        <button
                          type="button"
                          className="history-action-btn"
                          aria-label="Delete"
                          title="Delete"
                          disabled={bulkBusy}
                          onClick={() => requestDeleteOne(item.id)}
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
          </div>
          <HistoryPagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredItems.length}
            onPageChange={setCurrentPage}
          />
        </>
      )}

      <HistoryConfirmModal
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title ?? ""}
        message={confirmDialog?.message ?? ""}
        confirmLabel={confirmDialog?.confirmLabel ?? "Confirm"}
        busy={bulkBusy}
        onClose={closeConfirm}
        onConfirm={() => confirmDialog?.onConfirm?.()}
      />

      <HistoryScriptModal
        open={Boolean(scriptView)}
        title={scriptView?.title ?? "Script"}
        script={scriptView?.script ?? ""}
        fileName={scriptView?.fileName}
        onClose={() => setScriptView(null)}
      />
    </div>
  );
}
