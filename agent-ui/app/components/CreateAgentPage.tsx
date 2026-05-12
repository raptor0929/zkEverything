"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { supabase } from "../lib/supabase";
import { apiFetch } from "../lib/api";

interface Props {
  onCreated: () => void;
}

type LoadingStep = null | "keypair" | "funding";

const STEP_LABELS: Record<NonNullable<LoadingStep>, string> = {
  keypair: "Generating wallet keypair…",
  funding: "Funding wallet on-chain…",
};

export function CreateAgentPage({ onCreated }: Props) {
  const [loadingStep, setLoadingStep] = useState<LoadingStep>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (loadingStep === "keypair") {
      timer = setTimeout(() => setLoadingStep("funding"), 300);
    }
    return () => clearTimeout(timer);
  }, [loadingStep]);

  async function handleCreate() {
    setLoadingStep("keypair");
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError("Session expired. Please log in again.");
        setLoadingStep(null);
        return;
      }
      const res = await apiFetch("/api/agent/create", session.access_token, {
        method: "POST",
      });
      if (!res.ok) {
        setError("Failed to create agent. Please try again.");
        setLoadingStep(null);
        return;
      }
      onCreated();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoadingStep(null);
    }
  }

  const isLoading = loadingStep !== null;

  return (
    <div style={centeredLayout}>
      <button onClick={() => supabase.auth.signOut()} style={logoutBtnStyle}>
        Log out
      </button>
      <h1 style={heading}>zkEverything</h1>
      <Image
        src="/zkEverything.webp"
        alt="zkEverything mascot"
        width={180}
        height={180}
        style={{ marginBottom: 32 }}
      />
      <button onClick={handleCreate} disabled={isLoading} style={greenButton(isLoading)}>
        {isLoading ? (
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={spinnerStyle} />
            {STEP_LABELS[loadingStep!]}
          </span>
        ) : (
          "Create Agent"
        )}
      </button>
      {error && <p style={{ color: "#f87171", marginTop: 12, fontSize: "0.9rem" }}>{error}</p>}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
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
  paddingTop: 56,
  boxSizing: "border-box",
  position: "relative",
};

const logoutBtnStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  padding: "5px 12px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "transparent",
  color: "#888",
  fontSize: "0.78rem",
  cursor: "pointer",
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
    minWidth: 220,
  };
}

const spinnerStyle: React.CSSProperties = {
  display: "inline-block",
  width: 14,
  height: 14,
  border: "2px solid rgba(255,255,255,0.3)",
  borderTopColor: "#fff",
  borderRadius: "50%",
  animation: "spin 0.7s linear infinite",
  flexShrink: 0,
};
