# NozKash on Solana — Colosseum Hackathon Decision Brief

**Date:** 2026-05-08  
**Hackathon:** Colosseum (official Solana Foundation hackathon)  
**Decision:** Should we port NozKash (GhostVault blind-signature eCash) to Solana, and if so, what's the most compelling angle?

---

## TL;DR

Port it. Solana has the BN254 syscalls needed, the privacy gap on Solana is wide open, and the AI agent + privacy angle is unoccupied territory at Colosseum. The scheme's core insight — **blind signatures instead of ZK proofs** — is even more valuable on Solana, where the ZK tooling is still maturing. Autonomous AI agents that can transact without leaving a cross-session identity trail are a natural fit for the infrastructure track.

---

## 1. What Survives the Port Unchanged

These components require **zero cryptographic changes**:

- **The BLS blind signature protocol itself.** Multiplicative blinding over BN254 is chain-agnostic math. The mint, the blinding factor `r`, and the unblinding step are identical.
- **Python and TypeScript crypto libraries.** `mcl-wasm`, `@noble/curves`, `py_ecc` — none of these know what chain they're on.
- **The mint server architecture.** The WebSocket daemon that listens for deposit events and calls `announce()` changes only its RPC transport layer, not its signing logic.
- **Cross-language test vectors.** All crypto unit tests remain valid.
- **The privacy model.** The mint-cannot-link property, the nullifier double-spend prevention, and the ECDSA MEV protection all port directly.

---

## 2. What Needs to Be Rewritten

| Component | EVM version | Solana replacement | Effort |
|-----------|------------|-------------------|--------|
| Smart contract | `GhostVault.sol` (Solidity) | `ghost_vault` Anchor program (Rust) | Large |
| State storage | `mapping(address => bool)` | PDAs per deposit/nullifier | Medium |
| `ecPairing` | Precompile 0x08 | `sol_alt_bn128_pairing` syscall | Small (in Rust) |
| `ecrecover` | Precompile 0x01 | `sol_secp256k1_recover` syscall | Small |
| `modexp` | Precompile 0x05 | Off-chain precompute + on-chain curve membership check | Small |
| Event emission | Solidity `emit` | Anchor `emit!` macro | Small |
| Transaction builder | `viem` + ABI encoding | `@solana/web3.js` + Anchor IDL | Medium |
| Event scanner | `eth_getLogs` | `getProgramLogs` / websocket subscription | Medium |
| Frontend wallet | MetaMask + `eth_sendTransaction` | Phantom/Backpack + `signAndSendTransaction` | Medium |

**Total rewrite scope:** The Rust Anchor program is the hard part. Everything else is swap-out wiring. A focused team can ship a working devnet deployment in 3–4 days.

---

## 3. What Solana Uniquely Enables

Things that are difficult or impossible on EVM but natural on Solana:

### 3.1 Compressed NFT–style denomination tokens
Solana's state compression (Light Protocol's ZK compression) can issue denomination receipts as compressed accounts at ~$0.000005 per token. NozKash could issue each deposit as a compressed "ghost note" — spendable, transferable, and private. This is not possible on EVM without L2.

### 3.2 Solana Actions / Blinks
Blinks turn any Solana transaction into a shareable URL or embeddable button. A NozKash redeem URL sent over Signal or embedded in a tweet allows one-click anonymous payment with no dApp visit required. This is a UI primitive that EVM doesn't have.

### 3.3 Native multi-party mint via threshold signatures
Solana's fast finality (~400ms) makes threshold blind signature coordination practical in real time. N-of-M mint committee signers can coordinate a round-trip blind signature in a single human-visible second — on Ethereum this would take multiple blocks.

### 3.4 Token-2022 integration
The SPL Token-2022 program has a Confidential Transfers extension (using ElGamal + ZK). NozKash could bridge between the public SPL ecosystem and private ghost notes: deposit any SPL token, receive a private ghost note, redeem to a fresh SPL token account. This is a direct integration point that doesn't exist in the EVM version.

