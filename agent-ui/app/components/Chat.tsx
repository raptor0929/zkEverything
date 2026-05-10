"use client";

import { useChat } from "ai/react";
import type { Message } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
const FUND_THRESHOLD = 10_000_000; // 0.01 SOL in lamports

// ─── Step derivation ────────────────────────────────────────────────────────

type Step =
  | { type: "idle" }
  | { type: "collect_destination" }
  | { type: "collect_amount" }
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
        return {
          type: "done",
          signature: (inv.result as { signature: string }).signature,
        };
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
        return {
          type: "show_funding_address",
          agentPubkey: r.agentPubkey,
          amountSol: r.amountSol,
        };
      }
      if (inv.toolName === "collect_amount" && inv.state === "result") {
        return { type: "collect_amount" };
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
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function Chat() {
  const [authHeaders, setAuthHeaders] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fundedRef = useRef(false);

  const { messages, input, handleInputChange, handleSubmit, isLoading, append, setMessages } =
    useChat({ api: `${BACKEND}/api/chat`, headers: authHeaders });

  // Keep a stable ref to append for use inside intervals
  const appendRef = useRef(append);
  useEffect(() => {
    appendRef.current = append;
  }, [append]);

  const step = deriveStep(messages);

  // Load JWT once on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setAuthHeaders({ Authorization: `Bearer ${session.access_token}` });
      }
    });
  }, []);

  // Balance polling — active only during show_funding_address step
  useEffect(() => {
    if (step.type !== "show_funding_address") {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      fundedRef.current = false;
      return;
    }

    if (pollingRef.current) return; // already polling

    fundedRef.current = false;
    pollingRef.current = setInterval(async () => {
      if (fundedRef.current) return;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`${BACKEND}/api/agent/balance`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const { lamports } = (await res.json()) as { lamports: number };
        if (lamports >= FUND_THRESHOLD) {
          fundedRef.current = true;
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          appendRef.current({ role: "user", content: "funds received" });
        }
      } catch {
        // network error — retry next tick
      }
    }, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [step.type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCancel = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    fundedRef.current = false;
    setMessages([]);
  }, [setMessages]);

  const handleAmountSelect = useCallback(
    (label: string) => {
      append({ role: "user", content: label });
    },
    [append]
  );

  const handleCopy = useCallback((text: string) => {
    copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const inputDisabled =
    isLoading || step.type === "show_funding_address" || step.type === "processing";

  const showCancel =
    messages.length > 0 &&
    step.type !== "processing" &&
    step.type !== "done" &&
    !isLoading;

  const showInput = step.type !== "processing" && step.type !== "done";

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h1 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
          zkEverything
        </h1>
        <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#888" }}>
          Private SOL transfers · Solana devnet
        </p>
      </div>

      {/* Message list */}
      <div style={messageListStyle}>
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
              toolName: string;
              state: string;
              result?: unknown;
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
                    step={step}
                    isLoading={isLoading}
                    copied={copied}
                    onAmountSelect={handleAmountSelect}
                    onCopy={handleCopy}
                  />
                ))}
              </div>
            );
          }

          return null;
        })}

        {/* Loading spinner */}
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
        {/* Suggestion chip — only when no messages */}
        {messages.length === 0 && !isLoading && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <button
              onClick={() => append({ role: "user", content: "I want to create a new transaction" })}
              style={chipStyle}
            >
              I want to create a new transaction
            </button>
          </div>
        )}

        {/* Processing pill */}
        {step.type === "processing" && (
          <div style={processingPillStyle}>
            <span style={spinnerStyle}>···</span>&nbsp; Processing
          </div>
        )}

        {/* Done state */}
        {step.type === "done" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "12px 0 16px" }}>
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

        {/* Input form */}
        {showInput && (
          <form onSubmit={handleSubmit} style={inputRowStyle}>
            <input
              value={input}
              onChange={handleInputChange}
              disabled={inputDisabled}
              placeholder={
                step.type === "show_funding_address"
                  ? "Waiting for funds…"
                  : step.type === "collect_destination"
                  ? "Paste Solana address…"
                  : "Type a message…"
              }
              style={inputStyle(inputDisabled)}
            />
            {showCancel && (
              <button type="button" onClick={handleCancel} style={cancelBtnStyle}>
                Cancel
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

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
      `}</style>
    </div>
  );
}

// ─── Tool invocation renderer ────────────────────────────────────────────────

function ToolUI({
  inv,
  step,
  isLoading,
  copied,
  onAmountSelect,
  onCopy,
}: {
  inv: { toolName: string; state: string; result?: unknown };
  step: Step;
  isLoading: boolean;
  copied: boolean;
  onAmountSelect: (label: string) => void;
  onCopy: (text: string) => void;
}) {
  if (inv.toolName === "collect_destination" && inv.state === "result") {
    return (
      <div style={rowStyle("left")}>
        <div style={bubbleStyle("yellow")}>write your destination address</div>
      </div>
    );
  }

  if (inv.toolName === "collect_amount" && inv.state === "result") {
    const active = step.type === "collect_amount" && !isLoading;
    return (
      <div style={rowStyle("left")}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["1 SOL", "0.1 SOL", "0.01 SOL"].map((label) => (
            <button
              key={label}
              disabled={!active}
              onClick={() => active && onAmountSelect(label)}
              style={amountBtnStyle(!active)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (inv.toolName === "show_funding_address" && inv.state === "result") {
    const r = inv.result as { agentPubkey: string; amountSol: number };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={rowStyle("left")}>
          <div style={bubbleStyle("yellow")}>
            Fund me here · sending {r.amountSol} SOL
          </div>
        </div>
        <div style={rowStyle("left")}>
          <div
            style={{
              ...bubbleStyle("blue"),
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "monospace",
              fontSize: "0.8rem",
              wordBreak: "break-all",
            }}
          >
            <span style={{ flex: 1 }}>{r.agentPubkey}</span>
            <button
              onClick={() => onCopy(r.agentPubkey)}
              title="Copy address"
              style={copyBtnStyle}
            >
              {copied ? "✓" : "⧉"}
            </button>
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
  maxWidth: 680,
  margin: "0 auto",
  padding: "0 12px",
  boxSizing: "border-box",
  overflowX: "hidden",
};

const headerStyle: React.CSSProperties = {
  padding: "14px 0 10px",
  borderBottom: "1px solid #222",
  flexShrink: 0,
};

const messageListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "16px 0",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const bottomAreaStyle: React.CSSProperties = {
  flexShrink: 0,
  paddingBottom: 16,
  borderTop: "1px solid #222",
  paddingTop: 10,
};

function rowStyle(align: "left" | "right"): React.CSSProperties {
  return {
    display: "flex",
    justifyContent: align === "right" ? "flex-end" : "flex-start",
  };
}

function bubbleStyle(color: "white" | "blue" | "yellow"): React.CSSProperties {
  const map = {
    white: { background: "#1e1e1e", color: "#f0f0f0" },
    blue: { background: "#2563eb", color: "#fff" },
    yellow: { background: "#fbbf24", color: "#1a1a1a" },
  };
  return {
    maxWidth: "85%",
    padding: "10px 14px",
    borderRadius: 12,
    fontSize: "0.9rem",
    lineHeight: 1.5,
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
    ...map[color],
  };
}

const chipStyle: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 20,
  border: "none",
  background: "#22c55e",
  color: "#fff",
  fontWeight: 600,
  fontSize: "0.9rem",
  cursor: "pointer",
};

const inputRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

function inputStyle(disabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #333",
    background: "#1a1a1a",
    color: "#f0f0f0",
    fontSize: "0.9rem",
    outline: "none",
    opacity: disabled ? 0.5 : 1,
    minWidth: 0,
  };
}

function sendBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 16px",
    borderRadius: 8,
    border: "none",
    background: "#9945ff",
    color: "#fff",
    fontWeight: 700,
    fontSize: "0.9rem",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
  };
}

const cancelBtnStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "none",
  background: "#ef4444",
  color: "#fff",
  fontWeight: 600,
  fontSize: "0.9rem",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function amountBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    background: "#fbbf24",
    color: "#1a1a1a",
    fontWeight: 700,
    fontSize: "0.9rem",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

const processingPillStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 0 16px",
  color: "#fbbf24",
  fontWeight: 600,
  fontSize: "0.9rem",
};

const donePillStyle: React.CSSProperties = {
  padding: "10px 24px",
  borderRadius: 20,
  background: "#22c55e",
  color: "#fff",
  fontWeight: 700,
  fontSize: "1rem",
};

const copyBtnStyle: React.CSSProperties = {
  padding: "2px 6px",
  borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.3)",
  background: "transparent",
  color: "#fff",
  fontSize: "0.8rem",
  cursor: "pointer",
  flexShrink: 0,
};

const spinnerStyle: React.CSSProperties = {
  display: "inline-block",
  animation: "pulse 1.2s ease-in-out infinite",
};
