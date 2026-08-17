"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { forgotPassword } from "@/lib/api";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setResetLink(null);

    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }

    setLoading(true);
    try {
      const data = await forgotPassword(email);
      setMessage("A password reset link has been generated for your account.");
      setResetLink(data.resetLink);
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
        <h1>Forgot Password</h1>
        <p className="subtitle">
          Enter your email to generate a password reset link.
        </p>

        <form onSubmit={handleSubmit}>
          <label>Email</label>
          <input
            type="email"
            placeholder="Enter Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {error && <p className="auth-msg auth-error">{error}</p>}
          {message && <p className="auth-msg auth-success">{message}</p>}

          {resetLink && (
            <p className="auth-msg auth-link">
              Reset link: <a href={resetLink}>{resetLink}</a>
            </p>
          )}

          <button type="submit" disabled={loading}>
            {loading ? "Generating..." : "Generate Reset Link"}
          </button>
        </form>

        <div className="forgot back-to-login">
          <Link href="/">Back to Sign In</Link>
        </div>
      </div>
    </div>
  );
}
