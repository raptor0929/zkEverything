import { Router, Request, Response } from "express";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { getSupabaseAdmin } from "./supabase";
import { encrypt } from "./crypto";

const router = Router();

function getEncryptionKey(): Buffer {
  const hex = process.env.AGENT_ENCRYPTION_KEY;
  if (!hex) throw new Error("AGENT_ENCRYPTION_KEY not set");
  return Buffer.from(hex, "hex");
}

router.post("/create", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const supabase = getSupabaseAdmin();
  const key = getEncryptionKey();

  // Return existing agent if one already exists (upsert semantics)
  const { data: existing } = await supabase
    .from("agents")
    .select("pubkey")
    .eq("user_id", userId)
    .single();

  if (existing) {
    res.json({ pubkey: existing.pubkey });
    return;
  }

  const keypair = Keypair.generate();
  const encryptedKeypair = encrypt(Buffer.from(keypair.secretKey), key);
  const pubkey = keypair.publicKey.toBase58();

  const { error } = await supabase.from("agents").upsert(
    { user_id: userId, encrypted_keypair: encryptedKeypair, pubkey },
    { onConflict: "user_id" }
  );

  if (error) {
    res.status(500).json({ error: "Failed to create agent" });
    return;
  }

  res.json({ pubkey });
});

router.get("/balance", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("agents")
    .select("pubkey")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  const lamports = await connection.getBalance(new PublicKey(data.pubkey));
  res.json({ lamports });
});

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("agents")
    .select("pubkey")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  res.json({ pubkey: data.pubkey });
});

export { router as agentRouter };
