import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  Transaction,
} from "@solana/web3.js";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const IDL = require("../lib/ghost_vault_idl.json");

const PROGRAM_ID = new PublicKey(
  "786pocjFvsLKLL4Ly5cYm2e5qsT4GMBvK21Cx97PWK1o"
);

const [mintStatePDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("state")],
  PROGRAM_ID
);
const [vaultPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault")],
  PROGRAM_ID
);

function buildProvider(keypair: Keypair): anchor.AnchorProvider {
  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 120_000,
  });
  const wallet = new anchor.Wallet(keypair);
  return new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    skipPreflight: true,
    preflightCommitment: "processed",
  });
}

function buildProgram(keypair: Keypair): anchor.Program {
  const provider = buildProvider(keypair);
  return new anchor.Program(IDL as anchor.Idl, provider);
}

export function loadRelayerKeypair(): Keypair {
  const raw = process.env.RELAYER_KEYPAIR;
  if (!raw) throw new Error("RELAYER_KEYPAIR env var not set");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}

export function loadMintKeypair(): Keypair {
  const raw = process.env.MINT_KEYPAIR;
  if (!raw) throw new Error("MINT_KEYPAIR env var not set");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}

export async function callDeposit(
  agentKeypair: Keypair,
  relayerKeypair: Keypair,
  depositId: Uint8Array,
  bBytes: Uint8Array
): Promise<string> {
  const program = buildProgram(agentKeypair);
  const provider = program.provider as anchor.AnchorProvider;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ix = await (program.methods as any)
    .deposit(Array.from(depositId), Array.from(bBytes))
    .instruction();

  const tx = new Transaction();
  tx.add(ix);
  tx.feePayer = relayerKeypair.publicKey;
  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const signature = await provider.connection.sendTransaction(
    tx,
    [relayerKeypair, agentKeypair],
    { skipPreflight: true }
  );

  try {
    await provider.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed"
    );
  } catch {
    // Confirmation polling timed out — signature still valid.
  }

  return signature;
}

export async function callAnnounce(
  mintKeypair: Keypair,
  depositId: Uint8Array,
  sPrimeBytes: Uint8Array
): Promise<string> {
  const program = buildProgram(mintKeypair);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (program.methods as any)
    .announce(Array.from(depositId), Array.from(sPrimeBytes))
    .rpc();
}

export async function callRedeem(
  relayerKeypair: Keypair,
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

  const provider = buildProvider(relayerKeypair);
  const program = new anchor.Program(IDL as anchor.Idl, provider);

  // Build, send, then confirm separately so we always capture the signature
  // even when devnet confirmation polling times out after submission.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = await (program.methods as any)
    .redeem(
      recipient,
      Array.from(sig65),
      Array.from(nullifier),
      Array.from(sBytes),
      Array.from(yBytes)
    )
    .accounts({
      payer: relayerKeypair.publicKey,
      recipientAccount: recipient,
      mintState: mintStatePDA,
      vault: vaultPDA,
      nullifierRecord: nullifierPDA,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ])
    .transaction();

  const signature = await provider.connection.sendTransaction(tx, [relayerKeypair], {
    skipPreflight: true,
  });

  try {
    const latestBlockhash = await provider.connection.getLatestBlockhash("confirmed");
    await provider.connection.confirmTransaction(
      { signature, ...latestBlockhash },
      "confirmed"
    );
  } catch {
    // Confirmation polling timed out but tx was already submitted — signature is valid.
  }

  return signature;
}
