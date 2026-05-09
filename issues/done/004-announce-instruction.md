## Parent PRD

`issues/prd.md`

## What to build

Implement the `announce` instruction in the Anchor program and add `blindSign(sk, B)` to `prototype/ts/mint.ts`. The instruction is permissionless — any caller may submit a blind signature S' for a given deposit ID. It loads the `Deposit` PDA, writes `mint_sig` with the provided S', and sets `state` to Announced (1). It must reject deposits that are not in Pending state.

Write an Anchor test that builds on the deposit test: after depositing, call the inline mint's `blindSign` to compute S', submit `announce`, and assert the PDA state has transitioned to Announced with the correct `mint_sig` bytes stored.

End state: a passing Anchor test that proves the mint can post a blind signature on-chain and the PDA state transitions correctly.

## Acceptance criteria

- [ ] `announce(deposit_id: [u8; 20], mint_sig: [u8; 64])` instruction updates the `Deposit` PDA
- [ ] Sets `mint_sig` to the provided value and `state` to 1 (Announced)
- [ ] Rejects if PDA state is already Announced (idempotent protection)
- [ ] Instruction is permissionless — no signer constraint beyond the transaction fee payer
- [ ] `prototype/ts/mint.ts` exports `blindSign(sk: mcl.Fr, B: mcl.G1): mcl.G1` returning S' = sk·B
- [ ] S' is serialized as 64 bytes (G1 point, uncompressed x||y) matching the on-chain field layout
- [ ] Anchor test: deposit → `blindSign(sk, B)` → `announce` → fetch PDA → assert `state == 1` and `mint_sig` matches S'

## Blocked by

- Blocked by `issues/002-initialize-instruction.md`
- Blocked by `issues/003-deposit-instruction.md`

## User stories addressed

- User story 6
- User story 7
- User story 14
