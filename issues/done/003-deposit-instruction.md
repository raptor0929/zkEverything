## Parent PRD

`issues/prd.md`

## What to build

Implement the `deposit` instruction in the Anchor program. The instruction accepts a 20-byte deposit ID (blind address) and a 64-byte blinded point B, creates a `Deposit` PDA at seeds `[b"deposit", deposit_id]`, stores B and sets state to Pending, and transfers exactly 0.01 SOL from the payer into the PDA (lamports above rent-exemption).

Write an Anchor test that derives token secrets from a master seed using `ghost-library.ts`, computes the blinded point B, calls `deposit`, and asserts the PDA exists with the correct state and lamport balance.

End state: a passing Anchor test that proves a client can lock SOL and register a blinded point on-chain.

## Acceptance criteria

- [ ] `deposit(deposit_id: [u8; 20], blinded_point: [u8; 64])` instruction creates `Deposit` PDA at `[b"deposit", deposit_id]`
- [ ] `Deposit` account stores `blinded_point: [u8; 64]`, `mint_sig: [u8; 64]` (zeroed), `state: u8` (0 = Pending), `bump: u8`
- [ ] PDA lamports = rent-exemption + 0.01 SOL (10_000_000 lamports) after deposit
- [ ] Depositing with the same deposit ID twice fails (PDA already exists)
- [ ] Anchor test: derives spend + blind keypairs from seed via `ghost-library.ts`, computes `B = r·Y`, calls `deposit`, fetches PDA, asserts `state == 0` and lamport balance
- [ ] `mcl-wasm` is initialized (`await mcl.init(mcl.BN254)`) in the test `before()` hook before any crypto calls

## Blocked by

- Blocked by `issues/001-workspace-scaffold.md`

## User stories addressed

- User story 3
- User story 4
- User story 5
- User story 12
