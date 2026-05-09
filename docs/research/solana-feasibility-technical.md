# NozKash on Solana — Technical Feasibility Report

**Date:** 2026-05-08  
**Scope:** Can the GhostVault blind-signature eCash scheme run on Solana with comparable or lower transaction cost to the EVM deployment?  
**Target cost goal:** Cheap private transactions (≤ EVM redeem cost of ~120k gas ≈ USD $0.001–0.01 on Fuji/Avalanche)

---

## 1. Executive Summary

The NozKash scheme is **technically portable to Solana** with meaningful caveats. Solana has native BN254 syscalls (`sol_alt_bn128_group_op`, `sol_alt_bn128_pairing`) that cover the most expensive primitives. The single make-or-break question is whether the 2-pair BN254 pairing check fits inside Solana's 1.4M compute unit (CU) ceiling at a cost that beats or matches EVM gas. Empirical benchmarks (not available at time of writing) are required to confirm the pairing CU cost. All other primitives — secp256k1 recovery, keccak256, G1 operations — have direct syscall equivalents and are cheap.

**Verdict per component:**

| Primitive | EVM precompile | Solana equivalent | Feasible? | CU risk |
|-----------|---------------|-------------------|-----------|---------|
| BN254 G1 add | `ecAdd` (0x06) | `sol_alt_bn128_group_op(G1_ADD)` | ✅ Yes | Low (~334 CU) |
| BN254 G1 mul | `ecMul` (0x07) | `sol_alt_bn128_group_op(G1_MUL)` | ✅ Yes | Low (~3,526 CU) |
| BN254 pairing (2 pairs) | `ecPairing` (0x08) | `sol_alt_bn128_pairing` | ✅ Likely | **High — benchmark required** |
| secp256k1 recover | `ecrecover` (0x01) | `sol_secp256k1_recover` | ✅ Yes | Low |
| 256-bit modexp | `modexp` (0x05) | Pure Rust | ⚠️ Expensive | Medium |
| keccak256 | EVM opcode | `sol_keccak256` | ✅ Yes | Negligible |
| Hash-to-curve | Custom (loop + modexp) | Rust loop + `sol_alt_bn128_group_op` | ⚠️ Costly | Medium |

---

## 2. On-Chain Primitive Inventory

Only three precompiles are called by GhostVault.sol itself. Everything else (G1 mul, G1 add) is client-side only.

### 2.1 `ecrecover` — used in `recoverSigner()`

```solidity
return ecrecover(hash, v, r, s);
```

Called once per `redeem()`. Recovers the secp256k1 ECDSA signer from a 65-byte signature over `keccak256("Pay to RAW: " || recipient)`. Binds the nullifier to a specific recipient to prevent MEV front-running.

### 2.2 `modexp` (0x05) — used in `hashToCurve()` loop

```solidity
// Legendre symbol check: x^((P-1)/2) mod P
_modExp(rhs, (P - 1) / 2)

// Modular sqrt: x^((P+1)/4) mod P
_modExp(rhs, (P + 1) / 4)
```

Called **twice per try-and-increment iteration** in `hashToCurve()`. Expected iterations: 1–4 on average (each ~50% chance of success). Worst case 8+ iterations is rare. Total: 2–8 `modexp` calls of 256-bit base and 255-bit exponent per `redeem()` call.

There is **no Solana syscall for modexp**. This must be implemented in pure Rust.

### 2.3 `ecPairing` (0x08) — used in `verifyBLS()`

```solidity
// 2-pair check: e(S, G2_gen) * e(-H(nullifier), PK_mint) == 1
bytes memory input = abi.encodePacked(
    S[0], S[1],          // G1 point (64 bytes)
    g2[0..3],            // G2 gen (128 bytes)
    negY[0], negY[1],    // G1 point (64 bytes)
    PK_mint[0..3]        // G2 pubkey (128 bytes)
);
(bool ok, bytes memory ret) = address(0x08).staticcall(input);
```

Input to the pairing precompile: **384 bytes** (2 × (64 + 128)). This is the most expensive on-chain operation and the critical feasibility gate.

---

## 3. Solana Syscall Mapping

### 3.1 BN254 Group Operations

Solana exposes `sol_alt_bn128_group_op(group_op_id, input_ptr, input_len, result_ptr)` with three operation codes:

