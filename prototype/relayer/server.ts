import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import * as anchor from '@coral-xyz/anchor';
import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    ComputeBudgetProgram,
} from '@solana/web3.js';
import { readFileSync } from 'fs';
import * as path from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

const PORT         = parseInt(process.env.PORT || '3000', 10);
const RPC_URL      = process.env.RPC_URL || 'https://api.devnet.solana.com';
const KEYPAIR_PATH = (process.env.RELAYER_KEYPAIR_PATH || '~/.config/solana/id.json')
    .replace('~', process.env.HOME!);

const PROGRAM_ID = new PublicKey('786pocjFvsLKLL4Ly5cYm2e5qsT4GMBvK21Cx97PWK1o');

// ── Relayer wallet ────────────────────────────────────────────────────────────

const relayerKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, 'utf-8'))),
);
console.log(`Relayer wallet : ${relayerKp.publicKey.toBase58()}`);

// ── Anchor program client ─────────────────────────────────────────────────────

const connection = new Connection(RPC_URL, 'confirmed');
const wallet     = new anchor.Wallet(relayerKp);
const provider   = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
anchor.setProvider(provider);

const IDL_PATH = path.resolve(__dirname, '../target/idl/ghost_vault.json');
const idl      = JSON.parse(readFileSync(IDL_PATH, 'utf-8'));
const program  = new anchor.Program(idl, provider) as anchor.Program;

const [mintStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('state')],
    PROGRAM_ID,
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToU8(hex: string, expectedLen: number, fieldName: string): Uint8Array {
    const buf = Buffer.from(hex.replace(/^0x/, ''), 'hex');
    if (buf.length !== expectedLen) {
        throw new Error(`${fieldName} must be ${expectedLen} bytes, got ${buf.length}`);
    }
    return new Uint8Array(buf);
}

// ── Routes ────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

/**
 * GET /health
 * Returns relayer status and wallet address.
 */
app.get('/health', async (_req: Request, res: Response) => {
    const balance = await connection.getBalance(relayerKp.publicKey);
    res.json({
        status:  'ok',
        relayer: relayerKp.publicKey.toBase58(),
        balance: `${(balance / 1e9).toFixed(4)} SOL`,
        rpc:     RPC_URL,
    });
});

/**
 * POST /relay
 *
 * Accepts a fully-formed redeem payload from the user, builds the transaction
 * signed by the relayer wallet, and submits it to the network.
 *
 * The relayer is the `payer` — not the original depositor — so no on-chain
 * signature links the depositing wallet to this transaction.
 *
 * Body (all byte arrays as lowercase hex strings):
 * {
 *   recipient:     string  — base58 Solana pubkey of the destination wallet
 *   spend_sig:     string  — 65-byte ECDSA signature (r‖s‖v, v=27 or 28)
 *   nullifier:     string  — 20-byte spend address (hex)
 *   unblinded_sig: string  — 64-byte unblinded BLS signature S (hex)
 *   deposit_id:    string  — 20-byte blind address used as deposit PDA seed (hex)
 * }
 *
 * Response: { signature: string } or { error: string }
 */
app.post('/relay', async (req: Request, res: Response) => {
    try {
        const { recipient, spend_sig, nullifier, unblinded_sig, deposit_id } = req.body;

        // ── Validate presence ────────────────────────────────────────────────
        for (const [k, v] of Object.entries({ recipient, spend_sig, nullifier, unblinded_sig, deposit_id })) {
            if (!v) return res.status(400).json({ error: `Missing field: ${k}` }) as unknown as void;
        }

        // ── Decode fields ────────────────────────────────────────────────────
        let recipientPubkey: PublicKey;
        try { recipientPubkey = new PublicKey(recipient); }
        catch { return res.status(400).json({ error: 'Invalid recipient pubkey' }) as unknown as void; }

        const spendSigBytes    = hexToU8(spend_sig,     65, 'spend_sig');
        const nullifierBytes   = hexToU8(nullifier,     20, 'nullifier');
        const unblindedSigBytes = hexToU8(unblinded_sig, 64, 'unblinded_sig');
        const depositIdBytes   = hexToU8(deposit_id,    20, 'deposit_id');

        // ── Derive PDAs ──────────────────────────────────────────────────────
        const [depositPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from('deposit'), Buffer.from(depositIdBytes)],
            PROGRAM_ID,
        );
        const [nullifierPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from('nullifier'), Buffer.from(nullifierBytes)],
            PROGRAM_ID,
        );

        // ── Pre-flight checks ────────────────────────────────────────────────
        const depositAccount = await (program.account as any).depositRecord.fetch(depositPDA)
            .catch(() => null);
        if (!depositAccount) {
            return res.status(400).json({ error: 'Deposit account not found' }) as unknown as void;
        }
        if (depositAccount.state !== 1) {
            return res.status(400).json({
                error: `Deposit not in Announced state (state=${depositAccount.state})`,
            }) as unknown as void;
        }

        const nullifierInfo = await connection.getAccountInfo(nullifierPDA);
        if (nullifierInfo) {
            return res.status(409).json({ error: 'Nullifier already spent' }) as unknown as void;
        }

        // ── Relayer balance check ────────────────────────────────────────────
        const relayerBalance = await connection.getBalance(relayerKp.publicKey);
        if (relayerBalance < 5_000_000) { // 0.005 SOL minimum safety buffer
            return res.status(503).json({ error: 'Relayer wallet low on funds' }) as unknown as void;
        }

        // ── Build & submit ───────────────────────────────────────────────────
        console.log(`[relay] recipient=${recipient} nullifier=${nullifier}`);

        const signature = await (program.methods as any)
            .redeem(
                recipientPubkey,
                Array.from(spendSigBytes),
                Array.from(nullifierBytes),
                Array.from(unblindedSigBytes),
                Array.from(depositIdBytes),
            )
            .accounts({
                payer:            relayerKp.publicKey,  // ← relayer pays, not the user
                recipientAccount: recipientPubkey,
                mintState:        mintStatePDA,
                deposit:          depositPDA,
                nullifierRecord:  nullifierPDA,
                systemProgram:    SystemProgram.programId,
            })
            .preInstructions([
                ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
            ])
            .rpc();

        console.log(`[relay] done signature=${signature}`);
        res.json({ signature });

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[relay] error:', msg);
        res.status(500).json({ error: msg });
    }
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`GhostVault relayer listening on http://localhost:${PORT}`);
    console.log(`RPC: ${RPC_URL}`);
});
