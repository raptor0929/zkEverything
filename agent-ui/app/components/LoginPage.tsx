"use client";

import Image from "next/image";
import { supabase } from "../lib/supabase";

export function LoginPage() {
  async function handleLogin() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  return (
    <div style={centeredLayout}>
      <h1 style={heading}>zkEverything</h1>
      <Image
        src="/zkEverything.webp"
        alt="Ghost mascot"
        width={180}
        height={180}
        style={{ marginBottom: 32 }}
      />
      <button onClick={handleLogin} style={greenButton}>
        login with google
      </button>
    </div>
  );
}

const centeredLayout: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100dvh",
  gap: 16,
  padding: 24,
  boxSizing: "border-box",
};

const heading: React.CSSProperties = {
  margin: 0,
  fontSize: "2rem",
  fontWeight: 700,
  color: "#f0f0f0",
  marginBottom: 8,
};

const greenButton: React.CSSProperties = {
  padding: "14px 32px",
  borderRadius: 12,
  border: "none",
  background: "#22c55e",
  color: "#fff",
  fontWeight: 700,
  fontSize: "1rem",
  cursor: "pointer",
  letterSpacing: "0.02em",
};
