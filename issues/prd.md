# PRD: NozKash Protocol End-to-End Prototype (Solana)

## Problem Statement

The NozKash protocol — a privacy-preserving eCash system using BLS blind signatures over BN254 — has been designed and partially implemented for EVM chains. A Solidity reference contract, Python reference library, and TypeScript crypto library exist and are cross-validated with test vectors. A partial Solana Anchor program exists with a working `redeem()` instruction and BN254 pairing syscall verified via benchmarks.

However, there is no end-to-end working prototype that exercises the complete flow — deposit → announce → redeem — on Solana. Without this, the protocol cannot be demonstrated or submitted for the Colosseum hackathon. The prototype must prove that the cryptographic operations (blind signing, unblinding, hash-to-curve, BLS pairing verification, ECDSA recovery) work correctly together inside a single Anchor test suite.

## Solution

Build a self-contained prototype Anchor workspace under `prototype/` that implements the full NozKash protocol on Solana with four instructions: `initialize`, `deposit`, `announce`, and `redeem`. Accompany it with a TypeScript Anchor test suite that exercises the complete deposit → announce → redeem flow end-to-end using an inline mint simulation. The prototype reuses proven crypto code from `nozkash/ts/` (copied in) and builds on the BN254 syscall patterns established in the existing `solana/` workspace.

## User Stories

1. As a developer, I want a single `anchor test` command to run the full deposit → announce → redeem flow, so that I can verify the protocol works on Solana without manual steps.
2. As a developer, I want the Anchor program to expose an `initialize` instruction, so that the mint BLS public key can be stored on-chain without recompiling the program.
3. As a developer, I want the Anchor program to expose a `deposit` instruction, so that a client can lock SOL and register a blinded point on-chain.
4. As a developer, I want the deposit instruction to store the blinded point B and deposited lamports in a single PDA, so that account management is simple and CU-efficient.
5. As a developer, I want the deposit PDA to be keyed by the 20-byte deposit ID (blind address), so that the mint can locate it deterministically without additional indexing.
6. As a developer, I want the Anchor program to expose an `announce` instruction, so that the mint can post the blind signature S' on-chain after observing a deposit.
7. As a developer, I want the `announce` instruction to be permissionless, so that any party (including the inline test mint) can submit a valid blind signature without a privileged signer check.
8. As a developer, I want the `redeem` instruction to verify the BLS pairing on-chain using the `sol_alt_bn128_group_op` syscall, so that only a signature from the mint's BLS key can unlock funds.
9. As a developer, I want the `redeem` instruction to verify the ECDSA spend signature using the `secp256k1_recover` syscall, so that only the holder of the spend private key can direct funds to a recipient.
10. As a developer, I want the `redeem` instruction to create a nullifier PDA, so that double-spend is prevented without a mutable mapping.
11. As a developer, I want the `redeem` instruction to close the deposit PDA and transfer all lamports to the recipient, so that no rent is left stranded on-chain.
12. As a developer, I want the fixed denomination to be 0.01 SOL per token, so that test wallets on localnet are not drained and the amount covers deposit PDA rent.
13. As a test author, I want the test to generate a fresh mint BLS keypair per run, so that key rotation is exercised and no hardcoded secrets exist in the repo.
14. As a test author, I want the mint's blind signing logic to be imported inline from a TypeScript module, so that the announce step is deterministic and requires no subprocess management.
15. As a test author, I want the test to derive token secrets (spend keypair, blind keypair, blinded point B) using the same algorithm as `nozkash/ts/ghost-library.ts`, so that cross-implementation parity is maintained.
16. As a test author, I want the test to unblind S' → S and locally verify the BLS pairing before submitting the redeem transaction, so that test failures are diagnosable at the crypto layer rather than only at the transaction layer.
17. As a test author, I want the test to verify the recipient's SOL balance increased by approximately 0.01 SOL after redeem, so that the end-to-end value transfer is confirmed.
18. As a test author, I want the test to verify that a second redeem with the same nullifier fails, so that double-spend prevention is exercised.
19. As a developer, I want `ghost-library.ts` and `bn254-crypto.ts` copied into the prototype's TypeScript directory, so that the prototype is fully self-contained with no cross-directory imports.
20. As a developer, I want the prototype to use `mcl-wasm` for BN254 operations in TypeScript (consistent with `nozkash/ts/`), so that the same proven library is used end-to-end.

## Implementation Decisions

### Modules

**1. Anchor Program (`prototype/programs/ghost_vault/`)**
- Single Rust crate with four instructions: `initialize`, `deposit`, `announce`, `redeem`
- Reuses the BN254 pairing syscall pattern from `solana/programs/ghost_vault/src/lib.rs`
- Reuses the `secp256k1_recover` syscall pattern from the same source
- Uses `solana/rust-toolchain.toml` and `solana/Cargo.toml` dependency versions as reference

