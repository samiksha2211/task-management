"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  apiFetch,
  clearAuth,
  enableOfflineAccess,
  getOfflineUser,
  getToken,
  setToken,
  setUser,
  type ApiUser,
} from "@/lib/api";
import { startOfflineSync } from "@/lib/offline";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RE = /^(?=.*[a-zA-Z])(?=.*\d).{6,}$/;

function formatErrors(
  email: string,
  password: string,
  remember: boolean
): string | null {
  if (!email.trim()) return "Please fill all fields";
  if (!password) return "Please fill all fields";

  if (remember) {
    if (!EMAIL_RE.test(email.trim())) {
      return "Please enter a valid email address";
    }

    if (!PASSWORD_RE.test(password)) {
      return "Password must be at least 6 characters and include letters and numbers";
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

  const [isOffline, setIsOffline] = useState(false);
  const [offlineUser, setOfflineUser] = useState<ApiUser | null>(null);

  const submittingRef = useRef(false);
  const autoCheckRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const updateNetworkState = () => {
      const offline = !navigator.onLine;

      setIsOffline(offline);

      if (offline) {
        setOfflineUser(getOfflineUser());
      } else {
        setOfflineUser(null);
      }
    };

    updateNetworkState();

    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);

    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
  }, []);

  useEffect(() => {
    if (submittingRef.current) return;

    const checkedToken = getToken();

    if (!navigator.onLine) {
      const user = getOfflineUser();

      setIsOffline(true);
      setOfflineUser(user);

      return;
    }

    if (!checkedToken) return;

    const controller = new AbortController();
    autoCheckRef.current = controller;

    fetch("/api/auth/me", {
      headers: {
        Authorization: `Bearer ${checkedToken}`,
      },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          return null;
        }

        if (!res.ok) {
          return undefined;
        }

        const data = (await res.json()) as {
          user: ApiUser;
        };

        return data.user;
      })
      .then((user) => {
        if (controller.signal.aborted) return;

        if (getToken() !== checkedToken) return;

        if (user) {
          startOfflineSync();

          router.replace(
            user.role === "ADMIN" ? "/dashboard" : "/tasks"
          );
        } else if (user === null) {
          clearAuth();
        }
      })
      .catch(() => {
        // Network/server error: stay on login page.
      });

    return () => {
      controller.abort();

      if (autoCheckRef.current === controller) {
        autoCheckRef.current = null;
      }
    };
  }, [router]);

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    if (loading || submittingRef.current) return;

    const error = formatErrors(
      email,
      password,
      remember
    );

    if (error) {
      alert(error);
      return;
    }

    submittingRef.current = true;
    autoCheckRef.current?.abort();

    setLoading(true);

    try {
      const data = await apiFetch<{
        token: string;
        user: ApiUser;
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
        }),
      });

      setToken(data.token, remember);
      setUser(data.user, remember);

      enableOfflineAccess(data.user);

      startOfflineSync();

      router.push(
        data.user.role === "ADMIN"
          ? "/dashboard"
          : "/tasks"
      );
    } catch (err) {
      submittingRef.current = false;
      setLoading(false);

      alert(
        err instanceof Error
          ? err.message
          : "Login failed"
      );
    }
  };

  const handleContinueOffline = () => {
    const user = getOfflineUser();

    if (!user) {
      alert(
        "Please login online at least once before using offline mode."
      );
      return;
    }

    setUser(user, true);

    router.push(
      user.role === "ADMIN"
        ? "/dashboard"
        : "/tasks"
    );
  };

  return (
    <div className="login-container">
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
            onChange={(e) =>
              setEmail(e.target.value)
            }
          />

          <label>Password</label>

          <input
            type="password"
            placeholder="Enter Password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
          />

          <label className="remember-row">
            <input
              type="checkbox"
              className="remember-checkbox"
              checked={remember}
              onChange={(e) =>
                setRemember(e.target.checked)
              }
            />

            <span>Remember Me</span>
          </label>

          <div className="forgot">
            <Link href="/forgot-password">
              Forgot Password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Signing in..."
              : "Login"}
          </button>

          {isOffline && offlineUser && (
            <button
              type="button"
              onClick={handleContinueOffline}
              style={{
                marginTop: "10px",
              }}
            >
              Continue Offline
            </button>
          )}

          <div className="create-account-row">
            <span>
              Don&apos;t have an account?
            </span>

            <Link href="/register">
              Create Account
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}