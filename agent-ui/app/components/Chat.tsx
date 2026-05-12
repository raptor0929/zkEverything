"use client";

import { useChat } from "ai/react";
import type { Message } from "ai";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
const FUND_AMOUNT = 10_000_000; // 0.01 SOL in lamports

// ─── Step derivation ────────────────────────────────────────────────────────

type Step =
  | { type: "idle" }
  | { type: "collect_destination" }
  | { type: "show_funding_address"; agentPubkey: string; amountSol: number }
  | { type: "processing" }
  | { type: "done"; signature: string }
  | { type: "error" };

function deriveStep(messages: Message[]): Step {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const invs = (msg.toolInvocations ?? []) as Array<{
      toolName: string;
      state: string;
      result?: unknown;
    }>;
    for (let j = invs.length - 1; j >= 0; j--) {
      const inv = invs[j];
      if (inv.toolName === "payment_complete" && inv.state === "result") {
        return { type: "done", signature: (inv.result as { signature: string }).signature };
      }
      if (inv.toolName === "send_private_payment") {
        if (inv.state === "result") {
          const r = inv.result as { signature?: string; error?: string };
          if (r.error) return { type: "error" };
          return { type: "done", signature: r.signature! };
        }
        return { type: "processing" };
      }
      if (inv.toolName === "show_funding_address" && inv.state === "result") {
        const r = inv.result as { agentPubkey: string; amountSol: number };
        return { type: "show_funding_address", agentPubkey: r.agentPubkey, amountSol: r.amountSol };
      }
      if (inv.toolName === "collect_destination" && inv.state === "result") {
        return { type: "collect_destination" };
      }
    }
  }
  return { type: "idle" };
}

// ─── Clipboard helper ────────────────────────────────────────────────────────

