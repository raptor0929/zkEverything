import { randomBytes } from "crypto";
import { PublicKey } from "@solana/web3.js";
import * as mcl from "mcl-wasm";
import { bn254Ready } from "../lib/bn254-init";
import { serializeG1 } from "../lib/mint";
import * as gl from "../lib/ghost-library";
import { callDeposit, callAnnounce, callRedeem } from "../solana/client";
import { mapError } from "../solana/errors";

function loadMintSk(): mcl.Fr {
  const hex = process.env.MINT_SK;
  if (!hex) throw new Error("MINT_SK env var not set");
  const fr = new mcl.Fr();
  fr.setStr(hex.replace(/^0x/, ""), 16);
  return fr;
}

async function runPaymentFlow(
  recipientB58: string
): Promise<{ signature: string }> {
  await bn254Ready;

  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = new PublicKey(recipientB58);
  } catch {
    throw new Error("Invalid recipient pubkey");
  }

  const masterSeed = new Uint8Array(randomBytes(32));
  const secrets = gl.deriveTokenSecrets(masterSeed, 0);
  const depositId = secrets.blind.addressBytes;
  const nullifier = secrets.spend.addressBytes;
  const r = gl.getR(secrets);
  const { Y, B } = gl.blindToken(secrets.spend.addressBytes, r);

  const bBytes = serializeG1(B);
  await callDeposit(depositId, bBytes);

  const mintSk = loadMintSk();
  const sPrime = mcl.mul(B, mintSk) as mcl.G1;
  const sPrimeBytes = serializeG1(sPrime);
  await callAnnounce(depositId, sPrimeBytes);

  const S = gl.unblindSignature(sPrime, r);
  const sBytes = serializeG1(S);
  const yBytes = serializeG1(Y);
  const sig65 = gl.generateSolanaSpendSig(
    secrets.spend.priv,
    recipientPubkey.toBytes()
  );

  const signature = await callRedeem(
    recipientPubkey,
    sig65,
    nullifier,
    sBytes,
    yBytes
  );

  return { signature };
}

export async function sendPrivatePayment(
  recipientB58: string
): Promise<{ signature: string } | { error: string }> {
  try {
    return await runPaymentFlow(recipientB58);
  } catch (err) {
    console.error("[send-private-payment]", err);
    return { error: mapError(err) };
  }
}
