import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { sanitizeUserMessage } from "../utils/apiError.js";

const StudioToastContext = createContext(null);

const DEFAULT_DURATION_MS = 5000;

function IconClose() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function StudioToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    ({ message, variant = "info", duration = DEFAULT_DURATION_MS }) => {
      const text = sanitizeUserMessage(String(message ?? "").trim());
      if (!text) return;
      const id = (idRef.current += 1);
      setToasts((list) => [...list, { id, message: text, variant, duration }]);
    },
    []
  );

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <StudioToastContext.Provider value={value}>
      {children}
      <StudioToastHost toasts={toasts} onDismiss={dismiss} />
    </StudioToastContext.Provider>
  );
}

function StudioToastHost({ toasts, onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="studio-toast-stack" aria-live="polite" aria-relevant="additions removals">
      {toasts.map((toast) => (
        <StudioToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function StudioToastCard({ toast, onDismiss }) {
  const { id, message, variant, duration } = toast;

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(id), duration);
    return () => window.clearTimeout(timer);
  }, [id, duration, onDismiss]);

  return (
    <div className={`studio-toast studio-toast--${variant}`} role="status">
      <p className="studio-toast-message">{message}</p>
      <button
        type="button"
        className="studio-toast-close"
        aria-label="Dismiss"
        onClick={() => onDismiss(id)}
      >
        <IconClose />
      </button>
    </div>
  );
}

export function useStudioToast() {
  const ctx = useContext(StudioToastContext);
  if (!ctx) {
    throw new Error("useStudioToast must be used within StudioToastProvider");
  }
  return ctx;
}
