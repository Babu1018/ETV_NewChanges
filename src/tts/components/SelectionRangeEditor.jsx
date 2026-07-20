import { useEffect, useState } from "react";
import {
  clampSelectionRange,
  formatTimePrecise,
  parseTimePrecise,
} from "../utils/waveform.js";

function IconTrash({ className }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export default function SelectionRangeEditor({
  selection,
  duration,
  onChange,
  onClear,
  onDelete,
  deleting,
  canUndo,
  onUndo,
}) {
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [startError, setStartError] = useState(false);
  const [endError, setEndError] = useState(false);

  useEffect(() => {
    if (!selection) return;
    setStartText(formatTimePrecise(selection.startSec));
    setEndText(formatTimePrecise(selection.endSec));
    setStartError(false);
    setEndError(false);
  }, [selection?.startSec, selection?.endSec]);

  if (!selection || selection.endSec <= selection.startSec) return null;

  const spanSec = selection.endSec - selection.startSec;

  const commitField = (field) => {
    if (!duration || duration <= 0) return;

    const parsedStart = parseTimePrecise(
      field === "start" ? startText : formatTimePrecise(selection.startSec)
    );
    const parsedEnd = parseTimePrecise(
      field === "end" ? endText : formatTimePrecise(selection.endSec)
    );

    if (field === "start" && !Number.isFinite(parsedStart)) {
      setStartError(true);
      return;
    }
    if (field === "end" && !Number.isFinite(parsedEnd)) {
      setEndError(true);
      return;
    }

    setStartError(false);
    setEndError(false);

    const next = clampSelectionRange(
      field === "start" ? parsedStart : selection.startSec,
      field === "end" ? parsedEnd : selection.endSec,
      duration
    );
    setStartText(formatTimePrecise(next.startSec));
    setEndText(formatTimePrecise(next.endSec));
    onChange?.(next);
  };

  return (
    <span className="studio-audio-edit-hint-actions">
      <span className="studio-audio-edit-range">
        <input
          type="text"
          className={`studio-audio-edit-time-input${startError ? " is-invalid" : ""}`}
          value={startText}
          onChange={(e) => {
            setStartText(e.target.value);
            setStartError(false);
          }}
          onBlur={() => commitField("start")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitField("start");
              e.currentTarget.blur();
            }
          }}
          aria-label="Selection start time"
          spellCheck={false}
        />
        <span aria-hidden> – </span>
        <input
          type="text"
          className={`studio-audio-edit-time-input${endError ? " is-invalid" : ""}`}
          value={endText}
          onChange={(e) => {
            setEndText(e.target.value);
            setEndError(false);
          }}
          onBlur={() => commitField("end")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitField("end");
              e.currentTarget.blur();
            }
          }}
          aria-label="Selection end time"
          spellCheck={false}
        />
        <span className="studio-audio-edit-duration">
          {" "}
          ({formatTimePrecise(spanSec)} selected)
        </span>
      </span>
      {onDelete && (
        <button
          type="button"
          className="studio-audio-edit-delete"
          title="Delete selected region from audio"
          aria-label="Delete selected region"
          disabled={deleting}
          onClick={onDelete}
        >
          {deleting ? (
            <span className="studio-audio-edit-delete-spinner" aria-hidden />
          ) : (
            <IconTrash className="studio-audio-edit-delete-icon" />
          )}
          {deleting ? "Deleting…" : "Delete clip"}
        </button>
      )}
      {canUndo && onUndo && (
        <button
          type="button"
          className="studio-audio-edit-undo"
          title="Undo last deletion — restores audio before the cut"
          aria-label="Undo last deletion"
          onClick={onUndo}
        >
          ↩ Undo delete
        </button>
      )}
      <button type="button" className="studio-audio-edit-clear" onClick={onClear}>
        Clear
      </button>
    </span>
  );
}
