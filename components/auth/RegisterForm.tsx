"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, setToken, setUser, type ApiUser } from "@/lib/api";
import DesignationAutocomplete from "@/components/DesignationAutocomplete";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [designation, setDesignation] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!email.trim() || !designation.trim() || !password) {
      alert("Please fill all fields");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      alert("Please enter a valid email address (e.g. name@domain.com)");
      return;
    }
    if (password.length < 6) {
      alert("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      alert("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const data = await apiFetch<{ token: string; user: ApiUser }>(
        "/api/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            email: email.trim(),
            designation: designation.trim(),
            password,
          }),
        }
      );
      setToken(data.token, true);
      setUser(data.user, true);
      router.push("/tasks");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Registration failed");
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

      <div className="login-card register-card">
        <h1>Create Account</h1>
        <p className="subtitle">Register as a new officer.</p>

        <form onSubmit={handleSubmit}>
          <label>Email</label>
          <input
            type="email"
            placeholder="Enter Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label>Designation</label>
          <DesignationAutocomplete
            value={designation}
            onChange={setDesignation}
            placeholder="Type to search designation"
          />

          <label>Password</label>
          <input
            type="password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <label>Confirm Password</label>
          <input
            type="password"
            placeholder="Repeat Password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          <button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create Account"}
          </button>

          <div className="create-account-row">
            <span>Already have an account?</span>
            <Link href="/">Sign In</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