| Op ID | Operation | Input format | Output | Est. CU cost |
|-------|-----------|--------------|--------|--------------|
| 0 | G1 add | 128 bytes (two G1 points) | 64 bytes (G1 point) | ~334 CU |
| 1 | G1 scalar mul | 96 bytes (G1 point + scalar) | 64 bytes (G1 point) | ~3,526 CU |
| 2 | G2 add | 256 bytes (two G2 points) | 128 bytes (G2 point) | ~3,000 CU (est.) |

These costs are cheap enough to ignore in budget planning. G1 mul is used client-side for blinding (`B = r · H(spendAddr)`) and unblinding (`S = S' · r⁻¹`), not on-chain.

### 3.2 BN254 Pairing

Solana exposes `sol_alt_bn128_pairing(input_ptr, input_len, result_ptr)`.

- Input: array of (G1, G2) pairs — same wire format as EVM `ecPairing` precompile
- Output: 32 bytes — 1 if the product of pairings equals the identity, 0 otherwise
- For NozKash: 2 pairs → 384-byte input, identical to the EVM calldata

**CU cost: unknown — empirical benchmark is mandatory.**

Known reference points:
- Light Protocol (Groth16 on Solana, ~3 pairings): confirmed feasible within 1.4M CU using a single transaction with max CU budget
- Solana SIMD-0070 (the enabling proposal) set the base cost at 1,000 CU + per-element cost
- Realistic estimate for a 2-pair check: **200,000–800,000 CU** — wide range because the per-pair cost implementation is version-dependent

**Implication:** Even at 800k CU, the check fits within the 1.4M CU cap if the rest of the transaction budget is managed carefully. At 200k CU it's comfortable. The benchmark must be run on a Solana devnet with a deployed BN254 pairing test program before committing to this port.

### 3.3 secp256k1 Recovery

Solana provides two mechanisms:

**Option A — `sol_secp256k1_recover` syscall:**
```rust
sol_secp256k1_recover(hash, recovery_id, signature, result_ptr) -> u64
```
Cost: ~26,000 CU. Works identically to `ecrecover`. The NozKash ECDSA nullifier scheme (sign `keccak256("Pay to RAW: " || recipient)`, recover nullifier address) maps directly.

**Option B — Secp256k1 native program (built-in program `KeccakSecp256k11HDR...`):**
Verification is done via a separate instruction in the same transaction. Cheaper at runtime (~5,000 CU) but requires the signer to supply the signature as a separate instruction, which changes the transaction structure.

**Recommendation:** Use `sol_secp256k1_recover` directly inside the Anchor program for the simplest 1:1 port.

### 3.4 keccak256

`sol_keccak256(vals_ptr, vals_len, hash_result_ptr)` — available natively.

Cost: negligible (hundreds of CU). Used in:
- `hashToCurve` inner loop (`keccak256(nullifier_20 || be32(counter))`)
- Message hash for ECDSA (`keccak256("Pay to RAW: " || recipient)`)

### 3.5 modexp — The Missing Syscall

There is no `sol_modexp` syscall. The Legendre symbol and modular sqrt required by `hashToCurve` must be implemented in native Rust within the program.

**Cost analysis for 256-bit modexp in Rust:**

The exponents are:
- Legendre: `(P - 1) / 2` — a 254-bit exponent
- Sqrt: `(P + 1) / 4` — a 254-bit exponent

Using a square-and-multiply (double-and-add) loop with 254 bits:
- ~254 modular squarings + ~127 modular multiplications on average
- Each 256-bit multiplication in Rust (using `u128` arithmetic or `uint` crates): ~20–50 instructions
- Rough CU estimate per `_modExp` call: **5,000–25,000 CU**
- Per `redeem()` with 2 modexps × average 2 H2C iterations: **~20,000–100,000 CU**

This is manageable but non-trivial. The implementation should use the `crypto-bigint` or `ark-ff` crate (both CU-efficient) rather than a naive implementation.

**Alternative: precompute the square root off-chain**

The hash-to-curve point `H(nullifier)` could be computed client-side and passed as an instruction argument. The on-chain program then only needs to verify the point is on the curve (a cheap `y² == x³ + 3 mod P` check, no modexp needed). This eliminates the `modexp` CU cost entirely.

