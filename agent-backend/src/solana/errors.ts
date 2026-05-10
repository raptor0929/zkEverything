const ERROR_MAP: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /nullifier already spent/i,
    message:
      "This payment token has already been used. Please start a new transfer.",
  },
  {
    pattern: /relayer wallet low on funds/i,
    message:
      "The relayer is temporarily out of funds. Please try again shortly.",
  },
  {
    pattern: /invalid recipient pubkey/i,
    message:
      "That doesn't look like a valid Solana address. Please double-check and try again.",
  },
  {
    pattern:
      /timeout|etimedout|econnrefused|network error|socket hang up|fetch failed|connection refused/i,
    message: "Solana devnet is slow right now. Please try again in a moment.",
  },
];

const FALLBACK = "Something went wrong with your transfer. Please try again.";

export function mapError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  for (const { pattern, message } of ERROR_MAP) {
    if (pattern.test(msg)) return message;
  }
  return FALLBACK;
}
