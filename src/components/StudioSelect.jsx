import { useEffect, useId, useRef, useState } from "react";

export default function StudioSelect({
  value,
  onChange,
  options,
  compact = false,
  "aria-label": ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? value;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) setHighlight(-1);
  }, [open]);

  const pick = (next) => {
    onChange(next);
    setOpen(false);
  };

  const onTriggerKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
      const idx = options.findIndex((o) => o.value === value);
      setHighlight(idx >= 0 ? idx : 0);
    }
  };

  const onListKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter" && highlight >= 0) {
      e.preventDefault();
      pick(options[highlight].value);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`studio-select-wrap${open ? " studio-select-wrap--open" : ""}`}
    >
      <button
        type="button"
        className={`studio-select studio-select-trigger${compact ? " studio-select-compact" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {label}
      </button>
      {open ? (
        <ul
          id={listId}
          className="studio-select-menu"
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={onListKeyDown}
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isHighlighted = i === highlight;
            return (
              <li key={opt.value} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={[
                    "studio-select-option",
                    isSelected ? "studio-select-option--selected" : "",
                    isHighlighted ? "studio-select-option--highlight" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(opt.value)}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
