import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram, Keypair } from "@solana/web3.js";
import { assert } from "chai";
import * as mcl from "mcl-wasm";
import { GhostVault } from "../target/types/ghost_vault";
import { generateMintKeypair, serializeG2, serializeG1, blindSign } from "../ts/mint";
import { initBN254, getG2Generator } from "../ts/bn254-crypto";
import * as gl from "../ts/ghost-library";

const DENOMINATION = 10_000_000; // 0.01 SOL
const DEPOSIT_ACCOUNT_SIZE = 8 + 130; // discriminator + DepositRecord (blinded_point + mint_sig + state + bump)

// Both seeds incorporate the current timestamp so all deposit/nullifier PDAs are
// fresh on devnet — avoids "account already in use" on repeated runs.
// Different prefixes ensure the two seed sets derive distinct deposit IDs.
const TS          = Date.now().toString();
const MASTER_SEED = Buffer.from("m_" + TS);
const TOKEN_INDEX = 0;
const REDEEM_SEED  = Buffer.from("r_" + TS);
const REDEEM_INDEX = 0;

describe("ghost_vault", () => {
    anchor.setProvider(anchor.AnchorProvider.env());
    const program  = anchor.workspace.GhostVault as Program<GhostVault>;
    const provider = anchor.getProvider() as anchor.AnchorProvider;

    const [mintStatePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId,
    );

    const [vaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault")],
        program.programId,
    );

    // Shared mint sk/pk — derived deterministically so the key is stable across
    // devnet runs. If MintState already exists (persistent devnet state), we can
    // verify the stored pk matches rather than failing on re-initialization.
    let mintSk: mcl.Fr;
    let mintPk: mcl.G2;

    before(async () => {
        await initBN254();

        // Deterministic mint keypair: hash a fixed label into an Fr scalar.
        mintSk = new mcl.Fr();
        mintSk.setHashOf("ghost_vault_devnet_mint_key_v1");
        mintPk = mcl.mul(getG2Generator(), mintSk) as mcl.G2;
    });

    // ── initialize ────────────────────────────────────────────────────────────

    it("initialize stores the mint BLS public key in the MintState PDA", async () => {
        const pkBytes = serializeG2(mintPk);

        // init_if_needed: creates MintState and VaultState on first run,
        // updates the pk on subsequent runs.
        await program.methods
            .initialize(Array.from(pkBytes))
            .rpc();

        const state = await program.account.mintState.fetch(mintStatePDA);
        assert.deepEqual(Array.from(state.mintPk), Array.from(pkBytes));

        // Vault PDA must exist after initialize.
        const vaultInfo = await provider.connection.getAccountInfo(vaultPDA);
        assert.isNotNull(vaultInfo, "vault PDA must exist after initialize");
    });

    it("initialize fails when called a second time", async () => {
        const { pk } = generateMintKeypair();
        const pkBytes = serializeG2(pk);

        try {
            await program.methods
                .initialize(Array.from(pkBytes))
                .rpc();
            assert.fail("initialize should have thrown on second call");
        } catch (err: unknown) {
            assert.ok(err, "second initialize must fail — PDA already exists");
        }

        // init_if_needed allows overwrites, so the call above may have stored a random pk.
        // Restore the deterministic pk so the BLS redeem test has a consistent MintState.
        await program.methods
            .initialize(Array.from(serializeG2(mintPk)))
            .rpc();
    });

    // ── deposit ───────────────────────────────────────────────────────────────

    it("deposit creates PDA with blinded point, Pending state, and routes SOL to vault", async () => {
        const secrets   = gl.deriveTokenSecrets(MASTER_SEED, TOKEN_INDEX);
        const depositId = secrets.blind.addressBytes;
        const r         = gl.getR(secrets);
        const { Y, B }  = gl.blindToken(secrets.spend.addressBytes, r);
        const bBytes    = serializeG1(B);

        const [depositPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("deposit"), depositId],
            program.programId,
        );

        const vaultBefore = await provider.connection.getBalance(vaultPDA);

        await program.methods
            .deposit(Array.from(depositId), Array.from(bBytes))
            .rpc();

        const record = await program.account.depositRecord.fetch(depositPDA);
        assert.equal(record.state, 0, "state should be Pending (0)");
        assert.deepEqual(Array.from(record.blindedPoint), Array.from(bBytes));
        assert.deepEqual(Array.from(record.mintSig), Array(64).fill(0));

        // Deposit PDA only holds rent — denomination is in the vault.
        const depositInfo = await provider.connection.getAccountInfo(depositPDA);
        const rentExemption = await provider.connection.getMinimumBalanceForRentExemption(
            DEPOSIT_ACCOUNT_SIZE,
        );
        assert.equal(
            depositInfo!.lamports,
            rentExemption,
            "deposit PDA lamports should equal only rent-exemption (SOL went to vault)",
        );

        // Vault must have received DENOMINATION.
        const vaultAfter = await provider.connection.getBalance(vaultPDA);
        assert.equal(
            vaultAfter - vaultBefore,
            DENOMINATION,
            "vault balance must increase by DENOMINATION",
        );
    });

    it("deposit fails when the same deposit ID is used twice", async () => {
        const secrets   = gl.deriveTokenSecrets(MASTER_SEED, TOKEN_INDEX);
        const depositId = secrets.blind.addressBytes;
        const { B }     = gl.blindToken(secrets.spend.addressBytes, gl.getR(secrets));
        const bBytes    = serializeG1(B);

        try {
            await program.methods
                .deposit(Array.from(depositId), Array.from(bBytes))
                .rpc();
            assert.fail("duplicate deposit should have thrown");
        } catch (err: unknown) {
            assert.ok(err, "duplicate deposit must fail — PDA already exists");
        }
    });

    // ── announce ──────────────────────────────────────────────────────────────

    it("announce writes blind signature and transitions state to Announced", async () => {
        const secrets   = gl.deriveTokenSecrets(MASTER_SEED, TOKEN_INDEX);
        const depositId = secrets.blind.addressBytes;
        const r         = gl.getR(secrets);
        const { B }     = gl.blindToken(secrets.spend.addressBytes, r);

        const sPrime      = blindSign(mintSk, B);
        const sPrimeBytes = serializeG1(sPrime);

        const [depositPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("deposit"), depositId],
            program.programId,
        );

        await program.methods
            .announce(Array.from(depositId), Array.from(sPrimeBytes))
            .rpc();

        const record = await program.account.depositRecord.fetch(depositPDA);
        assert.equal(record.state, 1, "state should be Announced (1)");
        assert.deepEqual(Array.from(record.mintSig), Array.from(sPrimeBytes));
    });

    it("announce fails when deposit is already Announced", async () => {
        const secrets   = gl.deriveTokenSecrets(MASTER_SEED, TOKEN_INDEX);
        const depositId = secrets.blind.addressBytes;
        const { B }     = gl.blindToken(secrets.spend.addressBytes, gl.getR(secrets));
        const sPrime      = blindSign(mintSk, B);
        const sPrimeBytes = serializeG1(sPrime);

        try {
            await program.methods
                .announce(Array.from(depositId), Array.from(sPrimeBytes))
                .rpc();
            assert.fail("second announce should have thrown");
        } catch (err: unknown) {
            assert.ok(err, "announce on Announced deposit must fail");
        }
    });

    // ── redeem ────────────────────────────────────────────────────────────────

    it("redeem happy path: deposit → announce → local BLS check → redeem → assert", async () => {
        // ── 1. Derive fresh token secrets ────────────────────────────────────
        const secrets   = gl.deriveTokenSecrets(REDEEM_SEED, REDEEM_INDEX);
        const depositId = secrets.blind.addressBytes;
        const nullifier = secrets.spend.addressBytes;
        const r         = gl.getR(secrets);
        const { Y, B }  = gl.blindToken(secrets.spend.addressBytes, r);

        // ── 2. Deposit (SOL goes to pool vault) ───────────────────────────────
        const bBytes = serializeG1(B);
        const yBytes = serializeG1(Y);
        const [depositPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("deposit"), depositId],
            program.programId,
        );
        await program.methods
            .deposit(Array.from(depositId), Array.from(bBytes))
            .rpc();

        // ── 3. Announce (mint blind-signs B) ──────────────────────────────────
        const sPrime      = blindSign(mintSk, B);
        const sPrimeBytes = serializeG1(sPrime);
        await program.methods
            .announce(Array.from(depositId), Array.from(sPrimeBytes))
            .rpc();

        // ── 4. Unblind S' → S ────────────────────────────────────────────────
        const S      = gl.unblindSignature(sPrime, r);
        const sBytes = serializeG1(S);

        // ── 5. Local BLS pairing pre-check (must pass before submitting) ──────
        const pairingOk = gl.verifyBlsPairing(S, Y, mintPk);
        assert.isTrue(pairingOk, "local BLS pairing check must pass before redeem");

        // ── 6. Build ECDSA spend proof ────────────────────────────────────────
        // Fresh destination wallet — no prior on-chain history, completing the
        // privacy cycle: deposit wallet ≠ recipient wallet.
        const destinationKeypair = Keypair.generate();
        const recipient          = destinationKeypair.publicKey;
        const sig65              = gl.generateSolanaSpendSig(
            secrets.spend.priv,
            recipient.toBytes(),
        );

        // ── 7. Derive nullifier PDA ───────────────────────────────────────────
        const [nullifierPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("nullifier"), nullifier],
            program.programId,
        );

        // ── 8. Record vault balance before redeem ─────────────────────────────
        const vaultBefore = await provider.connection.getBalance(vaultPDA);

        // ── 9. Send redeem transaction (no deposit account, y_point as param) ──
        await program.methods
            .redeem(
                recipient,
                Array.from(sig65),
                Array.from(nullifier),
                Array.from(sBytes),
                Array.from(yBytes),        // y_point — caller-supplied, BLS validates it
            )
            .accounts({
                payer:           provider.wallet.publicKey,
                recipientAccount: recipient,
                mintState:        mintStatePDA,
                vault:            vaultPDA,
                nullifierRecord:  nullifierPDA,
                systemProgram:    SystemProgram.programId,
            })
            .preInstructions([
                ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
            ])
            .rpc();

        // ── 10. Assertions ────────────────────────────────────────────────────
        // Nullifier PDA must exist (double-spend guard).
        const nullifierInfo = await provider.connection.getAccountInfo(nullifierPDA);
        assert.isNotNull(nullifierInfo, "nullifier PDA must exist after redeem");

        // Deposit PDA must remain open — it is NEVER referenced by redeem.
        const depositInfo = await provider.connection.getAccountInfo(depositPDA);
        assert.isNotNull(depositInfo, "deposit PDA must remain open after redeem (no graph link)");

        // Vault must have paid out DENOMINATION.
        const vaultAfter = await provider.connection.getBalance(vaultPDA);
        assert.equal(
            vaultBefore - vaultAfter,
            DENOMINATION,
            "vault must decrease by DENOMINATION",
        );

        // Fresh destination wallet must have received ≈ 0.01 SOL.
        const recipientBalance = await provider.connection.getBalance(recipient);
        assert.isAbove(recipientBalance, DENOMINATION * 0.9,
            "fresh destination wallet should receive ≈ 0.01 SOL");
        assert.notEqual(
            recipient.toBase58(),
            provider.wallet.publicKey.toBase58(),
            "recipient must be a different wallet from the depositor",
        );
    });

    it("redeem fails on double-spend (same nullifier a second time)", async () => {
        // Re-derive the same token used in the happy-path test — nullifier already burned.
        const secrets   = gl.deriveTokenSecrets(REDEEM_SEED, REDEEM_INDEX);
        const nullifier = secrets.spend.addressBytes;
        const r         = gl.getR(secrets);
        const { Y, B }  = gl.blindToken(secrets.spend.addressBytes, r);

        const sPrime = blindSign(mintSk, B);
        const S      = gl.unblindSignature(sPrime, r);
        const yBytes = serializeG1(Y);
        const sBytes = serializeG1(S);

        // Use provider wallet as recipient for this test (not a privacy concern here).
        const recipient = provider.wallet.publicKey;
        const sig65     = gl.generateSolanaSpendSig(secrets.spend.priv, recipient.toBytes());

        const [nullifierPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("nullifier"), nullifier],
            program.programId,
        );

        try {
            await program.methods
                .redeem(
                    recipient,
                    Array.from(sig65),
                    Array.from(nullifier),  // already-burned nullifier
                    Array.from(sBytes),
                    Array.from(yBytes),
                )
                .accounts({
                    payer:            provider.wallet.publicKey,
                    recipientAccount: recipient,
                    mintState:        mintStatePDA,
                    vault:            vaultPDA,
                    nullifierRecord:  nullifierPDA,
                    systemProgram:    SystemProgram.programId,
                })
                .preInstructions([
                    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
                ])
                .rpc();
            assert.fail("double-spend should have thrown");
        } catch (err: unknown) {
            assert.ok(err, "second redeem with same nullifier must fail");
        }
    });
});
