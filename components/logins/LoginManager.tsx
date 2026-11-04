"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { designationsByDepartment } from "@/lib/departments";

interface Login {
  designation: string;
  email: string | null;
  suggestedEmail: string | null;
  ready: boolean;
  tasks: number;
}

const PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(): string {
  const values = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(values, (v) => PASSWORD_CHARS[v % PASSWORD_CHARS.length]).join("");
}

/** Designations that cannot log in: groups such as "All BOs", and the DRM. */
const hasNoLogin = (designation: string) => /^all\b/i.test(designation) || designation.toLowerCase() === "drm";

/** DRM page: one login per designation, listed department-wise. */
export default function LoginManager() {
  const [logins, setLogins] = useState<Login[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ designation: string; email: string; password: string; settingUp: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ designation: string; email: string | null; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ logins: Login[] }>("/api/users/logins");
      setLogins(data.logins);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load logins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const byDesignation = useMemo(() => new Map(logins.map((l) => [l.designation.toLowerCase(), l])), [logins]);

  const groups = useMemo(() => {
    const { departments, other } = designationsByDepartment(logins.map((l) => l.designation));
    const term = search.trim().toLowerCase();
    const keep = (d: string) => !hasNoLogin(d) && (!term || d.toLowerCase().includes(term));
    const list = departments.map((g) => ({ name: g.department as string, designations: g.designations.filter(keep) }));
    list.push({ name: "Other designations", designations: other.filter(keep) });
    return list.filter((g) => g.designations.length > 0);
  }, [logins, search]);

  const open = (designation: string) => {
    const login = byDesignation.get(designation.toLowerCase());
    setFormError(null);
    setSaved(null);
    setEditing({
      designation,
      email: login?.email ?? login?.suggestedEmail ?? "",
      password: "",
      settingUp: !login?.ready,
    });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    try {
      const data = await apiFetch<{ login: Login }>("/api/users/logins", {
        method: "PUT",
        body: JSON.stringify({
          designation: editing.designation,
          ...(editing.email.trim() && { email: editing.email.trim() }),
          ...(editing.password && { password: editing.password }),
        }),
      });
      setSaved({ designation: editing.designation, email: data.login.email, password: editing.password });
      setEditing(null);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save the login");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="table-status">Loading logins...</p>;
  if (error) return <p className="table-status table-error">{error}</p>;

  const all = groups.flatMap((g) => g.designations);
  const readyCount = all.filter((d) => byDesignation.get(d.toLowerCase())?.ready).length;

  return (
    <div className="logins-page">
      <div className="page-header">
        <h1 className="page-title">Logins</h1>
      </div>
      <p className="logins-intro">
        Each BO designation has its own login. Set the officer&apos;s e-mail and a starting password, then give them to the
        officer. They see their assigned tasks at once and can change the password under Settings.
      </p>

      <div className="logins-toolbar">
        <input
          type="search"
          placeholder="Search designation"
          aria-label="Search designation"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="logins-muted">
          {readyCount} of {all.length} logins set up
        </span>
      </div>

      {saved && (
        <div className="logins-saved" role="status">
          <strong>Login saved for {saved.designation}.</strong> E-mail: {saved.email ?? "-"}
          {saved.password && (
            <>
              {" "}
              · Password: <code>{saved.password}</code>
              <div className="logins-muted">Note this down now; it is not shown again.</div>
            </>
          )}
          <button type="button" className="logins-link" onClick={() => setSaved(null)}>
            Dismiss
          </button>
        </div>
      )}

      {groups.map((group) => (
        <section className="logins-group" key={group.name}>
          <h2>{group.name}</h2>
          <div className="logins-table-wrap">
            <table className="logins-table">
              <thead>
                <tr>
                  <th>Designation</th>
                  <th>Login e-mail</th>
                  <th>Status</th>
                  <th>Tasks</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {group.designations.map((designation) => {
                  const login = byDesignation.get(designation.toLowerCase());
                  const isEditing = editing?.designation === designation;
                  return (
                    <tr key={designation}>
                      <td className="logins-designation">{designation}</td>
                      <td>{login?.email ?? <span className="logins-muted">-</span>}</td>
                      <td>
                        <span className={`logins-chip ${login?.ready ? "is-ready" : ""}`}>
                          {login?.ready ? "Ready" : "Not set up"}
                        </span>
                      </td>
                      <td>{login?.tasks ?? 0}</td>
                      <td className="logins-actions">
                        {isEditing && editing ? (
                          <div className="logins-form">
                            <label>
                              E-mail
                              <input
                                type="email"
                                autoComplete="off"
                                value={editing.email}
                                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                              />
                            </label>
                            <label>
                              {editing.settingUp ? "Starting password" : "New password (optional)"}
                              <input
                                type="text"
                                autoComplete="new-password"
                                value={editing.password}
                                onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                              />
                            </label>
                            <button
                              type="button"
                              className="logins-link"
                              onClick={() => setEditing({ ...editing, password: generatePassword() })}
                            >
                              Generate password
                            </button>
                            {formError && <p className="table-error">{formError}</p>}
                            <div className="logins-form-buttons">
                              <button type="button" className="btn-status" disabled={saving} onClick={save}>
                                {saving ? "Saving..." : "Save"}
                              </button>
                              <button type="button" className="btn-back" disabled={saving} onClick={() => setEditing(null)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" className="btn-status" onClick={() => open(designation)}>
                            {login?.ready ? "Change" : "Set up"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