### 3.5 Program-to-program CPI
A Solana program can CPI (cross-program invocation) into GhostVault. This means another program — including an AI agent program — can atomically deposit into NozKash as part of a larger transaction. On EVM, calling from a contract into a mixer typically breaks privacy because `msg.sender` leaks.

---

## 4. AI Agent Integration Opportunities

**Focus: autonomous agents that hold Solana wallets and use NozKash programmatically.**

The core insight: AI agents interact with many protocols over many sessions. Without privacy, their on-chain activity can be correlated across sessions, counterparties, and time — building a public dossier of what the agent is doing, for whom, and at what cost. NozKash gives agents **unlinkable payment capability**: the agent deposits from its known wallet and redeems to a fresh address per task, making cross-session correlation infeasible.

---

### Integration 1: Ghost Agent — The Private Autonomous Spender

**What it does:** An autonomous agent (Claude-powered, using the Anthropic API) holds a Solana keypair, manages a NozKash vault, and makes private payments as part of executing tasks.

**Flow:**
```
User → Agent: "Pay researcher.sol 0.01 SOL for this dataset, don't let them
               know it's me or track my other purchases"
Agent →
  1. Checks vault balance (has ghost notes ready)
  2. Selects a fresh spend address for this task
  3. Calls redeem() → funds sent to researcher.sol
  4. The researcher sees an anonymous SOL transfer — no link to agent identity
  5. Agent reports completion to user
```

**Hackathon demo angle:** Agent with a Solana wallet that maintains a private "expense account" — it can pay for on-chain services, oracle queries, storage, or other agents without revealing its spending pattern. Show the correlation attack that's possible without NozKash (chain analysis linking all agent payments) and the before/after with NozKash.

**Implementation:**
- Claude agent with tool use: `ghost_deposit`, `ghost_redeem`, `ghost_balance`
- Each tool makes RPC calls to the Solana devnet via `@solana/web3.js`
- The mint server runs alongside (or as a second agent process)
- Show the wallet graph — with NozKash, it's disconnected; without, it's a star graph

---

### Integration 2: Agent Privacy Router — Context-Aware Private Payments

**What it does:** An orchestration agent that decides, based on context, whether to route a payment through NozKash or send it directly. It acts as a privacy-preserving payment layer for other agents or dApps.

**Routing logic (Claude-powered reasoning):**
```
If counterparty is new AND transaction amount is significant:
  → Route through NozKash (protect agent identity)
If counterparty is trusted AND repeated:
  → Send directly (save fees)
If chain congestion is high AND denomination doesn't cover fees:
  → Defer to off-peak
```

**Why this is interesting for Colosseum:** It's not a fixed privacy tool — it's an agent that reasons about *when* privacy is worth paying for. This is a novel framing: privacy as a dynamic policy, not a static feature.

**Hackathon demo angle:** Show a live agent economy with 3–5 sub-agents paying each other for services (data, compute, inference). The orchestrator decides which payments go through NozKash. Visualize the payment graph live — some edges are unlinkable (NozKash), some are public.

---

### Integration 3: AI-Operated Distributed Mint (Threshold Blind Signatures)

**What it does:** Replace the single centralized mint server with a committee of AI agents that collectively operate a threshold blind signature scheme. No single agent holds the full signing key.

**Architecture:**
```
N agents each hold a BLS key share
User deposit → agents each produce a partial blind signature
Combiner (or Shamir interpolation) → full signature S'
announce() called → user can redeem
```

**Why this matters:** The current single-mint trust assumption (mint can refuse to sign; mint could log timing) is the main trust footprint of NozKash. Distributing the mint across autonomous agents running in different TEEs or jurisdictions eliminates the single point of failure. Agents can be verified via remote attestation to prove they run no-log code.

**Hackathon demo angle:** 3-of-5 threshold mint run by 5 Claude agents, each holding a key share. Show that even if 2 agents are killed/offline, the user can still get their token signed. Show that even if 2 agents are compromised, they cannot reconstruct the full signing key.

**Implementation note:** Threshold BLS on BN254 is well-studied (FROST/BLS-DKG). The Anchor program doesn't change — only the mint server layer becomes multi-party.

