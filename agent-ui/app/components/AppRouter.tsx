"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { apiFetch } from "../lib/api";
import { LoginPage } from "./LoginPage";
import { CreateAgentPage } from "./CreateAgentPage";
import { Chat } from "./Chat";

type Screen = "loading" | "login" | "create-agent" | "chat";

export function AppRouter() {
  const [screen, setScreen] = useState<Screen>("loading");

  useEffect(() => {
    async function bootstrap() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setScreen("login");
        return;
      }

      try {
        const res = await apiFetch("/api/agent", session.access_token);
        if (res.status === 404) {
          setScreen("create-agent");
        } else {
          setScreen("chat");
        }
      } catch {
        setScreen("create-agent");
      }
    }

    bootstrap();
  }, []);

  if (screen === "loading") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100dvh",
          color: "#888",
          fontSize: "0.9rem",
        }}
      >
        …
      </div>
    );
  }

  if (screen === "login") return <LoginPage />;
  if (screen === "create-agent") {
    return <CreateAgentPage onCreated={() => setScreen("chat")} />;
  }
  return <Chat />;
}
