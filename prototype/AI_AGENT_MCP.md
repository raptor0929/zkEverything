# GhostVault — AI Agent Integration via Secure MCP

## Concept

An AI agent (e.g. a Claude-based assistant) can orchestrate private SOL transfers on behalf of a user through a **Model Context Protocol (MCP) server** that wraps the GhostVault program. The MCP server acts as a secure boundary: it exposes only high-level tools to the agent while keeping private keys, blinding factors, and signing operations inside a trusted process the agent cannot read.

```
┌─────────────────────────────────────────────────────────┐
│                        User                             │
│   "Send 0.01 SOL privately to wallet X"                 │
└──────────────────────────┬──────────────────────────────┘
                           │ natural language
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    AI Agent (LLM)                       │
│   Reads tool schemas, plans steps, calls MCP tools      │
│   Never sees private keys, blinding factors, or seeds   │
└──────────────────────────┬──────────────────────────────┘
                           │ MCP tool calls (JSON-RPC 2.0)
                           ▼
┌─────────────────────────────────────────────────────────┐
│              GhostVault MCP Server                      │
│                                                         │
│  • Key vault (HSM / encrypted store)                    │
│  • Token secret derivation                              │
│  • BLS blinding / unblinding                            │
│  • Transaction building + simulation                    │
│  • Human-in-the-loop approval gate                      │
│  • Audit log                                            │
└──────────────────────────┬──────────────────────────────┘
                           │ Solana RPC + signed txns
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Solana Devnet / Mainnet                     │
│   GhostVault program 786pocjFvsLKLL4Ly5cYm2e5qsT4GMBvK21Cx97PWK1o  │
└─────────────────────────────────────────────────────────┘
```

---

## Security Boundary Design

The MCP server is the only process that touches sensitive material. The AI agent works entirely through opaque handles.

| What the agent receives | What stays inside the MCP server |
|---|---|
| `token_handle` (opaque UUID) | master seed, token index |
| `deposit_id` (20-byte hex) | blinding factor `r`, spend private key |
| Transaction signature (base58) | wallet keypair, BLS mint secret key |
| Status strings | all intermediate crypto values |

This means a compromised or misbehaving agent cannot extract funds or de-anonymize transfers — it can only request actions that the server validates and the user approves.

---

## MCP Tool Definitions

Each tool is exposed via the MCP `tools/list` endpoint. Below are the schemas and the server-side logic they trigger.

### `ghost_derive_token`

Creates a fresh token secret pair for one deposit and returns an opaque handle.

```json
{
  "name": "ghost_derive_token",
  "description": "Derives a one-time token from the vault's master seed. Returns an opaque handle used in subsequent steps. Never exposes private material.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Server logic:**
1. Reads master seed from key vault (HSM / env-encrypted secret)
2. Picks the next unused `token_index` (persisted counter)
3. Calls `deriveTokenSecrets(masterSeed, tokenIndex)` — produces `spend` and `blind` keypairs
4. Computes `Y = hashToCurve(spend.addressBytes)`, `B = r·Y`
5. Stores all of the above in a server-side token store keyed by `token_handle` (random UUID)
6. Returns `{ token_handle, deposit_id }` — deposit_id is the blind address (safe to expose)

---

### `ghost_deposit`

Builds, simulates, and submits the deposit transaction after user approval.

```json
{
  "name": "ghost_deposit",
  "description": "Locks 0.01 SOL in a GhostVault deposit. Requires user approval before broadcasting.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "token_handle": { "type": "string", "description": "Handle returned by ghost_derive_token" }
    },
    "required": ["token_handle"]
  }
}
```

**Server logic:**
1. Looks up `(deposit_id, B, Y)` from token store via `token_handle`
2. Builds the `deposit(deposit_id, B, Y)` instruction
3. Simulates via `simulateTransaction` — fails fast if balance insufficient
4. Presents to user: _"Deposit 0.01 SOL to GhostVault? Fee payer: \<wallet\>. Confirm?"_
5. On approval: signs with wallet keypair, broadcasts, waits for confirmation
6. Returns `{ signature, deposit_pda }`

---

### `ghost_announce`

Posts the mint's blind signature on-chain, advancing the deposit to `Announced` state. In a production system the mint is a separate service; for the prototype the MCP server also holds the mint key.

```json
{
  "name": "ghost_announce",
  "description": "Posts the mint's blind signature for a deposit, advancing it to Announced state.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "token_handle": { "type": "string" }
    },
    "required": ["token_handle"]
  }
}
```

**Server logic:**
1. Fetches `B` from token store
2. Calls `blindSign(mintSk, B)` → `S'`
3. Builds and submits the `announce(deposit_id, S')` instruction (no user gate needed — permissionless)
4. Returns `{ signature, state: "Announced" }`

---

### `ghost_redeem`

Unblинds the signature, builds the spend proof, and redeems the deposited SOL to a destination wallet.

```json
{
  "name": "ghost_redeem",
  "description": "Redeems a previously deposited 0.01 SOL to the specified recipient. Burns the nullifier on-chain for double-spend protection.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "token_handle": { "type": "string" },
      "recipient":    { "type": "string", "description": "Base58 Solana public key of the recipient" }
    },
    "required": ["token_handle", "recipient"]
  }
}
```

**Server logic:**
1. Fetches `(S', r, spend.priv, deposit_id, Y)` from token store
2. Computes `S = r⁻¹ · S'` (unblinded BLS signature)
3. Runs local pairing pre-check: `e(S, G2) == e(Y, PK_mint)` — aborts if invalid
4. Calls `generateSolanaSpendSig(spend.priv, recipientPubkeyBytes)` → `sig65`
5. Builds the `redeem(recipient, sig65, nullifier, S, deposit_id)` instruction with `ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })`
6. Presents to user: _"Redeem 0.01 SOL to \<recipient\>? Nullifier \<hex\> will be burned. Confirm?"_
7. On approval: signs, broadcasts, confirms, marks token_handle as spent
8. Returns `{ signature, recipient, amount_lamports }`

