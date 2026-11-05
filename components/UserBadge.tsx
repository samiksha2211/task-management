"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearAuth, getStoredUser, USER_CHANGED_EVENT } from "@/lib/api";
import { disconnectRealtime } from "@/lib/realtime";

export default function UserBadge() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const user = getStoredUser();
  const designation = user?.designation || user?.name || "User";
  const initial = designation.charAt(0).toUpperCase();

  useEffect(() => {
    window.addEventListener(USER_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(USER_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const toggle = () => setOpen((v) => !v);

  const handleLogout = () => {
    disconnectRealtime();
    clearAuth();
    router.push("/");
  };

  return (
    <div className="profile-wrap" ref={wrapRef}>
      <div
        className="profile"
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <div className="profile-avatar">
          {user?.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar} alt={designation} className="profile-avatar-img" />
          ) : (
            initial
          )}
        </div>
        <span className="profile-designation">{designation}</span>
      </div>

      {open && (
        <div className="profile-dropdown" role="menu">
          <div className="profile-dropdown-header">
            <span className="profile-dropdown-name">{designation}</span>
            {user?.email && (
              <span className="profile-dropdown-email">{user.email}</span>
            )}
          </div>

          <Link
            href="/settings"
            role="menuitem"
            className="profile-dropdown-item"
            onClick={() => setOpen(false)}
          >
            Profile
          </Link>

          <Link
            href="/settings"
            role="menuitem"
            className="profile-dropdown-item"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>

          <button
            type="button"
            role="menuitem"
            className="profile-dropdown-item profile-dropdown-logout"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}