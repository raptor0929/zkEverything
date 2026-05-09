import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GhostVault } from "../target/types/ghost_vault";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

// G2 generator (EIP-197 format, 128 bytes) — mirrors GhostVault.sol _g2Gen()
const G2_GEN = Buffer.from(
  "198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2" +
  "1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed" +
  "090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b" +
  "12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa",
  "hex"
);

describe("ghost_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.GhostVault as Program<GhostVault>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );

  it("initialize: creates config PDA with G2_gen as pk_mint", async () => {
    await program.methods
      .initialize([...G2_GEN] as any)
      .accounts({ config: configPda, vault: vaultPda })
      .rpc({ commitment: "confirmed" });

    const cfg = await program.account.config.fetch(configPda);
    console.log("\n  config PDA:", configPda.toBase58());
    console.log("  vault PDA:", vaultPda.toBase58());
    console.log("  pk_mint[0]:", cfg.pkMint[0]); // should be 0x19 = 25
  });

  it("bench_redeem: full redeem pipeline CU (CU limit = 1.4M)", async () => {
    // Fund the vault so the SOL transfer can execute
    const fundTx = await provider.connection.requestAirdrop(
      vaultPda,
      0.05 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(fundTx, "confirmed");

    // Dummy inputs — crypto won't verify but CU is identical to valid inputs
    const recipient = Keypair.generate().publicKey;
    const nullifier = new Uint8Array(20).fill(0xab);
    const sigR = new Uint8Array(32).fill(1);
    const sigS = new Uint8Array(32).fill(2);
    const sigV = 0;
    const g1X = new Uint8Array(32); g1X[31] = 1;
    const g1Y = new Uint8Array(32); g1Y[31] = 2;
    const blsS = [...g1X, ...g1Y];
    const hNullifier = [...g1X, ...g1Y];

    const maxCuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const tx = await program.methods
      .benchRedeem(
        recipient,
        [...nullifier],
        [...sigR],
        [...sigS],
        sigV,
        blsS,
        hNullifier
      )
      .accounts({
        recipient,
        config: configPda,
        vault: vaultPda,
      })
      .preInstructions([maxCuIx])
      .rpc({ commitment: "confirmed" });

    const details = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    printMetrics("bench_redeem (full pipeline)", details);
  });
});

function printMetrics(label: string, details: any) {
  const logs: string[] = details?.meta?.logMessages ?? [];
  const cuConsumed: number = details?.meta?.computeUnitsConsumed ?? 0;

  console.log(`\n═══ ${label} ═══`);
  console.log(`  cu_total (tx): ${cuConsumed}`);
  console.log(`  fits under 1.4M CU: ${cuConsumed <= 1_400_000}`);

  const noteLines = logs.filter(
    (l) => l.includes("pairing_result:") || l.includes("pairing_syscall_ret:")
  );
  noteLines.forEach((l) => {
    const m = l.match(/Program log: (.*)/);
    if (m) console.log(`  ${m[1]}`);
  });
}
