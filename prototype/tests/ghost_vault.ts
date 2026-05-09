import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GhostVault } from "../target/types/ghost_vault.js";

describe("ghost_vault", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.GhostVault as Program<GhostVault>;

  it("placeholder — workspace wired up", async () => {
    // This test just asserts the program is loaded.
    // Real instruction tests are added in subsequent issues.
    const id = program.programId.toBase58();
    console.log("program id:", id);
  });
});