function copyText(text: string) {
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  } else {
    legacyCopy(text);
  }
}
function legacyCopy(text: string) {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText = "position:fixed;opacity:0;top:0;left:0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

// ─── Authenticated fetch for useChat ─────────────────────────────────────────
// Called by useChat on every POST — grabs the JWT fresh so there's no race
// condition between session load and the first user message.

async function authedFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> ?? {}),
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function Chat() {
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baselineRef = useRef<number | null>(null);
  const detectedRef = useRef(false);

  const { messages, input, handleInputChange, handleSubmit, isLoading, append, setMessages } =
    useChat({ api: `${BACKEND}/api/chat`, fetch: authedFetch });

  const appendRef = useRef(append);
  useEffect(() => { appendRef.current = append; }, [append]);

  const step = deriveStep(messages);

  // Poll for incoming funds — snapshot baseline first, trigger on delta >= 0.01 SOL
  useEffect(() => {
    if (step.type !== "show_funding_address") {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      baselineRef.current = null;
      detectedRef.current = false;
      return;
    }
    if (pollingRef.current) return;

    detectedRef.current = false;

    async function getBalance(): Promise<number | null> {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return null;
        const res = await fetch(`${BACKEND}/api/agent/balance`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return null;
        const { lamports } = (await res.json()) as { lamports: number };
        return lamports;
      } catch { return null; }
    }

    // Snapshot current balance before starting to poll
    getBalance().then((bal) => { baselineRef.current = bal ?? 0; });

    pollingRef.current = setInterval(async () => {
      if (detectedRef.current) return;
      const bal = await getBalance();
      if (bal === null || baselineRef.current === null) return;
      if (bal >= baselineRef.current + FUND_AMOUNT) {
        detectedRef.current = true;
        clearInterval(pollingRef.current!);
        pollingRef.current = null;
        appendRef.current({ role: "user", content: "funds received" });
      }
    }, 2000);

    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };
  }, [step.type]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCancel = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    setMessages([]);
  }, [setMessages]);

  const handleCopy = useCallback((text: string) => {
    copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const inputDisabled = isLoading || step.type === "processing";
  const showCancel = messages.length > 0 && step.type !== "processing" && step.type !== "done" && step.type !== "show_funding_address" && !isLoading;
  const showInput = step.type !== "processing" && step.type !== "done" && step.type !== "show_funding_address";
  const isIdle = messages.length === 0 && !isLoading;

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: "1rem" }}>zkEverything</span>
          <span style={{ fontSize: "0.75rem", color: "#888" }}>Private SOL · devnet</span>
        </div>
        <button onClick={() => supabase.auth.signOut()} style={logoutBtnStyle}>
          Log out
        </button>
      </div>

      {/* Message list */}
      <div style={messageListStyle}>
        {/* Suggestion chip — centered when idle */}
        {isIdle && (
          <div style={idleOverlayStyle}>
            <button
              onClick={() => append({ role: "user", content: "I want to create a new transaction" })}
              style={chipStyle}
            >
              I want to create a new transaction
            </button>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} style={rowStyle("right")}>
                <div style={bubbleStyle("blue")}>{msg.content}</div>
              </div>
            );
          }
          if (msg.role === "assistant") {
            const invs = (msg.toolInvocations ?? []) as Array<{
              toolName: string; state: string; result?: unknown;
            }>;
            return (
              <div key={msg.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {msg.content && (
                  <div style={rowStyle("left")}>
                    <div style={bubbleStyle("white")}>{msg.content}</div>
                  </div>
                )}
                {invs.map((inv, i) => (
                  <ToolUI
                    key={i}
                    inv={inv}
                    copied={copied}
                    onCopy={handleCopy}
                  />
                ))}
              </div>
            );
          }
          return null;
        })}

        {isLoading && step.type !== "processing" && (
          <div style={rowStyle("left")}>
            <div style={{ ...bubbleStyle("white"), color: "#888" }}>
              <span style={spinnerStyle}>···</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Bottom area */}
      <div style={bottomAreaStyle}>
        {step.type === "show_funding_address" && !isLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={waitingPillStyle}>
              <span style={spinnerStyle}>···</span>&ensp;Waiting for deposit…
            </div>
            <button type="button" onClick={handleCancel} style={cancelBtnStyle}>✕</button>
          </div>
        )}

        {step.type === "processing" && (
          <div style={processingPillStyle}>
            <span style={spinnerStyle}>···</span>&ensp;Processing
          </div>
        )}

        {step.type === "done" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "12px 0" }}>
            <div style={donePillStyle}>Done ✓</div>
            <a
              href={`https://solscan.io/tx/${step.signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#22c55e", fontSize: "0.8rem", wordBreak: "break-all", textAlign: "center" }}
            >
              View on Solscan ↗
            </a>
          </div>
        )}

        {showInput && (
          <form onSubmit={handleSubmit} style={inputRowStyle}>
            <input
              value={input}
              onChange={handleInputChange}
              disabled={inputDisabled}
              placeholder={
                step.type === "collect_destination" ? "Paste Solana address…" : "Type a message…"
              }
              style={inputStyle(inputDisabled)}
            />
            {showCancel && (
              <button type="button" onClick={handleCancel} style={cancelBtnStyle}>
                ✕
              </button>
            )}
            <button
              type="submit"
              disabled={inputDisabled || !input.trim()}
              style={sendBtnStyle(inputDisabled || !input.trim())}
            >
              Send
            </button>
          </form>
        )}
      </div>

      {/* Ghost footer — always visible */}
      <div style={ghostFooterStyle}>
        <Image
          src="/zkEverything.webp"
          alt="zkEverything ghost"
          width={48}
          height={48}
          style={{ opacity: 0.35 }}
        />
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }
        * { box-sizing: border-box; }
        input { -webkit-appearance: none; }
      `}</style>
    </div>
  );
}

// ─── Tool UI ─────────────────────────────────────────────────────────────────

