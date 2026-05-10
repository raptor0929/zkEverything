import { mapError } from "./errors";

describe("mapError", () => {
  it("maps nullifier already spent", () => {
    expect(mapError(new Error("Nullifier already spent"))).toBe(
      "This payment token has already been used. Please start a new transfer."
    );
  });

  it("maps nullifier error case-insensitively", () => {
    expect(mapError(new Error("nullifier already spent — tx rejected"))).toBe(
      "This payment token has already been used. Please start a new transfer."
    );
  });

  it("maps relayer wallet low on funds", () => {
    expect(mapError(new Error("Relayer wallet low on funds"))).toBe(
      "The relayer is temporarily out of funds. Please try again shortly."
    );
  });

  it("maps invalid recipient pubkey", () => {
    expect(mapError(new Error("Invalid recipient pubkey"))).toBe(
      "That doesn't look like a valid Solana address. Please double-check and try again."
    );
  });

  it("maps ETIMEDOUT to devnet-slow message", () => {
    expect(mapError(new Error("ETIMEDOUT connecting to RPC"))).toBe(
      "Solana devnet is slow right now. Please try again in a moment."
    );
  });

  it("maps timeout to devnet-slow message", () => {
    expect(mapError(new Error("request timeout after 30s"))).toBe(
      "Solana devnet is slow right now. Please try again in a moment."
    );
  });

  it("maps fetch failed to devnet-slow message", () => {
    expect(mapError(new Error("fetch failed"))).toBe(
      "Solana devnet is slow right now. Please try again in a moment."
    );
  });

  it("maps ECONNREFUSED to devnet-slow message", () => {
    expect(mapError(new Error("ECONNREFUSED 127.0.0.1:8899"))).toBe(
      "Solana devnet is slow right now. Please try again in a moment."
    );
  });

  it("returns fallback for unrecognised errors", () => {
    expect(mapError(new Error("something totally unexpected happened"))).toBe(
      "Something went wrong with your transfer. Please try again."
    );
  });

  it("handles non-Error values (string)", () => {
    expect(mapError("Nullifier already spent")).toBe(
      "This payment token has already been used. Please start a new transfer."
    );
  });

  it("handles non-Error values (plain object)", () => {
    expect(mapError({ code: 999 })).toBe(
      "Something went wrong with your transfer. Please try again."
    );
  });
});
