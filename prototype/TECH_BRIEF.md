# GhostVault — Blockchain Infrastructure Tech Brief

## Overview

GhostVault is a privacy-preserving SOL mixer on Solana. Users deposit 0.01 SOL anonymously using blind BLS signatures, then redeem via a nullifier without linking the withdrawal to the deposit.

---

## On-Chain Program

| Layer | Technology |
|---|---|
| Blockchain | **Solana** (Agave 4.0.0-rc.0, devnet) |
| Program framework | **Anchor 0.32.0** (Rust macros, account constraints, IDL generation) |
| Rust toolchain | **Rust 1.89.0** + SBF (Solana BPF) target via platform-tools |
| Program ID | `786pocjFvsLKLL4Ly5cYm2e5qsT4GMBvK21Cx97PWK1o` |

### Syscalls Used

| Syscall | Purpose |
|---|---|
| `sol_alt_bn128_group_op` (op 3) | BN254 pairing check — verifies the blind BLS signature on-chain |
| `secp256k1_recover` (via `solana-secp256k1-recover 2.2.1`) | Recovers the signer pubkey from the ECDSA spend proof |

### On-Chain Crates

| Crate | Version | Role |
|---|---|---|
| `anchor-lang` | 0.32.0 | Program framework |
| `solana-secp256k1-recover` | 2.2.1 | secp256k1 ECDSA pubkey recovery |
| `sha3` | 0.10 | keccak256 for ECDSA message hash and address derivation |
| `indexmap` | ~2.7 | Pinned to avoid `edition = "2024"` parse failure in platform-tools |

---

## Cryptography

### BLS Blind Signatures over BN254

The mint issues blind signatures so it cannot link a deposit to a later redemption.

```
Deposit:  B = r · Y          (blinded point, Y = H(spend_address))
Mint:     S' = sk · B        (blind signature, stored on-chain)
Redeem:   S = r⁻¹ · S'      (unblinded signature, stays off-chain until redeem)
Verify:   e(S, G2) == e(Y, PK_mint)   (BN254 pairing, checked by sol_alt_bn128_group_op)
```

- **Curve**: BN254 (alt_bn128) — field prime `p ≡ 3 mod 4`
- **Hash-to-curve**: keccak256 try-and-increment computed **off-chain** by the client; Y is committed to the deposit record on-chain at deposit time, avoiding the need for `sol_big_mod_exp` (removed from Agave 4.x)
- **G2 generator**: hardcoded 128-byte EIP-197 constant `[X_imag, X_real, Y_imag, Y_real]`
- **Pairing input**: `[S(64), G2_gen(128), −Y(64), PK_mint(128)]` — negating Y converts `e(S,G2)·e(Y,PK)=1` to the two-pair form the precompile expects

### ECDSA Anti-MEV Spend Proof

Binds each redemption to a specific recipient address so a front-running searcher cannot redirect funds.

- **Curve**: secp256k1
- **Message**: `keccak256("Pay to RAW: " || recipient_pubkey_bytes[32])`
- **Signature format**: `r(32) ‖ s(32) ‖ v(1)`, where `v = recoveryBit + 27` (EVM convention)
- On-chain: `recovery_id = v − 27`, then `secp256k1_recover(msg_hash, recovery_id, r‖s)` → pubkey → `keccak256(pubkey)[12:]` must equal the claimed nullifier

### Double-Spend Protection

A `NullifierRecord` PDA keyed by `[b"nullifier", nullifier]` is created via Anchor `init` during redemption. Anchor's `init` constraint fails atomically if the account already exists, making double-spending impossible without extra logic.

---

## Off-Chain Client (TypeScript)

| Library | Version | Role |
|---|---|---|
| `@coral-xyz/anchor` | ^0.32.1 | Program client, IDL-typed RPC calls |
| `mcl-wasm` | ^2.0.0 | BN254 G1/G2 arithmetic — scalar multiply, pairing, Fr operations |
| `@noble/curves` | ^2.0.1 | secp256k1 key generation, signing (`format: 'recovered'`), verification |
| `ethereum-cryptography` | ^3.2.0 | keccak256 hash (address derivation, ECDSA message hash) |
| `@solana/web3.js` | (via anchor) | Transaction building, PDA derivation, RPC calls |

### Key Client Modules

| File | Responsibility |
|---|---|
| `ts/ghost-library.ts` | Token secret derivation, blind/unblind operations, ECDSA spend proof, BLS pairing pre-check |
| `ts/bn254-crypto.ts` | Low-level BN254 wrappers: hash-to-curve, scalar multiply, pairing verify, G2 generator |
| `ts/mint.ts` | Mint-side BLS key generation, G1/G2 serialization (EIP-197 byte order) |

---

## Account Architecture

| PDA Seeds | Account | Size | Purpose |
|---|---|---|---|
| `[b"state"]` | `MintState` | 8 + 129 B | Stores mint BLS public key (G2, 128 bytes) |
| `[b"deposit", deposit_id]` | `DepositRecord` | 8 + 194 B | Blinded point B, Y point, blind signature S', state flag |
| `[b"nullifier", nullifier]` | `NullifierRecord` | 8 + 1 B | Existence = nullifier burned; prevents double-spend |

---

## Token Flow

```
Client                          On-chain
  │                               │
  │ deriveTokenSecrets()          │
  │ Y = hashToCurve(spend_addr)  │
  │ B = r · Y                     │
  │──── deposit(deposit_id, B, Y) ──────────────────▶│ store B, Y; escrow 0.01 SOL
  │                               │
  │ S' = mintBlindSign(sk, B)     │
  │──── announce(deposit_id, S') ───────────────────▶│ store S'; state → Announced
  │                               │
  │ S = r⁻¹ · S'                 │
  │ sig65 = ecdsaSign(spend_priv, recipient)          │
  │                               │
  │──── redeem(recipient, sig65, nullifier, S, deposit_id) ──▶│
  │                               │  1. ecrecover(sig65) == nullifier ✓
  │                               │  2. deposit.state == Announced ✓
  │                               │  3. e(S, G2) == e(Y, PK) via precompile ✓
  │                               │  4. init NullifierRecord (fails if reused) ✓
  │                               │  5. close deposit PDA → 0.01 SOL → recipient ✓
```
