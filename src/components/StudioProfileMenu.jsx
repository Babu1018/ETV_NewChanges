import { useEffect, useRef, useState } from "react";

function profileInitials(displayName, email) {
  if (displayName) {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
    }
    if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

function ProfileChevron() {
  return (
    <svg
      className="studio-profile-chevron-icon"
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

function LogoutIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="studio-profile-logout-icon"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export default function StudioProfileMenu({ user, displayName, onSignOut, isAdmin = false, onOpenLogs, onOpenUsers }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const email = user?.email || "";
  const name =
    displayName ||
    (user?.firstname || user?.first_name
      ? `${user.firstname || user.first_name} ${user.lastname || user.last_name || ""}`.trim()
      : email);
  const shortName = user?.firstname || user?.first_name || name;
  const initials = profileInitials(name, email);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleLogout = () => {
    setOpen(false);
    onSignOut?.();
  };

  return (
    <div className="studio-profile-menu" ref={rootRef}>
      <button
        type="button"
        className={`studio-profile-trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${name || "user"}`}
        title={name || "Account"}
      >
        <span className="studio-profile-avatar" aria-hidden>
          <span className="studio-profile-avatar-text">{initials}</span>
        </span>
        <span className="studio-profile-name">{shortName || "Account"}</span>
        <span className="studio-profile-chevron" aria-hidden>
          <ProfileChevron />
        </span>
      </button>

      {open && (
        <div className="studio-profile-dropdown" role="menu">
          <div className="studio-profile-dropdown-item studio-profile-dropdown-item--static" role="none">
            <span className="studio-profile-dropdown-name">{name || "Signed in"}</span>
            {email ? <span className="studio-profile-dropdown-email">{email}</span> : null}
            <div className="studio-profile-dropdown-footer">
              {isAdmin ? (
                <span className="studio-profile-dropdown-role">Admin</span>
              ) : (
                <div />
              )}
              <button
                type="button"
                className="studio-profile-logout-btn"
                onClick={handleLogout}
                title="Logout"
              >
                <LogoutIcon />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