Trade-off: the nullifier point is deterministic and public — there is no privacy gain from computing it on-chain vs. off-chain. **Recommended: pass `H(nullifier)` as a calldata argument, verify curve membership on-chain.**

---

## 4. Compute Unit Budget for `redeem()`

Estimated CU breakdown for a Solana port of `redeem()`:

| Step | Operation | CU estimate | Notes |
|------|-----------|-------------|-------|
| ECDSA recovery | `sol_secp256k1_recover` | 26,000 | Fixed |
| Nullifier check | Account read (PDA exists check) | ~5,000 | Cheap |
| Hash-to-curve | If computed on-chain (2 modexp × 2 iters) | 20,000–100,000 | Eliminate with off-chain precompute |
| Hash-to-curve | If passed as argument + curve check | ~2,000 | Recommended path |
| BN254 pairing | `sol_alt_bn128_pairing` (2 pairs) | 200,000–800,000 | **Benchmark required** |
| SOL transfer | System program CPI | ~3,000 | |
| Account writes | Nullifier PDA init, state update | ~10,000 | |
| **Total (optimistic)** | | **~246,000 CU** | Pairing at low end + off-chain H2C |
| **Total (pessimistic)** | | **~946,000 CU** | Pairing at high end + on-chain H2C |

**Both scenarios fit within 1.4M CU.** The user must set a custom compute budget via `ComputeBudgetInstruction::set_compute_unit_limit(1_400_000)` and pay the corresponding priority fee.

**Priority fee cost:** Solana's priority fee is priced per CU. At 1,000 microlamports/CU (a reasonable non-congested estimate), 1M CU = 0.001 SOL ≈ $0.15. This is already competitive with Fuji testnet but more expensive than production Avalanche mainnet (~$0.002 per 120k gas redeem). **Solana's base fee structure needs optimization** — see Section 8.

---

## 5. State / Account Model Migration

EVM mappings → Solana PDAs (Program Derived Addresses):

| EVM storage | Solana equivalent | Seeds | Size |
|-------------|-------------------|-------|------|
| `mapping(address => bool) spentNullifiers` | PDA per nullifier | `[b"nullifier", nullifier_20_bytes]` | 1 byte (existence = spent) |
| `mapping(address => bool) awaitingFulfillment` | Field in deposit PDA | `[b"deposit", deposit_id_20_bytes]` | Packed struct |
| `mapping(address => bool) announced` | Field in deposit PDA | Same PDA | Packed struct |
| `mapping(address => address) depositors` | Field in deposit PDA | Same PDA | 32 bytes (Solana pubkey) |
| `uint256[4] pkMint` | Config PDA | `[b"config"]` | 128 bytes |
| `address mintAuthority` | Config PDA | Same | 32 bytes |

**Deposit PDA struct (Rust):**
```rust
#[account]
pub struct DepositState {
    pub awaiting_fulfillment: bool,
    pub announced: bool,
    pub depositor: Pubkey,
    pub blinded_point_b: [u64; 8], // BN254 G1 point, 2×256-bit as u64×4
    pub bump: u8,
}
```

**Rent:** Each PDA requires rent-exempt SOL deposit (~0.00089 SOL for a 100-byte account). For `deposit()`, the depositor pays rent + denomination. The Solana program should close the deposit PDA after `announce()` and refund the rent to the mint authority, keeping the denominator clean.

Nullifier PDAs are created at `redeem()` time and **never closed** (they must persist to prevent double-spend). Rent for a 1-byte PDA ≈ 0.00089 SOL — this is a permanent cost per token spent.

---

## 6. Transaction Size Constraints

Solana transactions are capped at **1,232 bytes**.

For `redeem()` instruction data:
- recipient pubkey: 32 bytes
- spend signature (secp256k1, 65 bytes): 65 bytes
- nullifier (20 bytes as Solana pubkey or bytes32): 32 bytes
- unblinded BLS signature S (BN254 G1, 2×32 bytes): 64 bytes
- **Total calldata: ~193 bytes** — well within limit

For `announce()` instruction data:
- deposit_id: 32 bytes
- S_prime (BN254 G1, 64 bytes): 64 bytes
- **Total: ~96 bytes** — trivial

