## Parent PRD

`issues/prd.md`

## What to build

Implement the `redeem` instruction — the cryptographic core of the protocol — and write the complete end-to-end Anchor test covering the full deposit → announce → redeem flow plus double-spend rejection.

The instruction performs five verifications in order before transferring funds:
1. ECDSA recovery: recover signer from spend signature over `keccak256("Pay to RAW: " || recipient_bytes)` using the `secp256k1_recover` syscall; assert recovered address == nullifier
2. State check: assert Deposit PDA state == Announced
3. Hash-to-curve: compute `Y = H(nullifier)` via keccak256 try-and-increment (matching EVM)
4. BLS pairing: verify `e(unblinded_sig, G2_generator) == e(Y, mint_pk)` using `sol_alt_bn128_group_op` syscall (op code 3)
5. Double-spend: create Nullifier PDA at `[b"nullifier", nullifier]` — fails if already exists

On success: close the Deposit PDA and transfer all lamports (deposited SOL + rent) to the recipient.

The TypeScript test side must locally verify the BLS pairing (using mcl-wasm) before submitting the redeem transaction, so any crypto failure is diagnosable at the TS layer.

End state: two passing Anchor tests — one full happy-path flow and one double-spend rejection.

## Acceptance criteria

- [ ] `redeem(recipient: Pubkey, spend_sig: [u8; 65], nullifier: [u8; 20], unblinded_sig: [u8; 64])` instruction implemented
- [ ] ECDSA recovery uses `secp256k1_recover` syscall with recovery bit = `spend_sig[64] - 27` (EVM convention → Solana convention)
- [ ] Hash-to-curve uses keccak256 try-and-increment identical to EVM reference (loop over counter, check quadratic residue mod BN254 field prime)
- [ ] BLS pairing uses `sol_alt_bn128_group_op` with op code 3; G2 generator hardcoded as 128-byte constant in EIP-197 limb order
- [ ] Nullifier PDA created at `[b"nullifier", nullifier]`; instruction fails with a clear error if PDA already exists
- [ ] Deposit PDA closed (lamports zeroed, account data cleared) and all lamports transferred to recipient
- [ ] Recipient SOL balance increases by approximately 0.01 SOL (minus tx fees) after redeem
- [ ] **Happy path test**: `initialize` → `deposit` → inline `blindSign` → `announce` → local pairing pre-check → `redeem` → assert recipient balance delta, nullifier PDA exists, deposit PDA gone
- [ ] **Double-spend test**: complete happy path, then attempt second `redeem` with same nullifier → assert transaction fails
- [ ] Local BLS pairing pre-check in test: `assert e(S, G2) == e(Y, mint_pk)` using mcl-wasm before submitting redeem tx

## Blocked by

- Blocked by `issues/002-initialize-instruction.md`
- Blocked by `issues/004-announce-instruction.md`

## User stories addressed

- User story 1
- User story 8
- User story 9
- User story 10
- User story 11
- User story 15
- User story 16
- User story 17
- User story 18
