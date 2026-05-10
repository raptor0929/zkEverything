"use client";

import { useState } from "react";
import Image from "next/image";
import { supabase } from "../lib/supabase";
import { apiFetch } from "../lib/api";

interface Props {
  onCreated: () => void;
}

export function CreateAgentPage({ onCreated }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError("Session expired. Please log in again.");
        setLoading(false);
        return;
      }
      const res = await apiFetch("/api/agent/create", session.access_token, {
        method: "POST",
      });
      if (!res.ok) {
        setError("Failed to create agent. Please try again.");
        setLoading(false);
        return;
      }
      onCreated();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
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
      <button onClick={handleCreate} disabled={loading} style={greenButton(loading)}>
        {loading ? "Creating…" : "Create Agent"}
      </button>
      {error && <p style={{ color: "#f87171", marginTop: 12, fontSize: "0.9rem" }}>{error}</p>}
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

function greenButton(disabled: boolean): React.CSSProperties {
  return {
    padding: "14px 32px",
    borderRadius: 12,
    border: "none",
    background: "#22c55e",
    color: "#fff",
    fontWeight: 700,
    fontSize: "1rem",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    letterSpacing: "0.02em",
  };
}
