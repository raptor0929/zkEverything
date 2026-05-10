"use client";

import dynamic from "next/dynamic";

// AppRouter uses Supabase which requires browser globals — no SSR.
const AppRouter = dynamic(
  () => import("./AppRouter").then((m) => m.AppRouter),
  {
    ssr: false,
    loading: () => (
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
    ),
  }
);

export function ClientWrapper() {
  return <AppRouter />;
}
