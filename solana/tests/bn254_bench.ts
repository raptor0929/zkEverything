import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Bn254Bench } from "../target/types/bn254_bench";
import { ComputeBudgetProgram } from "@solana/web3.js";

// G1 generator: x=1, y=2 (BN254, big-endian 32 bytes each)
function g1Gen(): number[] {
  const x = new Uint8Array(32);
  x[31] = 1;
  const y = new Uint8Array(32);
  y[31] = 2;
  return [...x, ...y];
}

// G1 generator negated: x=1, y=P-2 (mod P)
// P = 21888242871839275222246405745257275088696311157297823662689037894645226208583
function g1GenNeg(): number[] {
  const x = new Uint8Array(32);
  x[31] = 1;
  const pMinus2 = Buffer.from(
    "30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd45",
    "hex"
  );
  return [...x, ...pMinus2];
}

describe("bn254_bench", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Bn254Bench as Program<Bn254Bench>;

  it("bench_pairing: 2-pair BN254 pairing CU (CU limit = 1.4M)", async () => {
    const maxCuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const tx = await program.methods
      .benchPairing(g1Gen(), g1GenNeg())
      .preInstructions([maxCuIx])
      .rpc({ commitment: "confirmed" });

    const details = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    printMetrics("bench_pairing (2-pair BN254)", details);
  });

  it("bench_g1_mul: BN254 G1 scalar multiplication CU (CU limit = 200k)", async () => {
    const maxCuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
    const scalar = new Uint8Array(32);
    scalar[31] = 7;

    const tx = await program.methods
      .benchG1Mul(g1Gen(), [...scalar])
      .preInstructions([maxCuIx])
      .rpc({ commitment: "confirmed" });

    const details = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    printMetrics("bench_g1_mul (G1 scalar mul)", details);
  });
});

function printMetrics(label: string, details: any) {
  const logs: string[] = details?.meta?.logMessages ?? [];
  const cuConsumed: number = details?.meta?.computeUnitsConsumed ?? 0;

  console.log(`\n═══ ${label} ═══`);
  console.log(`  cu_total (tx): ${cuConsumed}`);

  const noteLines = logs.filter((l) => l.includes("pairing_result") || l.includes("cu_label"));
  noteLines.forEach((l) => {
    const m = l.match(/Program log: (.*)/);
    if (m) console.log(`  ${m[1]}`);
  });
}
