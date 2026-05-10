# zkEverything — Architecture

## System Overview

zkEverything lets a user send SOL privately through a chat-driven AI agent. The deposit and the withdrawal are on-chain but cryptographically unlinked: no observer can trace which deposit funded which redemption.

---

## High-Level Flow

```
User (mobile browser)
        │
        │  1. Register / Login (email + password)
        ▼
┌───────────────────┐          ┌─────────────────────┐
│    agent-ui       │◄────────►│   Supabase           │
│  (Next.js 15)     │  auth    │  - Auth (JWT)        │
│                   │          │  - agents table      │
│  - LoginPage      │          │    (pubkey +         │
│  - CreateAgent    │          │     encrypted key)   │
│  - Chat (guided)  │          └─────────────────────┘
└────────┬──────────┘
         │  2. Authenticated REST + SSE streaming
         ▼
┌───────────────────────────────────────────────────────┐
│                  agent-backend (Express)               │
│                                                        │
│  POST /api/agent/create  ──► generate Solana keypair  │
│                               AES-256-GCM encrypt     │
│                               store in Supabase       │
│                                                        │
│  GET  /api/agent         ──► return agent pubkey      │
│  GET  /api/agent/balance ──► RPC getBalance()         │
│                                                        │
│  POST /api/chat          ──► GPT-4o-mini (streamText) │
│                               5 tools (see below)     │
└────────────────────┬──────────────────────────────────┘
                     │  3. Private payment execution
                     ▼
┌───────────────────────────────────────────────────────┐
│              Solana Devnet (GhostVault program)        │
│           786pocjFvsLKLL4Ly5cYm2e5qsT4GMBvK21Cx97PWK1o│
│                                                        │
│  deposit()   agent keypair ──► lock 0.01 SOL in vault │
│  announce()  agent keypair ──► post blind signature   │
│  redeem()    relayer keypair ► transfer SOL to recip. │
└───────────────────────────────────────────────────────┘
```

---

## Privacy Protocol (BLS Blind Signatures over BN254)

The core privacy guarantee comes from blind signatures — the mint signs a token without seeing which deposit it corresponds to.

```
CLIENT (agent-backend)                    ON-CHAIN (Solana)
─────────────────────                     ─────────────────

1. Derive token secrets from random seed
   spend_priv  → secp256k1 keypair (nullifier)
   blind_priv  → blinding factor r

2. Compute B = r · H_G1(spend_addr)       deposit(deposit_id, B)
   ──────────────────────────────────────────────────────────►
                                           vault receives 0.01 SOL

3. Compute S' = sk_mint · B               announce(deposit_id, S')
   (blind signature using MINT_SK)        ──────────────────────►
   Mint never sees spend_addr

4. Unblind: S = r⁻¹ · S'
   (S is the valid mint signature on H_G1(spend_addr))

5. Generate spend_sig = secp256k1.sign(   redeem(recipient,
     keccak256("Pay to RAW:" || recip))     spend_sig, nullifier,
                                            S, Y)
                                          ──────────────────────►
                                           BLS pairing check:
                                           e(S, G2) == e(Y, PK_mint)
                                           ECDSA check: spend_sig
                                           Transfer 0.01 SOL → recip
```

**Privacy guarantee:** The `deposit_id` (revealed at deposit) and the `nullifier` (revealed at redeem) are cryptographically unlinked without the master seed. An on-chain observer sees two separate transactions with no common field.

---

## Agent Chat Tools

The AI agent (GPT-4o-mini) orchestrates the flow using 5 tools:

```
collect_destination  ──► UI shows address input field
collect_amount       ──► UI shows [1 SOL] [0.1 SOL] [0.01 SOL] buttons
show_funding_address ──► UI shows agent pubkey + starts balance polling
send_private_payment ──► executes deposit → announce → redeem
payment_complete     ──► UI shows Done + Solscan link
```

---

## Component Map

```
dev3pack/
├── agent-ui/                    Next.js 15 frontend
│   └── app/
│       ├── components/
│       │   ├── AppRouter.tsx    Auth-aware screen router
│       │   ├── LoginPage.tsx    Email/password register + login
│       │   ├── CreateAgentPage  One-time agent keypair creation
│       │   └── Chat.tsx         Guided chat UI (tool-driven steps)
│       └── lib/
│           ├── supabase.ts      Browser Supabase client
│           └── api.ts           Authenticated fetch helper
│
├── agent-backend/               Express + TypeScript backend
│   └── src/
│       ├── server.ts            Express app + /api/chat endpoint
│       ├── agent.ts             streamText + tool definitions
│       ├── agent/
│       │   ├── routes.ts        /api/agent/* REST endpoints
│       │   ├── supabase.ts      Admin Supabase client
│       │   └── crypto.ts        AES-256-GCM keypair encryption
│       ├── auth/
│       │   └── middleware.ts    JWT verification via Supabase
│       ├── solana/
│       │   ├── client.ts        Anchor program call wrappers
│       │   └── errors.ts        Error message mapping
│       ├── tools/
│       │   └── send-private-payment.ts  Full 3-step payment flow
│       └── lib/
│           ├── ghost-library.ts  BLS blind sig crypto (secp256k1 + BN254)
│           ├── bn254-crypto.ts   BN254 G1/G2 primitives via mcl-wasm
│           └── mint.ts           G1/G2 serialization helpers
│
└── prototype/                   Anchor workspace (deployed program source)
    └── programs/ghost_vault/    Rust contract — deposit/announce/redeem
```

---

## Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Auth | Supabase email/password | Simple, no OAuth redirect complexity |
| Keypair storage | AES-256-GCM encrypted in Supabase | Agent key never leaves backend |
| JWT verification | `supabase.auth.getUser()` (admin) | No JWT secret format ambiguity |
| LLM | GPT-4o-mini via AI SDK | Cheap, fast, good tool use |
| Streaming | Vercel AI SDK `pipeDataStreamToResponse` | Real-time tool invocations in UI |
| Tx confirmation | Send + confirm separated in `callRedeem` | Survives devnet timeout without losing signature |
| Balance detection | 2s polling `/api/agent/balance` | Simple; no websocket needed |
