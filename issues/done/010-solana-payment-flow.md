## Parent PRD

`issues/prd-agent-platform.md`

## What to build

Replace the stub `send_private_payment` tool handler with the real GhostVault payment flow: BN254 init, secret derivation, deposit, announce, and redeem — all using the existing `prototype/ts/ghost-library.ts` and `prototype/ts/bn254-crypto.ts` modules.

The `solana/client.ts` module sets up the Anchor program client using the relayer keypair and RPC URL from env. It exposes three functions matching the three on-chain instructions: `callDeposit`, `callAnnounce`, `callRedeem`. The tool handler in `tools/send-private-payment.ts` calls them in sequence.

Key implementation details from the PRD:
- `initBN254()` is called once at module load via a singleton — not per request
- The relayer keypair (from `RELAYER_KEYPAIR` env var) is the transaction payer for all three instructions, ensuring no on-chain link to any user wallet
- The mint BLS secret key (`MINT_SK`) is used in the announce step to compute `S' = sk · B`
- The `NullifierRecord` PDA is derived from `[b"nullifier", nullifier_bytes]`
- The redeem instruction references the shared vault PDA `[b"vault"]` and mint state PDA `[b"state"]`
- Program ID: `786pocjFvsLKLL4Ly5cYm2e5qsT4GMBvK21Cx97PWK1o`

The tool handler returns `{ signature: string }` on success. The agent formats this as `https://solscan.io/tx/<signature>?cluster=devnet`.

## Acceptance criteria

- [ ] A full payment flow completes against Solana devnet: deposit → announce → redeem
- [ ] The recipient's devnet balance increases by 0.01 SOL after the flow
- [ ] The returned signature resolves on `https://solscan.io/tx/<sig>?cluster=devnet`
- [ ] `initBN254()` is called exactly once (at startup), not per request
- [ ] The relayer keypair (not any user key) appears as the fee payer in all three transactions
- [ ] Running the chat flow twice with the same ephemeral spend address fails with a nullifier collision (proving double-spend protection works)
- [ ] The server starts cleanly with a populated `.env` file

## Blocked by

- Blocked by `issues/008-backend-chat-skeleton.md`

## User stories addressed

- User story 10
- User story 12
- User story 13
- User story 15
- User story 18
