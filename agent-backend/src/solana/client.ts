import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const IDL = require("../lib/ghost_vault_idl.json");

const PROGRAM_ID = new PublicKey(
  "786pocjFvsLKLL4Ly5cYm2e5qsT4GMBvK21Cx97PWK1o"
);

function buildProvider(): anchor.AnchorProvider {
  const rpcUrl =
    process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const rawKp = process.env.RELAYER_KEYPAIR;
  if (!rawKp) throw new Error("RELAYER_KEYPAIR env var not set");
  const relayerKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(rawKp) as number[])
  );

  const wallet = new anchor.Wallet(relayerKp);
  return new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
}

// Singleton provider + program — built once at module load.
const provider = buildProvider();
anchor.setProvider(provider);
const program = new anchor.Program(IDL as anchor.Idl, provider);

const [mintStatePDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("state")],
  PROGRAM_ID
);
const [vaultPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault")],
  PROGRAM_ID
);

export const relayerPublicKey: PublicKey = (
  provider.wallet as anchor.Wallet
).payer.publicKey;

export async function callDeposit(
  depositId: Uint8Array,
  bBytes: Uint8Array
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (program.methods as any)
    .deposit(Array.from(depositId), Array.from(bBytes))
    .rpc();
}

export async function callAnnounce(
  depositId: Uint8Array,
  sPrimeBytes: Uint8Array
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (program.methods as any)
    .announce(Array.from(depositId), Array.from(sPrimeBytes))
    .rpc();
}

export async function callRedeem(
  recipient: PublicKey,
  sig65: Uint8Array,
  nullifier: Uint8Array,
  sBytes: Uint8Array,
  yBytes: Uint8Array
): Promise<string> {
  const [nullifierPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), Buffer.from(nullifier)],
    PROGRAM_ID
  );

  const relayerKp = (provider.wallet as anchor.Wallet).payer;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (program.methods as any)
    .redeem(
      recipient,
      Array.from(sig65),
      Array.from(nullifier),
      Array.from(sBytes),
      Array.from(yBytes)
    )
    .accounts({
      payer: relayerKp.publicKey,
      recipientAccount: recipient,
      mintState: mintStatePDA,
      vault: vaultPDA,
      nullifierRecord: nullifierPDA,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ])
    .rpc();
}
