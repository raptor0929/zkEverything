## Parent PRD

`issues/prd.md`

## Problem

The current architecture creates a direct edge in the transaction graph that any block
explorer can follow: the `DepositRecord` PDA is **created** in the deposit transaction
and **closed** in the redeem transaction. Both transactions reference the same account
address, so an observer trivially links depositor → redeemer without breaking any
cryptography.

The BLS blind signature scheme is cryptographically sound — the nullifier is unlinkable
to the blind address. The privacy leak is entirely structural: individual PDAs with
observable lifecycles, not a flaw in the crypto.

## What to build

Replace the individual-PDA-per-deposit model with a **pooled escrow vault** so that
the redeem instruction has zero on-chain reference to any deposit-specific account.

### On-chain program changes (`programs/ghost_vault/src/lib.rs`)

**1. Pool vault PDA**

Add a `VaultState` account initialised alongside `MintState` in the `initialize`
instruction (or as a separate `init_vault` instruction):

```
seeds = [b"vault"]
```

The vault is a program-owned PDA. All deposited SOL flows in; all redemptions flow out
via direct lamport manipulation (program-owned PDAs cannot use `system_program::transfer`
as the signer; use `**vault.try_borrow_mut_lamports()? -= DENOMINATION` instead).

**2. `deposit` instruction — remove `y_point`, redirect SOL to vault**

- Remove `y_point: [u8; 64]` parameter — it was stored only so `redeem` could read it;
  `redeem` now takes it as a direct caller-supplied parameter.
- Transfer `DENOMINATION` lamports to the **vault PDA** (not to the deposit PDA).
- `DepositRecord` shrinks: remove `y_point` field (saves 64 bytes rent per deposit).

New signature: `deposit(deposit_id: [u8; 20], blinded_point: [u8; 64])`

New `DepositRecord`:
```rust
pub struct DepositRecord {
    pub blinded_point: [u8; 64],
    pub mint_sig:      [u8; 64],
    pub state:         u8,
    pub bump:          u8,
}
// LEN = 64 + 64 + 1 + 1 = 130
```

**3. `announce` instruction — unchanged**

Still writes `mint_sig` (S') into the `DepositRecord`. No changes needed.

**4. `redeem` instruction — drop deposit PDA entirely, add `y_point` param**

- Remove `deposit_id: [u8; 20]` parameter — existed only to derive the deposit PDA seed;
  keeping it even as unused data re-creates the graph link via instruction argument
  inspection.
- Remove `deposit` account from the accounts list entirely — not read, not written,
  not closed.
- Add `y_point: [u8; 64]` parameter — caller-supplied; the BLS pairing
  `e(S, G2) == e(Y, PK_mint)` is self-validating so no on-chain commitment is needed.
- Add `vault` account (writable) — transfer `DENOMINATION` lamports to `recipient_account`
  using direct lamport manipulation.
- `NullifierRecord` init at `[b"nullifier", nullifier]` is unchanged — still the
  double-spend guard.

New signature:
```
redeem(
    recipient:     Pubkey,
    spend_sig:     [u8; 65],
    nullifier:     [u8; 20],
    unblinded_sig: [u8; 64],
    y_point:       [u8; 64],
)
```

New accounts: `payer, recipient_account, mint_state, vault, nullifier_record, system_program`

**5. `DepositRecord` lifecycle after redeem**

Deposit PDAs are **left open permanently** — their rent is locked but they are never
referenced during redeem. This is acceptable at prototype scale. A time-locked cleanup
crank is deferred to a future issue.

### TypeScript test changes (`tests/ghost_vault.ts`)

- Remove `y_point` argument from all `deposit(...)` calls.
- Update `DEPOSIT_ACCOUNT_SIZE` to `8 + 130 = 138` bytes.
- Remove `deposit_id` argument from `redeem(...)` calls.
- Add `y_point` argument (serialised Y point) to `redeem(...)` calls.
- Remove `deposit` from the redeem accounts map.
- Add `vault` to the redeem accounts map.
- Balance assertion: check pool vault lamports decrease by `DENOMINATION` and recipient
  receives `DENOMINATION`.

### Client library changes (`ts/ghost-library.ts`)

- Update `buildRelayPayload()`: remove `deposit_id`, add `y_point` (hex-encoded 64 bytes).
- Update `RelayPayload` interface accordingly.

### Relayer changes (`relayer/server.ts`)

- Remove `deposit_id` field from the relay request body.
- Add `y_point` field (hex 64 bytes) to the relay request body and validation.
- Remove deposit PDA pre-flight fetch (no deposit account in redeem).
- Keep nullifier PDA pre-flight check (unchanged).
- Add vault account to the redeem accounts map.

## Anonymity set analysis

After this change, a block explorer sees for every redeem transaction:

| Account | Role | Links to depositor? |
|---|---|---|
| Relayer wallet | payer/signer | No — separate wallet |
| Pool vault PDA | SOL source | No — shared by all depositors |
| Recipient wallet | SOL destination | No — fresh keypair |
| Nullifier PDA | created | No — keyed by spend_address, no predecessor |

The deposit transaction (creating a `DepositRecord` PDA) becomes a dead-end on the
graph — the PDA is never consumed, so no redeem transaction points back to it.

## Acceptance criteria

- [ ] `VaultState` PDA initialised at `[b"vault"]`; holds all deposited SOL
- [ ] `deposit(deposit_id, blinded_point)` — no `y_point` param; SOL goes to vault
- [ ] `DepositRecord` has no `y_point` field; `LEN = 130`
- [ ] `redeem(recipient, spend_sig, nullifier, unblinded_sig, y_point)` — no `deposit_id`, no deposit account, draws SOL from vault
- [ ] BLS pairing uses caller-supplied `y_point`; no on-chain deposit account read
- [ ] `NullifierRecord` init unchanged; double-spend protection intact
- [ ] Deposit PDA left open after redeem (no close, no graph link)
- [ ] Happy path test passes end-to-end on devnet
- [ ] Relay payload no longer contains `deposit_id`; contains `y_point`
- [ ] Block explorer shows redeem tx with zero reference to any deposit PDA address

## Blocked by

- `issues/done/005-redeem-instruction-full-flow.md`

## User stories addressed

- User story 8 (transaction graph privacy — depositor unlinkable from recipient)
- User story 15 (nullifier double-spend protection)
- User story 16 (BLS verification on-chain)
