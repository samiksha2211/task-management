"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { resetPassword } from "@/lib/api";

export default function ResetPasswordForm({ initialToken }: { initialToken: string }) {
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!token.trim()) {
      setError("Missing reset token");
      return;
    }
    if (password.length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, password);
      setMessage("Password reset successfully. You can now sign in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
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
          style={{ width: "220px", height: "auto" }}
        />
      </div>

      <div className="login-card">
        <h1>Reset Password</h1>
        <p className="subtitle">Enter your new password below.</p>

        <form onSubmit={handleSubmit}>
          <label>Reset Token</label>
          <input
            type="text"
            placeholder="Paste your reset token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />

          <label>New Password</label>
          <input
            type="password"
            placeholder="Enter New Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <label>Confirm Password</label>
          <input
            type="password"
            placeholder="Confirm New Password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          {error && <p className="auth-msg auth-error">{error}</p>}
          {message && <p className="auth-msg auth-success">{message}</p>}

          <button type="submit" disabled={loading}>
            {loading ? "Resetting..." : "Reset Password"}
          </button>
        </form>

        <div className="forgot back-to-login">
          <Link href="/">Back to Sign In</Link>
        </div>
      </div>
    </div>
  );
}
