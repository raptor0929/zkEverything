import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "zkEverything",
  description: "Privacy-preserving SOL transfers on Solana devnet",
  icons: { icon: "/logo-black.png" },
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
