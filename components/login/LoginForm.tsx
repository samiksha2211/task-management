"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  apiFetch,
  clearAuth,
  getToken,
  setToken,
  setUser,
  type ApiUser,
} from "@/lib/api";
import { startOfflineSync } from "@/lib/offline";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RE = /^(?=.*[a-zA-Z])(?=.*\d).{6,}$/;

function formatErrors(email: string, password: string, remember: boolean): string | null {
  if (!email.trim()) return "Please fill all fields";
  if (!password) return "Please fill all fields";
  if (remember) {
    if (!EMAIL_RE.test(email.trim())) {
      return "Please enter a valid email address (e.g. name@domain.com)";
    }
    if (!PASSWORD_RE.test(password)) {
      return "Password must be at least 6 characters and include both letters and numbers";
    }
  }
  return null;
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const autoCheckRef = useRef<AbortController | null>(null);

  // Auto-login on return: if a (remembered) session already exists and is
  // still valid, go straight to the app instead of asking for credentials.
  // Uses a dedicated request (not apiFetch) so a stale/expired token can
  // never wipe a freshly created session via apiFetch's global 401 handler,
  // and ignores the response if the session changed while it was in flight.
  useEffect(() => {
    if (submittingRef.current) return;
    const checkedToken = getToken();
    if (!checkedToken) return;

    const controller = new AbortController();
    autoCheckRef.current = controller;

    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${checkedToken}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) return null;
        if (!res.ok) return undefined; // transient server error: leave it alone
        const data = (await res.json()) as { user: ApiUser };
        return data.user;
      })
      .then((user) => {
        if (controller.signal.aborted) return;
        if (getToken() !== checkedToken) return; // session changed mid-check
        if (user) {
          startOfflineSync();
          router.replace(user.role === "ADMIN" ? "/dashboard" : "/tasks");
        } else if (user === null) {
          // Token invalid/expired: drop it and stay on the login page.
          clearAuth();
        }
      })
      .catch(() => {
        // network error: stay on the login page
      });

    return () => {
      controller.abort();
      if (autoCheckRef.current === controller) autoCheckRef.current = null;
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading || submittingRef.current) return;

    const error = formatErrors(email, password, remember);
    if (error) {
      alert(error);
      return;
    }

    submittingRef.current = true;
    autoCheckRef.current?.abort();
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string; user: ApiUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token, remember);
      setUser(data.user, remember);
      startOfflineSync();
      router.push(data.user.role === "ADMIN" ? "/dashboard" : "/tasks");
    } catch (err) {
      submittingRef.current = false;
      setLoading(false);
      alert(err instanceof Error ? err.message : "Login failed");
    }
  };

  return (
    <div className="login-container">

      {/* Logo Card */}
      <div className="logo-card">
        <Image
          src="/logo.png"
          alt="RailWork Logo"
          width={220}
          height={80}
          priority
          style={{
            width: "220px",
            height: "auto",
          }}
        />
      </div>

      {/* Login Card */}
      <div className="login-card">

        <h1>Sign In</h1>

        <p className="subtitle">
          Railway Workforce Management System
        </p>

        <form onSubmit={handleSubmit}>

          <label>Email</label>

          <input
            type="email"
            placeholder="Enter Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label>Password</label>

          <input
            type="password"
            placeholder="Enter Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <label className="remember-row">
            <input
              type="checkbox"
              className="remember-checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Remember Me</span>
          </label>

          <div className="forgot">
            <Link href="/forgot-password">Forgot Password?</Link>
          </div>

          <button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Login"}
          </button>

          <div className="create-account-row">
            <span>Don&apos;t have an account?</span>
            <Link href="/register">Create Account</Link>
          </div>

        </form>

      </div>

    </div>
  );
}
