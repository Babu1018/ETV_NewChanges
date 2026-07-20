import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function AudioAddMenu({
  open,
  onClose,
  onUpload,
  onRecord,
  anchorRef = null,
  align = "start",
}) {
  const menuRef = useRef(null);
  const [coords, setCoords] = useState(null);

  const updatePosition = () => {
    const anchor = anchorRef?.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 92;
    const gap = 10;
    setCoords({
      left: align === "end" ? rect.right : rect.left,
      top: rect.top - menuH - gap,
      transform: align === "end" ? "translateX(-100%)" : undefined,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return undefined;
    }
    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, anchorRef, align]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      const menu = menuRef.current;
      const anchor = anchorRef?.current;
      if (menu?.contains(e.target) || anchor?.contains(e.target)) return;
      onClose?.();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const menu = (
    <div
      ref={menuRef}
      className={`audio-add-menu${anchorRef ? " audio-add-menu--floating" : ""}${
        coords ? " is-positioned" : ""
      }`}
      role="menu"
      aria-label="Add correction audio"
      style={
        anchorRef && coords
          ? {
              position: "fixed",
              left: coords.left,
              top: coords.top,
              transform: coords.transform,
            }
          : undefined
      }
    >
      <button type="button" className="audio-add-menu-item" role="menuitem" onClick={onUpload}>
        Upload
      </button>
      <button type="button" className="audio-add-menu-item" role="menuitem" onClick={onRecord}>
        Record
      </button>
    </div>
  );

  if (anchorRef) {
    return createPortal(menu, document.body);
  }

  return menu;
}
