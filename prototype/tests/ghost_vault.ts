import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import { GhostVault } from "../target/types/ghost_vault";
import { generateMintKeypair, serializeG2 } from "../ts/mint";
import { initBN254 } from "../ts/bn254-crypto";

describe("ghost_vault", () => {
    anchor.setProvider(anchor.AnchorProvider.env());
    const program = anchor.workspace.GhostVault as Program<GhostVault>;

    const [mintStatePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId,
    );

    before(async () => {
        await initBN254();
    });

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
});
