import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GhostVault Agent",
  description: "Send 0.01 SOL privately on Solana devnet",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "sans-serif", background: "#0f0f0f", color: "#f0f0f0" }}>
        {children}
      </body>
    </html>
  );
}
