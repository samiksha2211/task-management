"use client";

import { useCallback, useEffect, useState } from "react";
import {
  changePassword,
  getStoredUser,
  updateCurrentUser,
  type ApiUser,
} from "@/lib/api";
import { getTheme, initTheme, toggleTheme, type Theme } from "@/lib/theme";

const MAX_AVATAR_BYTES = 2_000_000;

export default function SettingsPanel() {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [name, setName] = useState("");
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const [theme, setTheme] = useState<Theme>("light");

  const refresh = useCallback(() => {
    const stored = getStoredUser();
    if (stored) {
      setUser(stored);
      setName(stored.name);
    }
  }, []);

  useEffect(() => {
    initTheme();
    const t = setTimeout(() => {
      setTheme(getTheme());
      refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [refresh]);

  const saveProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setProfileMessage(null);
    setProfileError(null);
    if (!name.trim()) {
      setProfileError("Name cannot be empty");
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await updateCurrentUser({ name: name.trim() });
      setUser(updated);
      setProfileMessage("Profile updated");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarFile = (file: File | undefined | null) => {
    setProfileMessage(null);
    setProfileError(null);
    if (!file) return;

    if (file.size > MAX_AVATAR_BYTES) {
      setProfileError("Image must be smaller than 2 MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      try {
        const updated = await updateCurrentUser({ avatar: dataUrl });
        setUser(updated);
        setProfileMessage("Profile picture updated");
      } catch (err) {
        setProfileError(err instanceof Error ? err.message : "Upload failed");
      }
    };
    reader.readAsDataURL(file);
  };

  const deleteAvatar = async () => {
    setProfileMessage(null);
    setProfileError(null);
    try {
      const updated = await updateCurrentUser({ avatar: null });
      setUser(updated);
      setProfileMessage("Profile picture removed");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Remove failed");
    }
  };

  const savePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPasswordMessage(null);
    setPasswordError(null);

    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }

    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Password changed successfully");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Change failed");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleThemeToggle = (next: Theme) => {
    setTheme(next);
    toggleTheme();
  };

  const initial = user?.name?.charAt(0).toUpperCase() ?? "?";

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="settings-grid">
        {/* Profile */}
        <section className="settings-card">
          <h2>Profile</h2>

          <div className="avatar-section">
            <div className="avatar-preview">
              {user?.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatar} alt="Profile" className="avatar-img" />
              ) : (
                <span className="avatar-initial">{initial}</span>
              )}
            </div>

            <div className="avatar-actions">
              <label className="avatar-btn">
                Choose Photo
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => handleAvatarFile(e.target.files?.[0])}
                />
              </label>
              {user?.avatar && (
                <button
                  type="button"
                  className="avatar-btn avatar-btn-remove"
                  onClick={deleteAvatar}
                >
                  Remove Photo
                </button>
              )}
            </div>
          </div>

          <form onSubmit={saveProfile}>
            <label>Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <label>Email</label>
            <input type="email" value={user?.email ?? ""} disabled />

            <label>Designation</label>
            <input type="text" value={user?.designation ?? ""} disabled />

            {profileError && <p className="settings-msg settings-error">{profileError}</p>}
            {profileMessage && (
              <p className="settings-msg settings-success">{profileMessage}</p>
            )}

            <button type="submit" disabled={savingProfile}>
              {savingProfile ? "Saving..." : "Save Profile"}
            </button>
          </form>
        </section>

        {/* Password */}
        <section className="settings-card">
          <h2>Change Password</h2>

          <form onSubmit={savePassword}>
            <label>Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />

            <label>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 6 characters"
            />

            <label>Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
            />

            {passwordError && (
              <p className="settings-msg settings-error">{passwordError}</p>
            )}
            {passwordMessage && (
              <p className="settings-msg settings-success">{passwordMessage}</p>
            )}

            <button type="submit" disabled={savingPassword}>
              {savingPassword ? "Saving..." : "Change Password"}
            </button>
          </form>
        </section>

        {/* Theme */}
        <section className="settings-card">
          <h2>Appearance</h2>

          <p className="settings-hint">Choose the theme for the application.</p>

          <div className="theme-options">
            <button
              type="button"
              className={`theme-option ${theme === "light" ? "active" : ""}`}
              onClick={() => handleThemeToggle("light")}
            >
              <span className="theme-swatch theme-light-swatch" />
              Light
            </button>

            <button
              type="button"
              className={`theme-option ${theme === "dark" ? "active" : ""}`}
              onClick={() => handleThemeToggle("dark")}
            >
              <span className="theme-swatch theme-dark-swatch" />
              Dark
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
