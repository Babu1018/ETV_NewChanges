import { useCallback, useEffect, useMemo, useState } from "react";
import { Container, Spinner } from "react-bootstrap";
import AdminNavActions from "../components/AdminNavActions.jsx";
import PasswordInput from "../components/auth/PasswordInput.jsx";
import StudioBreadcrumb from "../components/StudioBreadcrumb.jsx";
import StudioIcon from "../components/StudioIcon.jsx";
import StudioProfileMenu from "../components/StudioProfileMenu.jsx";
import { getAuthToken, getStoredUser, isAdminUser } from "../utils/authSession.js";
import { sanitizeUserMessage } from "../utils/apiError.js";
import { createUser, deleteUser, fetchUsersList, updateUser } from "../utils/usersApi.js";
import backgroundUrl from "../assets/background.jpeg";
import etvLogo from "../assets/etv-logo.png";

const EMPTY_FORM = {
  firstname: "",
  lastname: "",
  email: "",
  password: "",
  role: "user",
};

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function roleBadgeClass(role) {
  return role === "admin" ? "users-role--admin" : "users-role--user";
}

function RoleChangeConfirmModal({ pending, busy, onCancel, onConfirm }) {
  if (!pending) return null;

  const roleLabel = pending.nextRole === "admin" ? "Admin" : "User";

  return (
    <div
      className="studio-save-backdrop"
      role="presentation"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="studio-save-modal history-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="users-role-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio-save-head">
          <h2 id="users-role-confirm-title" className="studio-save-title">
            Change role
          </h2>
          {!busy ? (
            <button type="button" className="studio-save-close" aria-label="Close" onClick={onCancel}>
              ×
            </button>
          ) : null}
        </header>
        <div className="studio-save-body history-confirm-body">
          <p className="history-confirm-message">
            Change <strong>{pending.fullName}</strong> from{" "}
            <span className={`users-role-badge ${roleBadgeClass(pending.row.role)}`}>
              {pending.row.role === "admin" ? "Admin" : "User"}
            </span>{" "}
            to{" "}
            <span className={`users-role-badge ${roleBadgeClass(pending.nextRole)}`}>
              {roleLabel}
            </span>
            ?
          </p>
          <div className="history-confirm-actions">
            <button type="button" className="history-toolbar-btn" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="history-toolbar-btn history-toolbar-btn--primary"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? <Spinner animation="border" size="sm" /> : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteUserConfirmModal({ pending, busy, onCancel, onConfirm }) {
  if (!pending) return null;

  return (
    <div
      className="studio-save-backdrop"
      role="presentation"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="studio-save-modal history-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="users-delete-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio-save-head">
          <h2 id="users-delete-confirm-title" className="studio-save-title">
            Delete user
          </h2>
          {!busy ? (
            <button type="button" className="studio-save-close" aria-label="Close" onClick={onCancel}>
              ×
            </button>
          ) : null}
        </header>
        <div className="studio-save-body history-confirm-body">
          <p className="history-confirm-message">
            Permanently delete <strong>{pending.fullName}</strong> ({pending.row.email})? This removes
            their account and personal ASR/TTS history. Their entries in Users Logs will be kept for
            audit. This cannot be undone.
          </p>
          <div className="history-confirm-actions">
            <button type="button" className="history-toolbar-btn" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="history-clear-btn history-confirm-danger"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? <Spinner animation="border" size="sm" /> : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateUserModal({ open, busy, error, onClose, onSubmit }) {
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (open) setForm(EMPTY_FORM);
  }, [open]);

  if (!open) return null;

  const handleChange = (field) => (e) => {
    const val = e.target.value;
    setForm((prev) => {
      const next = { ...prev, [field]: val };
      if (field === "firstname") {
        const rawOldFirstFour = prev.firstname.trim().slice(0, 4);
        const oldFirstFour = rawOldFirstFour ? (rawOldFirstFour.charAt(0).toUpperCase() + rawOldFirstFour.slice(1)) : "";
        const expectedOldPassword = oldFirstFour ? `${oldFirstFour}@1234` : "";
        if (!prev.password || prev.password === expectedOldPassword) {
          const rawFirstFour = val.trim().slice(0, 4);
          const firstFour = rawFirstFour ? (rawFirstFour.charAt(0).toUpperCase() + rawFirstFour.slice(1)) : "";
          next.password = firstFour ? `${firstFour}@1234` : "";
        }
      }
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <div className="studio-save-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <div
        className="studio-save-modal history-confirm-modal users-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="users-create-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio-save-head">
          <h2 id="users-create-title" className="studio-save-title">
            Create user
          </h2>
          <button
            type="button"
            className="studio-save-close"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </header>
        <form className="studio-save-body users-create-form" onSubmit={handleSubmit}>
          {error ? (
            <div className="history-alert users-create-alert" role="alert">
              {error}
            </div>
          ) : null}
          <div className="users-create-grid">
            <label className="users-create-field">
              <span className="studio-save-label">First name</span>
              <input
                type="text"
                className="studio-save-input"
                value={form.firstname}
                onChange={handleChange("firstname")}
                required
                autoComplete="given-name"
              />
            </label>
            <label className="users-create-field">
              <span className="studio-save-label">Last name</span>
              <input
                type="text"
                className="studio-save-input"
                value={form.lastname}
                onChange={handleChange("lastname")}
                required
                autoComplete="family-name"
              />
            </label>
            <label className="users-create-field users-create-field--full">
              <span className="studio-save-label">Email</span>
              <input
                type="email"
                className="studio-save-input"
                value={form.email}
                onChange={handleChange("email")}
                required
                autoComplete="email"
              />
            </label>
            <label className="users-create-field users-create-field--full">
              <span className="studio-save-label">Password</span>
              <PasswordInput
                id="users-create-password"
                value={form.password}
                onChange={handleChange("password")}
                required
                minLength={6}
                autoComplete="new-password"
                wrapClassName="users-create-password-wrap"
                inputClassName="studio-save-input studio-save-input--password"
                toggleClassName="auth-password-toggle users-create-password-toggle"
              />
            </label>
            <label className="users-create-field users-create-field--full">
              <span className="studio-save-label">Role</span>
              <select
                className="studio-save-input users-create-select"
                value={form.role}
                onChange={handleChange("role")}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          <div className="history-confirm-actions users-create-actions">
            <button type="button" className="history-toolbar-btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="history-toolbar-btn history-toolbar-btn--primary" disabled={busy}>
              {busy ? <Spinner animation="border" size="sm" /> : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function UsersPage({ onBackToHub, onOpenLogs, onSignOut }) {
  const user = getStoredUser();
  const accessToken = getAuthToken();
  const displayName = user ? `${user.firstname || ""} ${user.lastname || ""}`.trim() : "";

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [rowBusyId, setRowBusyId] = useState("");
  const [roleConfirm, setRoleConfirm] = useState(null);
  const [roleConfirmBusy, setRoleConfirmBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteConfirmBusy, setDeleteConfirmBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    if (!accessToken) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const list = await fetchUsersList(accessToken);
      setItems(list);
    } catch (e) {
      setError(sanitizeUserMessage(e.message || e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filteredItems = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return items;
    return items.filter((row) => {
      const haystack = [
        row.firstname,
        row.lastname,
        row.email,
        row.role,
        row.is_active ? "active" : "inactive",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, searchInput]);

  const handleCreate = async (form) => {
    setCreateBusy(true);
    setCreateError("");
    try {
      await createUser(accessToken, {
        firstname: form.firstname.trim(),
        lastname: form.lastname.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
      });
      setCreateOpen(false);
      await loadUsers();
    } catch (e) {
      setCreateError(sanitizeUserMessage(e.message || e));
    } finally {
      setCreateBusy(false);
    }
  };

  const handleRoleChangeRequest = (row, nextRole, fullName) => {
    if (row.role === nextRole) return;
    setRoleConfirm({ row, nextRole, fullName });
  };

  const handleRoleConfirm = async () => {
    if (!roleConfirm) return;
    const { row, nextRole } = roleConfirm;
    setRoleConfirmBusy(true);
    setRowBusyId(row.id);
    setError("");
    try {
      const updated = await updateUser(accessToken, row.id, { role: nextRole });
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setRoleConfirm(null);
    } catch (e) {
      setError(sanitizeUserMessage(e.message || e));
    } finally {
      setRoleConfirmBusy(false);
      setRowBusyId("");
    }
  };

  const handleActiveToggle = async (row) => {
    setRowBusyId(row.id);
    setError("");
    try {
      const updated = await updateUser(accessToken, row.id, { is_active: !row.is_active });
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (e) {
      setError(sanitizeUserMessage(e.message || e));
    } finally {
      setRowBusyId("");
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    const { row } = deleteConfirm;
    setDeleteConfirmBusy(true);
    setRowBusyId(row.id);
    setError("");
    try {
      await deleteUser(accessToken, row.id);
      setItems((prev) => prev.filter((item) => item.id !== row.id));
      setDeleteConfirm(null);
    } catch (e) {
      setError(sanitizeUserMessage(e.message || e));
    } finally {
      setDeleteConfirmBusy(false);
      setRowBusyId("");
    }
  };

  if (!isAdminUser(user)) {
    return null;
  }

  return (
    <div className="app-studio users-page">
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
              <AdminNavActions active="users" onOpenLogs={onOpenLogs} onOpenUsers={() => {}} />
              <StudioProfileMenu
                user={user}
                displayName={displayName}
                onSignOut={onSignOut}
                isAdmin
              />
            </div>
          </Container>
        </header>

        <main className="studio-main users-main">
          <Container fluid="lg">
            <StudioBreadcrumb studioLabel="Manage Users" onHome={onBackToHub} />

            <div className="users-toolbar history-toolbar logs-toolbar">
              <input
                type="search"
                className="history-search-input users-search-input"
                placeholder="Search by name, email, or role…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search users"
              />
              <div className="users-toolbar-actions logs-toolbar-actions">
                <button
                  type="button"
                  className="history-toolbar-btn history-toolbar-btn--primary"
                  onClick={() => {
                    setCreateError("");
                    setCreateOpen(true);
                  }}
                >
                  + New user
                </button>
              </div>
            </div>

            {error ? (
              <div className="history-alert users-alert" role="alert">
                {error}
              </div>
            ) : null}

            <div className={`users-table-panel logs-table-panel${loading ? " is-loading" : ""}`}>
              <div className="history-table-wrap users-table-wrap">
                <table className="history-table users-table">
                  <thead>
                    <tr>
                      <th className="history-col-sno">S.No</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="logs-table-empty">
                          <Spinner animation="border" size="sm" /> Loading users…
                        </td>
                      </tr>
                    ) : filteredItems.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="logs-table-empty">
                          {searchInput.trim() ? "No users match your search." : "No users yet."}
                        </td>
                      </tr>
                    ) : (
                      filteredItems.map((row, index) => {
                        const isSelf = row.id === user?.id;
                        const busy = rowBusyId === row.id;
                        const fullName = `${row.firstname} ${row.lastname}`.trim() || row.email;
                        return (
                          <tr key={row.id}>
                            <td className="history-col-sno">{index + 1}</td>
                            <td>
                              {fullName}
                              {isSelf ? <span className="users-self-tag">You</span> : null}
                            </td>
                            <td>{row.email}</td>
                            <td>
                              <span className={`users-role-badge ${roleBadgeClass(row.role)}`}>
                                {row.role === "admin" ? "Admin" : "User"}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`users-status-badge${row.is_active ? " users-status--active" : " users-status--inactive"}`}
                              >
                                {row.is_active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td>{formatDate(row.created_at)}</td>
                            <td>
                              <div className="users-row-actions">
                                <div className="users-role-picker">
                                  <label className="users-role-picker-label" htmlFor={`role-${row.id}`}>
                                    Role
                                  </label>
                                  <select
                                    id={`role-${row.id}`}
                                    className="users-role-select"
                                    value={row.role}
                                    disabled={busy || (isSelf && row.role === "admin")}
                                    onChange={(e) =>
                                      handleRoleChangeRequest(row, e.target.value, fullName)
                                    }
                                    aria-label={`Role for ${fullName}`}
                                  >
                                    <option value="user">User</option>
                                    <option value="admin">Admin</option>
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  className={`history-toolbar-btn users-toggle-btn${row.is_active ? "" : " users-toggle-btn--activate"}`}
                                  disabled={busy || isSelf}
                                  onClick={() => handleActiveToggle(row)}
                                >
                                  {busy && !deleteConfirm ? (
                                    <Spinner animation="border" size="sm" />
                                  ) : row.is_active ? (
                                    "Deactivate"
                                  ) : (
                                    "Activate"
                                  )}
                                </button>
                                <span className="history-action-group">
                                  <button
                                    type="button"
                                    className="history-action-btn users-delete-btn"
                                    aria-label={`Delete ${fullName}`}
                                    title="Delete"
                                    disabled={busy || isSelf}
                                    onClick={() =>
                                      setDeleteConfirm({ row, fullName })
                                    }
                                  >
                                    <StudioIcon name="trash" size={18} />
                                  </button>
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Container>
        </main>
      </div>

      <CreateUserModal
        open={createOpen}
        busy={createBusy}
        error={createError}
        onClose={() => !createBusy && setCreateOpen(false)}
        onSubmit={handleCreate}
      />

      <RoleChangeConfirmModal
        pending={roleConfirm}
        busy={roleConfirmBusy}
        onCancel={() => !roleConfirmBusy && setRoleConfirm(null)}
        onConfirm={handleRoleConfirm}
      />

      <DeleteUserConfirmModal
        pending={deleteConfirm}
        busy={deleteConfirmBusy}
        onCancel={() => !deleteConfirmBusy && setDeleteConfirm(null)}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
