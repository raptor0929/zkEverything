"use client";

import { useChat } from "ai/react";
import { useEffect, useRef } from "react";

const SOLSCAN_PATTERN = /https:\/\/solscan\.io\/tx\/[A-Za-z0-9]+\?cluster=devnet/g;

function renderMessageContent(text: string) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  SOLSCAN_PATTERN.lastIndex = 0;
  while ((match = SOLSCAN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <a
        key={match.index}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "#9945ff", wordBreak: "break-all" }}
      >
        {match[0]}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

export function Chat() {
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat({ api: `${backendUrl}/api/chat` });

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        maxWidth: "680px",
        margin: "0 auto",
        padding: "0 12px",
        boxSizing: "border-box",
      }}
    >
      {/* header */}
      <div style={{ padding: "16px 0 8px", borderBottom: "1px solid #222" }}>
        <h1 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>
          GhostVault <span style={{ color: "#9945ff" }}>⬡</span>
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#888" }}>
          Private SOL transfers on Solana devnet
        </p>
      </div>

      {/* message list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 0",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {messages.map((m) => {
          const isUser = m.role === "user";
          return (
            <div
              key={m.id}
              style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "85%",
                  padding: "10px 14px",
                  borderRadius: "12px",
                  background: isUser ? "#9945ff" : "#1e1e1e",
                  color: "#f0f0f0",
                  fontSize: "0.9rem",
                  lineHeight: 1.5,
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                }}
              >
                {isUser ? m.content : renderMessageContent(m.content)}
              </div>
            </div>
          );
        })}

        {/* spinner */}
        {isLoading && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "12px",
                background: "#1e1e1e",
                color: "#888",
                fontSize: "0.85rem",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  animation: "pulse 1.2s ease-in-out infinite",
                }}
              >
                ···
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* input */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: "8px",
          padding: "12px 0 16px",
          borderTop: "1px solid #222",
        }}
      >
        <input
          value={input}
          onChange={handleInputChange}
          disabled={isLoading}
          placeholder="Enter a Solana address..."
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: "8px",
            border: "1px solid #333",
            background: "#1a1a1a",
            color: "#f0f0f0",
            fontSize: "0.9rem",
            outline: "none",
            opacity: isLoading ? 0.5 : 1,
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            padding: "10px 18px",
            borderRadius: "8px",
            border: "none",
            background: "#9945ff",
            color: "#fff",
            fontWeight: 600,
            fontSize: "0.9rem",
            cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
            opacity: isLoading || !input.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </form>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