function ToolUI({ inv, copied, onCopy }: {
  inv: { toolName: string; state: string; result?: unknown };
  copied: boolean;
  onCopy: (text: string) => void;
}) {
  const [addressRevealed, setAddressRevealed] = useState(false);

  if (inv.toolName === "collect_destination" && inv.state === "result") {
    return (
      <div style={rowStyle("left")}>
        <div style={bubbleStyle("yellow")}>write your destination address</div>
      </div>
    );
  }
  if (inv.toolName === "show_funding_address" && inv.state === "result") {
    const r = inv.result as { agentPubkey: string; amountSol: number };
    if (!addressRevealed) {
      return (
        <div style={rowStyle("left")}>
          <button onClick={() => setAddressRevealed(true)} style={amountBtnStyle}>
            {r.amountSol} SOL
          </button>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={rowStyle("left")}>
          <div style={bubbleStyle("green")}>{r.amountSol} SOL</div>
        </div>
        <div style={rowStyle("left")}>
          <div style={{ ...bubbleStyle("blue"), display: "flex", flexDirection: "column", gap: 6, fontSize: "0.78rem" }}>
            <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.72rem" }}>Send the funds to the wallet of the agent:</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "monospace" }}>
              <span style={{ flex: 1, wordBreak: "break-all" }}>{r.agentPubkey}</span>
              <button onClick={() => onCopy(r.agentPubkey)} title="Copy" style={copyBtnStyle}>
                {copied ? "✓" : "⧉"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100dvh",
  width: "100%",
  maxWidth: 600,
  margin: "0 auto",
  overflowX: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 16px 10px",
  borderBottom: "1px solid #222",
  flexShrink: 0,
};

const logoutBtnStyle: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "transparent",
  color: "#888",
  fontSize: "0.78rem",
  cursor: "pointer",
};

const messageListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "0 12px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  paddingTop: 12,
  paddingBottom: 8,
};

const idleOverlayStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  paddingTop: 48,
  paddingBottom: 24,
  gap: 4,
};

const bottomAreaStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "10px 12px 20px",
  borderTop: "1px solid #222",
};

function rowStyle(align: "left" | "right"): React.CSSProperties {
  return {
    display: "flex",
    justifyContent: align === "right" ? "flex-end" : "flex-start",
  };
}

function bubbleStyle(color: "white" | "blue" | "yellow" | "green"): React.CSSProperties {
  const map = {
    white:  { background: "#1e1e1e", color: "#f0f0f0" },
    blue:   { background: "#2563eb", color: "#fff" },
    yellow: { background: "#fbbf24", color: "#1a1a1a" },
    green:  { background: "#22c55e", color: "#fff" },
  };
  return {
    maxWidth: "88%",
    padding: "10px 14px",
    borderRadius: 14,
    fontSize: "0.92rem",
    lineHeight: 1.5,
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
    ...map[color],
  };
}

const chipStyle: React.CSSProperties = {
  padding: "13px 22px",
  borderRadius: 24,
  border: "none",
  background: "#22c55e",
  color: "#fff",
  fontWeight: 700,
  fontSize: "0.95rem",
  cursor: "pointer",
  marginTop: 8,
  touchAction: "manipulation",
};

const inputRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

function inputStyle(disabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "13px 14px",
    borderRadius: 12,
    border: "1px solid #333",
    background: "#1a1a1a",
    color: "#f0f0f0",
    fontSize: "1rem",
    outline: "none",
    opacity: disabled ? 0.5 : 1,
    minWidth: 0,
    WebkitAppearance: "none",
  };
}

function sendBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "13px 18px",
    borderRadius: 12,
    border: "none",
    background: "#9945ff",
    color: "#fff",
    fontWeight: 700,
    fontSize: "0.95rem",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  };
}

const cancelBtnStyle: React.CSSProperties = {
  padding: "13px 14px",
  borderRadius: 12,
  border: "none",
  background: "#ef4444",
  color: "#fff",
  fontWeight: 700,
  fontSize: "0.95rem",
  cursor: "pointer",
  touchAction: "manipulation",
  whiteSpace: "nowrap",
};

const processingPillStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "14px 0",
  color: "#fbbf24",
  fontWeight: 600,
  fontSize: "0.95rem",
};

const donePillStyle: React.CSSProperties = {
  padding: "12px 28px",
  borderRadius: 24,
  background: "#22c55e",
  color: "#fff",
  fontWeight: 700,
  fontSize: "1rem",
};

const amountBtnStyle: React.CSSProperties = {
  padding: "14px 28px",
  borderRadius: 16,
  border: "none",
  background: "#22c55e",
  color: "#fff",
  fontWeight: 700,
  fontSize: "1.1rem",
  cursor: "pointer",
  touchAction: "manipulation",
  letterSpacing: "0.02em",
};

const waitingPillStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "13px 0",
  color: "#888",
  fontSize: "0.9rem",
};

const copyBtnStyle: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.3)",
  background: "transparent",
  color: "#fff",
  fontSize: "0.85rem",
  cursor: "pointer",
  flexShrink: 0,
  touchAction: "manipulation",
};

const spinnerStyle: React.CSSProperties = {
  display: "inline-block",
  animation: "pulse 1.2s ease-in-out infinite",
};

const ghostFooterStyle: React.CSSProperties = {
  flexShrink: 0,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  paddingBottom: 12,
};
