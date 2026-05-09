import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import * as mcl from "mcl-wasm";
import { GhostVault } from "../target/types/ghost_vault";
import { generateMintKeypair, serializeG2, serializeG1, blindSign } from "../ts/mint";
import { initBN254 } from "../ts/bn254-crypto";
import * as gl from "../ts/ghost-library";

const DENOMINATION = 10_000_000; // 0.01 SOL
const DEPOSIT_ACCOUNT_SIZE = 8 + 64 + 64 + 1 + 1; // discriminator + DepositRecord

// Master seed and token index shared across deposit / announce tests
const MASTER_SEED = Buffer.from("test_master_seed_003");
const TOKEN_INDEX = 0;

describe("ghost_vault", () => {
    anchor.setProvider(anchor.AnchorProvider.env());
    const program = anchor.workspace.GhostVault as Program<GhostVault>;
    const provider = anchor.getProvider() as anchor.AnchorProvider;

    const [mintStatePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId,
    );

    // Shared mint sk — set during the initialize test, used in announce test
    let mintSk: mcl.Fr;

    before(async () => {
        await initBN254();
    });

    // ── initialize ────────────────────────────────────────────────────────────

    it("initialize stores the mint BLS public key in the MintState PDA", async () => {
        const { sk, pk } = generateMintKeypair();
        mintSk = sk;
        const pkBytes = serializeG2(pk);

        await program.methods
            .initialize(Array.from(pkBytes))
            .rpc();

        const state = await program.account.mintState.fetch(mintStatePDA);
        assert.deepEqual(Array.from(state.mintPk), Array.from(pkBytes));
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
    });

    // ── deposit ───────────────────────────────────────────────────────────────

    it("deposit creates PDA with blinded point, Pending state, and correct lamport balance", async () => {
        const secrets = gl.deriveTokenSecrets(MASTER_SEED, TOKEN_INDEX);
        const depositId = secrets.blind.addressBytes;
        const r = gl.getR(secrets);
        const { B } = gl.blindToken(secrets.spend.addressBytes, r);
        const bBytes = serializeG1(B);

        const [depositPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("deposit"), depositId],
            program.programId,
        );

        await program.methods
            .deposit(Array.from(depositId), Array.from(bBytes))
            .rpc();

        const record = await program.account.depositRecord.fetch(depositPDA);
        assert.equal(record.state, 0, "state should be Pending (0)");
        assert.deepEqual(Array.from(record.blindedPoint), Array.from(bBytes));
        assert.deepEqual(Array.from(record.mintSig), Array(64).fill(0));

        const rentExemption = await provider.connection.getMinimumBalanceForRentExemption(
            DEPOSIT_ACCOUNT_SIZE,
        );
        const accountInfo = await provider.connection.getAccountInfo(depositPDA);
        assert.equal(
            accountInfo!.lamports,
            rentExemption + DENOMINATION,
            "lamports should equal rent-exemption + 0.01 SOL",
        );
    });

    it("deposit fails when the same deposit ID is used twice", async () => {
        const secrets = gl.deriveTokenSecrets(MASTER_SEED, TOKEN_INDEX);
        const depositId = secrets.blind.addressBytes;
        const { B } = gl.blindToken(secrets.spend.addressBytes, gl.getR(secrets));
        const bBytes = serializeG1(B);

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
        const secrets = gl.deriveTokenSecrets(MASTER_SEED, TOKEN_INDEX);
        const depositId = secrets.blind.addressBytes;
        const r = gl.getR(secrets);
        const { B } = gl.blindToken(secrets.spend.addressBytes, r);

        const sPrime = blindSign(mintSk, B);
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
        const secrets = gl.deriveTokenSecrets(MASTER_SEED, TOKEN_INDEX);
        const depositId = secrets.blind.addressBytes;
        const { B } = gl.blindToken(secrets.spend.addressBytes, gl.getR(secrets));
        const sPrime = blindSign(mintSk, B);
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
});
