"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { apiFetch } from "../lib/api";
import { LoginPage } from "./LoginPage";
import { CreateAgentPage } from "./CreateAgentPage";
import { Chat } from "./Chat";

type Screen = "loading" | "login" | "create-agent" | "chat";

async function checkAgent(token: string): Promise<"create-agent" | "chat"> {
  try {
    const res = await apiFetch("/api/agent", token);
    return res.status === 404 ? "create-agent" : "chat";
  } catch {
    return "create-agent";
  }
}

export function AppRouter() {
  const [screen, setScreen] = useState<Screen>("loading");

  useEffect(() => {
    // Check session on mount
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setScreen("login"); return; }
      setScreen(await checkAgent(session.access_token));
    });

    // React to login / logout without a page reload
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!session) { setScreen("login"); return; }
        setScreen(await checkAgent(session.access_token));
      }
    );

    return () => subscription.unsubscribe();
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