---

### `ghost_status`

Read-only — safe to call without approval.

```json
{
  "name": "ghost_status",
  "description": "Returns the on-chain state of a deposit (Pending / Announced / Redeemed / Unknown).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "token_handle": { "type": "string" }
    },
    "required": ["token_handle"]
  }
}
```

---

## Example Agent Session

```
User:  "Send 0.01 SOL privately to HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH"

Agent: I'll use GhostVault to privately route 0.01 SOL.
       Calling ghost_derive_token...
         → token_handle: "a3f1...", deposit_id: "0xd4e7..."

       Calling ghost_deposit (token_handle: "a3f1...")...
         [MCP server] → Simulated OK. Awaiting user approval.

User:  [approves]

Agent: Deposit confirmed. Signature: 5xK3...
       Calling ghost_announce (token_handle: "a3f1...")...
         → Signature: 8mRp... State: Announced

       Calling ghost_redeem (token_handle: "a3f1...", recipient: "HN7c...")...
         [MCP server] → BLS pre-check passed. Awaiting user approval.

User:  [approves]

Agent: Redeemed. Signature: 2tZq...
       0.01 SOL arrived at HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH.
       The on-chain link between sender and recipient is broken — only the
       nullifier (0xd4e7...) is visible, with no connection to your wallet.
```

---

## Security Properties

### What the agent cannot do

| Attack | Why it fails |
|---|---|
| Extract the spend private key | Never returned by any tool; lives only in server memory |
| Re-use a nullifier | Nullifier PDA `init` is atomic; server marks token as spent |
| Redirect funds mid-flight | `sig65` binds the payout to the specific recipient address; changing it invalidates the ECDSA check on-chain |
| Skip user approval | Approval gate is enforced server-side before any `sendTransaction` call |
| Front-run the redeem | The spend signature commits to the recipient pubkey; a searcher copying the tx cannot swap it |

### What an honest agent is trusted to do

- Choose which `token_handle` to use for which recipient
- Decide the timing of deposit vs redeem (can be days apart for better anonymity)
- Construct the session narrative for the user

### MCP Server hardening checklist

- [ ] Master seed stored in HSM or OS keychain — never in env variables in production
- [ ] Token store encrypted at rest (AES-256-GCM); keyed by session + handle
- [ ] All tool calls logged with timestamp, agent session ID, parameters (no secrets), and outcome
- [ ] Approval gate is out-of-band (separate UI channel, not through the agent)
- [ ] `simulateTransaction` result checked before every broadcast
- [ ] Per-session spend cap (e.g. max 5 tokens / 0.05 SOL) enforced server-side
- [ ] Token handles expire after 24 h if unused
- [ ] MCP transport uses TLS; server bound to localhost or authenticated network only

---

## Implementation Skeleton

```typescript
// server.ts — minimal MCP server using @modelcontextprotocol/sdk
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as gl from "./ts/ghost-library";
import { initBN254 } from "./ts/bn254-crypto";

const server = new McpServer({ name: "ghostvault", version: "0.1.0" });

// In-process token store (use encrypted DB in production)
const tokenStore = new Map<string, TokenState>();

server.tool(
  "ghost_derive_token",
  "Derives a one-time deposit token. Returns an opaque handle.",
  {},
  async () => {
    const handle    = crypto.randomUUID();
    const secrets   = gl.deriveTokenSecrets(MASTER_SEED, nextIndex());
    const r         = gl.getR(secrets);
    const { Y, B }  = gl.blindToken(secrets.spend.addressBytes, r);
    tokenStore.set(handle, { secrets, r, Y, B, state: "derived" });
    return {
      content: [{ type: "text", text: JSON.stringify({
        token_handle: handle,
        deposit_id: Buffer.from(secrets.blind.addressBytes).toString("hex"),
      })}]
    };
  }
);

server.tool(
  "ghost_redeem",
  "Redeems a GhostVault deposit to a recipient after user approval.",
  { token_handle: z.string(), recipient: z.string() },
  async ({ token_handle, recipient }) => {
    const t = tokenStore.get(token_handle);
    if (!t || t.state !== "announced") throw new Error("Token not ready");

    const S      = gl.unblindSignature(t.mintSigPrime!, t.r);
    const valid  = gl.verifyBlsPairing(S, t.Y, MINT_PK);
    if (!valid) throw new Error("BLS pre-check failed");

    // ← approval gate: notify user out-of-band, await confirmation

    const sig65  = gl.generateSolanaSpendSig(
      t.secrets.spend.priv,
      new PublicKey(recipient).toBytes(),
    );
    // … build + send redeem transaction …
    t.state = "spent";
    return { content: [{ type: "text", text: "Redeemed" }] };
  }
);

await initBN254();
await server.connect(new StdioServerTransport());
```

---

## Threat Model Summary

```
Trust level   Component             Capabilities
────────────────────────────────────────────────────────────
HIGH          MCP Server            Holds keys; approves txns; signs
MEDIUM        AI Agent              Plans steps; calls tools; never touches secrets
LOW           On-chain program      Verifies proofs; enforces rules via consensus
ZERO          Third-party observers Cannot link deposit to redeem (BLS blind)
              Compromised agent     Cannot steal funds (no key access)
              Searching validators  Cannot redirect payout (sig bound to recipient)
```
