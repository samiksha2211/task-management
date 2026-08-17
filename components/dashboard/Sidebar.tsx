"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  FaHome,
  FaTasks,
  FaUsers,
  FaChartBar,
  FaTrashAlt,
  FaCog,
  FaSignOutAlt,
  FaTrain,
  FaBars,
  FaTimes,
} from "react-icons/fa";
import { clearAuth, getStoredUser } from "@/lib/api";
import { disconnectRealtime } from "@/lib/realtime";
import OfflineBanner from "@/components/OfflineBanner";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = getStoredUser();
  const isAdmin = user?.role === "ADMIN";
  const [open, setOpen] = useState(false);

  const handleLogout = () => {
    setOpen(false);
    disconnectRealtime();
    clearAuth();
    router.push("/");
  };

  return (
    <>
      <OfflineBanner />
      <button
        type="button"
        className="sidebar-toggle"
        aria-label="Open navigation menu"
        onClick={() => setOpen((v) => !v)}
      >
        <FaBars />
      </button>

      <div
        className={`sidebar-backdrop ${open ? "open" : ""}`}
        onClick={() => setOpen(false)}
      />

      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div>
          {/* Logo */}
          <div className="sidebar-logo">
            <FaTrain className="logo-icon" />
            <span>RailWork</span>
            <button
              type="button"
              className="sidebar-close"
              aria-label="Close navigation menu"
              onClick={() => setOpen(false)}
            >
              <FaTimes />
            </button>
          </div>

          {/* Navigation */}
          <nav className="sidebar-menu" onClick={() => setOpen(false)}>
            {isAdmin && (
              <Link
                href="/dashboard"
                className={pathname === "/dashboard" ? "active" : ""}
              >
                <FaHome />
                <span>Dashboard</span>
              </Link>
            )}

            <Link
              href="/tasks"
              className={pathname === "/tasks" ? "active" : ""}
            >
              <FaTasks />
              <span>Tasks</span>
            </Link>

            {isAdmin && (
              <Link
                href="/officers"
                className={pathname === "/officers" ? "active" : ""}
              >
                <FaUsers />
                <span>Designation</span>
              </Link>
            )}

            {isAdmin && (
              <Link
                href="/reports"
                className={pathname === "/reports" ? "active" : ""}
              >
                <FaChartBar />
                <span>Reports</span>
              </Link>
            )}

            {isAdmin && (
              <Link
                href="/recycle-bin"
                className={pathname === "/recycle-bin" ? "active" : ""}
              >
                <FaTrashAlt />
                <span>Recycle Bin</span>
              </Link>
            )}

            <Link
              href="/settings"
              className={pathname === "/settings" ? "active" : ""}
            >
              <FaCog />
              <span>Settings</span>
            </Link>

            <button className="sidebar-logout" onClick={handleLogout}>
              <FaSignOutAlt />
              <span>Logout</span>
            </button>
          </nav>
        </div>

        <div className="sidebar-footer">
          <FaTrain className="footer-train" />
          <span>RailWork v1.0</span>
        </div>
      </aside>
    </>
  );
}