No transaction size issues.

---

## 7. Client-Side Cryptography

The Python and TypeScript client libraries perform:
- G1 scalar mul: `B = r · H(spendAddr)` (blinding), `S = S' · r⁻¹` (unblinding)
- keccak256: seed derivation, H2C inner loop
- secp256k1: spend key derivation, ECDSA signing over redemption message

All of these work in existing browser/Node/Python environments unchanged. The Solana SDK (`@solana/web3.js`) and wallet adapters can be added without replacing the crypto layer.

The only client-side change: replace `viem` EVM-specific calls (sending transactions, ABI encoding) with `@solana/web3.js` transaction construction + Anchor IDL encoding. The cryptographic layer (`mcl-wasm`, `@noble/curves`) does not change.

---

## 8. Cost Comparison

| Protocol | Operation | Cost (USD, mainnet estimates) |
|----------|-----------|-------------------------------|
| NozKash on Avalanche | redeem | ~$0.002 |
| NozKash on Solana (optimistic, 250k CU, 1000 µL/CU) | redeem | ~$0.04 |
| NozKash on Solana (pessimistic, 1M CU, 1000 µL/CU) | redeem | ~$0.15 |
| Tornado Cash (Ethereum mainnet) | withdraw | ~$3–20 |
| zk-SNARK pool (Ethereum) | redeem | ~$5–50 |

**Key finding:** Even pessimistically, Solana NozKash is 20–100× cheaper than ZK privacy pools on Ethereum. The current EVM deployment on Avalanche is cheaper still, but Solana's ecosystem access (DeFi liquidity, Blink/Action integrations, Breakpoint audience) may justify the cost difference.

Priority fees spike during congestion. The privacy denomination must account for worst-case fees — a 0.01 SOL ($1.50) denomination makes more sense than 0.001 SOL if priority fees eat $0.15 per transaction during peak hours.

---

## 9. Key Risks and Unknowns

| Risk | Severity | Mitigation |
|------|----------|------------|
| BN254 pairing CU cost exceeds 1.4M | **Critical** | Benchmark on devnet before committing; use off-chain H2C to free budget |
| Solana validator version heterogeneity (BN254 syscall feature flag) | Medium | Syscall was activated mainnet — check feature gate status |
| Priority fee volatility makes denomination unpredictable | Medium | Fix denomination at a value that covers worst-case fees |
| secp256k1 nullifier incompatible with Phantom/Backpack (Ed25519) | Low | Nullifier key is derived internally, not the user's wallet key |
| Rent cost for nullifier PDAs accumulates over time | Low | Permanent ~$0.15 per spent token; acceptable for eCash use case |
| Anchor program size limit (800 kB) | Low | BN254 verifier will be large; use `program-deploy` with extended buffer |

---

## 10. Recommended Implementation Path

1. **Benchmark first.** Write a minimal Solana devnet program that calls `sol_alt_bn128_pairing` with a 2-pair 384-byte input and measure CU usage. This is a one-hour task that either confirms or kills the port.

2. **Off-chain H2C.** Pass `H(nullifier)` as instruction argument. Verify on-chain: `y² == x³ + 3 mod P` (single `sol_alt_bn128_group_op` or pure arithmetic). Eliminates modexp.

3. **Anchor framework.** Use Anchor for PDA management, IDL generation, and client-side type safety. The IDL replaces the ABI JSON.

4. **Keep crypto layer.** The Python/TypeScript BN254 library is chain-agnostic. Only the transaction submission and event scanning layers need rewriting.

5. **Denomination sizing.** Start at 0.01 SOL (~$1.50). Adjust down once priority fee behaviour under load is understood.

---

## 11. Verdict

**The NozKash blind-signature scheme is portable to Solana.** Every required cryptographic primitive has a Solana syscall equivalent or a clean Rust implementation path. The architecture maps naturally to PDAs. The single empirical gate is the BN254 pairing CU cost — if it fits below ~1M CU, the scheme works in a single transaction with standard priority fee budget. Given Light Protocol's Groth16 (3+ pairings) working on Solana, a 2-pair check is very likely feasible.

The cost will be higher than the Avalanche deployment but still orders of magnitude cheaper than any ZK-based privacy alternative on any chain.
