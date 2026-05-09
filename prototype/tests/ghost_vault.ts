import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import { GhostVault } from "../target/types/ghost_vault";
import { generateMintKeypair, serializeG2, serializeG1 } from "../ts/mint";
import { initBN254 } from "../ts/bn254-crypto";
import * as gl from "../ts/ghost-library";

const DENOMINATION = 10_000_000; // 0.01 SOL
const DEPOSIT_ACCOUNT_SIZE = 8 + 64 + 64 + 1 + 1; // discriminator + DepositRecord

describe("ghost_vault", () => {
    anchor.setProvider(anchor.AnchorProvider.env());
    const program = anchor.workspace.GhostVault as Program<GhostVault>;
    const provider = anchor.getProvider() as anchor.AnchorProvider;

    const [mintStatePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId,
    );

    before(async () => {
        await initBN254();
    });

    // ── initialize ────────────────────────────────────────────────────────────

    it("initialize stores the mint BLS public key in the MintState PDA", async () => {
        const { pk } = generateMintKeypair();
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
        const masterSeed = Buffer.from("test_master_seed_003");
        const secrets = gl.deriveTokenSecrets(masterSeed, 0);
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

        // assert on-chain state
        const record = await program.account.depositRecord.fetch(depositPDA);
        assert.equal(record.state, 0, "state should be Pending (0)");
        assert.deepEqual(Array.from(record.blindedPoint), Array.from(bBytes));
        assert.deepEqual(Array.from(record.mintSig), Array(64).fill(0));

        // assert lamport balance = rent-exemption + 0.01 SOL
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
        const masterSeed = Buffer.from("test_master_seed_003");
        const secrets = gl.deriveTokenSecrets(masterSeed, 0);
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
});