---

### Integration 4: Private Agent-to-Agent Marketplace

**What it does:** A marketplace where AI agents pay each other for services (inference, data, tools) using NozKash ghost notes as the settlement currency. Payments are private by default — a hiring agent cannot be linked across multiple job postings.

**Why this is compelling for the AI track:** Today's agent payment experiments (NEAR AI, Ocean Protocol, Bittensor) all have public payment graphs. Any observer can see which agents are profitable, which tasks are in demand, and which agents are working together. NozKash ghost notes make the agent economy legible only to participants, not to chain analysts.

**Hackathon demo angle:** An agent marketplace with a public job board (on-chain, visible) but private payment settlement (NozKash). Employers post tasks publicly; payments go through NozKash so competitors can't infer which tasks are economically viable.

---

## 5. Competitive Landscape on Solana

| Project | Privacy mechanism | Status | Gap vs. NozKash |
|---------|-----------------|--------|-----------------|
| Elusiv | ZK proofs (Groth16) | Shut down 2024 | Complex, expensive, defunct |
| Light Protocol | ZK compression (not privacy) | Active | Not a privacy protocol |
| SPL Confidential Transfers | ElGamal + ZK | Active (SPL tokens only) | SOL not supported; no general-purpose transfers |
| Tornado Cash Solana | Non-existent | — | Gap is wide open |
| Monero-style RingCT | Non-existent on Solana | — | Research only |

**NozKash on Solana would be the only live, production-deployed privacy primitive for native SOL transfers that doesn't require ZK circuits or a trusted custodian.** This is the strongest competitive position possible for an infrastructure track submission.

---

## 6. Recommended Submission Angle

**Track:** Infrastructure (primary) + AI (secondary with agent integrations)

**Pitch in one sentence:**
> "NozKash is a blind-signature eCash layer for Solana SOL transfers — no ZK circuits, no custodian, under $0.15 per private transfer — with a native AI agent SDK so autonomous agents can pay and receive SOL without leaving a deanonymizable on-chain identity."

**Differentiation from prior work:**
1. No ZK circuits — anyone can audit the scheme with a BLS signature tutorial, no Groth16 expertise required
2. The mint is modular — replace the single server with a Claude-powered threshold committee in the same codebase
3. AI agent SDK ships with the project — agents are first-class users, not an afterthought

---

## 7. 72-Hour Hackathon Sprint Plan

| Hours | Deliverable | Owner |
|-------|-------------|-------|
| 0–4 | Benchmark `sol_alt_bn128_pairing` CU cost on devnet | Crypto / Rust |
| 4–20 | Anchor program: `deposit`, `announce`, `redeem` with syscall-backed BLS verify | Rust |
| 20–32 | TypeScript client: swap viem for @solana/web3.js, keep crypto layer | TS |
| 32–40 | Mint server: swap Ethereum WebSocket for Solana subscription | Python |
| 40–52 | Integration 1 demo: Ghost Agent (Claude + tool use + Solana wallet) | AI / TS |
| 52–60 | React app: swap MetaMask for Phantom, deploy to devnet | Frontend |
| 60–68 | Integration 2 demo: Privacy Router agent (routing logic + live viz) | AI |
| 68–72 | Polish demo, write judging description, record video | All |

**Critical path:** Anchor program (hours 4–20) and the CU benchmark (hours 0–4) must complete before anything else. If the pairing CU cost exceeds 1.4M, pivot to a split-transaction approach (separate transaction for pairing + redemption with a commitment handoff).

---

## 8. Final Decision

**Build it.** The feasibility gap is narrow (one benchmark), the competitive gap on Solana is wide, and the AI agent angle gives judges something they haven't seen before: a privacy primitive designed from the ground up for autonomous agents, not just human users.

The worst case — the BN254 pairing is too expensive for a single transaction — is recoverable: split across two transactions with a commitment scheme, or use a Solana ZK coprocessor (e.g., Bonsai/RISC Zero on Solana) for the pairing. Neither path kills the project.
