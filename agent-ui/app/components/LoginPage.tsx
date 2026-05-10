"use client";

import Image from "next/image";
import { useState } from "react";
import { supabase } from "../lib/supabase";

type Mode = "login" | "register";

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    if (mode === "register") {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      // Record the user in zkUsers (best-effort — requires INSERT policy or disabled RLS)
      if (data.user) {
        await supabase
          .from("zkUsers")
          .upsert({ id: data.user.id, email: data.user.email })
          .then(() => {});
      }

      // Supabase may require email confirmation depending on project settings.
      // If the session is already set, AppRouter will pick it up on next render.
      if (!data.session) {
        setInfo("Check your email to confirm your account, then log in.");
        setLoading(false);
        return;
      }
      // session set — AppRouter's getSession() will re-evaluate on next render
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }
    }

    // Auth state change triggers AppRouter to re-check session and navigate forward.
    setLoading(false);
  }

  return (
    <div style={centeredLayout}>
      <h1 style={heading}>zkEverything</h1>
      <Image
        src="/zkEverything.webp"
        alt="Ghost mascot"
        width={160}
        height={160}
        style={{ marginBottom: 16 }}
      />

      {/* Mode toggle */}
      <div style={toggleRow}>
        <button
          onClick={() => { setMode("login"); setError(null); setInfo(null); }}
          style={toggleBtn(mode === "login")}
        >
          Log in
        </button>
        <button
          onClick={() => { setMode("register"); setError(null); setInfo(null); }}
          style={toggleBtn(mode === "register")}
        >
          Register
        </button>
      </div>

      <form onSubmit={handleSubmit} style={formStyle}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
          autoComplete="email"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          style={inputStyle}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
        />
        <button type="submit" disabled={loading} style={submitBtn(loading)}>
          {loading ? "…" : mode === "register" ? "Create account" : "Log in"}
        </button>
      </form>

      {error && <p style={errorStyle}>{error}</p>}
      {info && <p style={infoStyle}>{info}</p>}
    </div>
  );
}

const centeredLayout: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100dvh",
  gap: 12,
  padding: 24,
  boxSizing: "border-box",
};

const heading: React.CSSProperties = {
  margin: 0,
  fontSize: "2rem",
  fontWeight: 700,
  color: "#f0f0f0",
  marginBottom: 4,
};

const toggleRow: React.CSSProperties = {
  display: "flex",
  borderRadius: 10,
  overflow: "hidden",
  border: "1px solid #333",
};

function toggleBtn(active: boolean): React.CSSProperties {
  return {
    padding: "8px 24px",
    border: "none",
    background: active ? "#22c55e" : "transparent",
    color: active ? "#fff" : "#888",
    fontWeight: 600,
    fontSize: "0.9rem",
    cursor: "pointer",
    transition: "background 0.15s",
  };
}

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  width: "100%",
  maxWidth: 320,
};

const inputStyle: React.CSSProperties = {
  padding: "11px 14px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "#1a1a1a",
  color: "#f0f0f0",
  fontSize: "0.95rem",
  outline: "none",
};

function submitBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "12px",
    borderRadius: 8,
    border: "none",
    background: "#22c55e",
    color: "#fff",
    fontWeight: 700,
    fontSize: "1rem",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    marginTop: 4,
  };
}

const errorStyle: React.CSSProperties = {
  color: "#f87171",
  fontSize: "0.85rem",
  textAlign: "center",
  maxWidth: 320,
  margin: 0,
};

const infoStyle: React.CSSProperties = {
  color: "#fbbf24",
  fontSize: "0.85rem",
  textAlign: "center",
  maxWidth: 320,
  margin: 0,
};