**2. Program Account Structures**
- `MintState` account — stored at PDA `[b"state"]`. Fields: `mint_pk: [u8; 128]` (G2 BLS public key in EIP-197 limb order), `bump: u8`
- `Deposit` account — stored at PDA `[b"deposit", deposit_id: [u8; 20]]`. Fields: `blinded_point: [u8; 64]` (G1 point B), `mint_sig: [u8; 64]` (G1 point S', zeroed until announce), `state: u8` (0=Pending, 1=Announced), `bump: u8`. Also holds deposited lamports above rent-exemption
- `Nullifier` account — stored at PDA `[b"nullifier", nullifier: [u8; 20]]`. Fields: `bump: u8` only. Existence is the double-spend proof

**3. Instruction Interfaces**
- `initialize(mint_pk: [u8; 128])` — creates MintState PDA, called once per deployment
- `deposit(deposit_id: [u8; 20], blinded_point: [u8; 64])` — creates Deposit PDA, transfers 0.01 SOL from payer to PDA
- `announce(deposit_id: [u8; 20], mint_sig: [u8; 64])` — updates Deposit PDA: sets `mint_sig` and `state=Announced`. Permissionless
- `redeem(recipient: Pubkey, spend_sig: [u8; 65], nullifier: [u8; 20], unblinded_sig: [u8; 64])` — verifies ECDSA, verifies BLS pairing, creates Nullifier PDA, closes Deposit PDA, transfers lamports to recipient

**4. Redeem Verification Steps (in order)**
1. Recover signer address from ECDSA spend_sig over `keccak256("Pay to RAW: " || recipient_bytes)` using `secp256k1_recover` syscall
2. Assert recovered address == nullifier
3. Assert Deposit PDA state == Announced
4. Compute `Y = H(nullifier)` via try-and-increment hash-to-curve (keccak256-based, identical to EVM)
5. Verify BLS pairing: `e(unblinded_sig, G2_generator) == e(Y, mint_pk)` using `sol_alt_bn128_group_op` syscall with operation code 3
6. Create Nullifier PDA (fails if already exists — double-spend prevention)
7. Close Deposit PDA, transfer all lamports to recipient

**5. TypeScript Crypto Module (`prototype/ts/`)**
- `ghost-library.ts` — copied from `nozkash/ts/ghost-library.ts`. Token derivation, blinding, unblinding, hash-to-curve, spend signature generation
- `bn254-crypto.ts` — copied from `nozkash/ts/bn254-crypto.ts`. BN254 G1/G2 primitives, pairing, scalar ops via `mcl-wasm`
- `mint.ts` — new module. Encapsulates mint BLS keypair generation and blind signing: `generateMintKeypair()` → `{sk, pk}`, `blindSign(sk, B)` → `S_prime`

**6. Anchor Test Suite (`prototype/tests/ghost_vault.ts`)**
- Single test file with three clearly labelled phases per token: `// DEPOSIT`, `// ANNOUNCE`, `// REDEEM`
- Calls `initialize` once in `before()` hook
- Tests: (a) happy path full flow, (b) double-spend rejection

### Architectural Decisions

- `announce` is permissionless: BLS verification at redeem ensures only a valid mint signature passes. No Solana keypair check on the mint identity
- The G2 generator is hardcoded as a 128-byte constant in the Rust program (EIP-197 limb order), identical to the existing `solana/programs/ghost_vault/src/lib.rs`
- Hash-to-curve uses keccak256 try-and-increment (matching EVM), not the newer hash-to-curve standards, for cross-chain compatibility
- Token index for test vectors uses 4-byte big-endian encoding (DataView pattern from ghost-library.ts) to match Python reference
- Deposit PDA is closed (zeroed + lamports transferred) at redeem time; Nullifier PDA persists forever as the spent record

## Testing Decisions

**What makes a good test here:** Tests should assert observable on-chain state changes and SOL balance changes — not internal PDA layout or intermediate crypto values. Crypto correctness is a prerequisite verified locally in the test before submitting transactions; transaction-level tests assert that the program accepts/rejects correctly.

**Modules with tests:**

1. **Full flow (happy path)** — `initialize` → `deposit` → `announce` → `redeem`. Asserts: deposit PDA created, state transitions to Announced after announce, recipient balance increases ~0.01 SOL, deposit PDA closed, nullifier PDA exists after redeem.

2. **Double-spend rejection** — After a successful redeem, attempt a second redeem with the same nullifier. Asserts: transaction fails with a program error indicating the nullifier PDA already exists.

3. **Local crypto verification** — Before submitting redeem, test locally verifies `e(S, G2) == e(Y, mint_pk)` in TypeScript using mcl-wasm. This is a pre-flight assertion inside the test, not a separate test case. Ensures any pairing failure is caught at the TS layer with a clear error before hitting the program.

**Prior art:** The existing `solana/tests/ghost_vault.ts` and `solana/tests/bn254_bench.ts` provide reference patterns for Anchor test structure, PDA derivation in TypeScript, and BN254 input encoding for the syscall.

## Out of Scope

- Frontend / browser wallet UI
- Real async mint server (WebSocket event listener, HTTP API)
- Multi-denomination support
- Token batching or batch redeem
- Mint key rotation on-chain
- Merkle-tree anonymity set (timing correlation resistance beyond mint's non-logging assumption)
- Devnet or mainnet deployment
- MEV protection beyond the spend signature (e.g. private mempools)
- The Python client and mint server (`nozkash/py/`) — prototype is TypeScript-only
- EVM contract changes or cross-chain bridging

## Further Notes

- The BN254 pairing syscall (`sol_alt_bn128_group_op` with op code 3) was benchmarked in `solana/programs/bn254_bench/` at ~47k CU for a 2-pair check. The redeem instruction is expected to be well within the 200k CU per-instruction limit.
- The G2 public key is 128 bytes in EIP-197 limb order: `[X_imag, X_real, Y_imag, Y_real]`. `py_ecc` internal order is `FQ2([real, imag])` — conversion is required when generating test vectors from Python.
- `mcl-wasm` requires async initialization (`await mcl.init(mcl.BN254)`). The test `before()` hook must await this before any crypto calls.
- The spend signature `v` value uses `recovery_bit + 27` (EVM convention) in the Python/TS libraries but the Solana `secp256k1_recover` syscall expects `recovery_bit` directly (0 or 1). The Rust program must subtract 27 before calling the syscall.
- Token index encoding must use 4-byte big-endian (not native JS number) to match Python reference implementation — a known footgun documented in the existing TS library.
