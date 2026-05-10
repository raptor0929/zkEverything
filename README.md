# zkEverything

> Privacy-preserving SOL transfers on Solana devnet, powered by BLS blind signatures and an AI chat agent.

Send SOL to any address without leaving an on-chain link between your deposit and the recipient. No ZK circuits. No trusted custodian. Under $0.15 per transfer.

---

## How it works

1. **Register** with email and password — an encrypted Solana keypair (your "agent wallet") is created and stored for you.
2. **Tell the agent** who you want to pay and how much.
3. **Fund your agent wallet** with the requested amount.
4. **The agent executes** a 3-step private transfer automatically:
   - `deposit` — your agent locks SOL in the shared vault pool
   - `announce` — a blind signature is posted on-chain (cryptographically hides which deposit this is for)
   - `redeem` — the relayer transfers SOL to the recipient with no on-chain link to your deposit
5. **Done** — view the transaction on Solscan.

The deposit address and the recipient address share no common on-chain field. An observer cannot link them without your private master seed.

---

## Privacy guarantee

zkEverything uses **BLS blind signatures over BN254**:

- You blind a token before the mint signs it — the mint signs without seeing which deposit it corresponds to.
- You unblind the signature and use it to redeem to any address.
- On-chain: two independent transactions. Off-chain: a cryptographic proof of validity.

No ZK proofs, no circuits, no trusted setup. Only standard Solana syscalls.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, Vercel AI SDK (`useChat`) |
| Backend | Express, TypeScript, OpenAI GPT-4o-mini |
| Auth & DB | Supabase (email/password, agents table) |
| Blockchain | Solana devnet, Anchor, BN254 via `sol_alt_bn128_group_op` |
| Crypto | mcl-wasm (BN254), @noble/secp256k1, AES-256-GCM |

---

## Project structure

```
zkEverything/
├── agent-ui/          Next.js chat frontend
├── agent-backend/     Express API + AI agent + payment logic
├── prototype/         Anchor workspace (deployed Solana program source)
├── architecture/      Architecture diagrams
├── assets/            Brand assets
├── docs/              Research and drafts
└── issues/            Feature specs (PRDs)
```

---

## Running locally

### Prerequisites

- Node.js 20+
- A Supabase project with:
  - Email/password auth enabled, email confirmation **disabled**
  - `agents` table (see below)
  - `zkUsers` table (see below)
- An OpenAI API key
- A funded Solana devnet relayer keypair
- A MINT_KEYPAIR (any Solana keypair with some devnet SOL)

### Supabase tables

Run in the Supabase SQL editor:

```sql
CREATE TABLE IF NOT EXISTS public.agents (
  user_id           TEXT PRIMARY KEY,
  pubkey            TEXT NOT NULL,
  encrypted_keypair TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role bypass" ON public.agents USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public."zkUsers" (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public."zkUsers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own row" ON public."zkUsers"
  FOR ALL USING (auth.uid()::text = id) WITH CHECK (auth.uid()::text = id);
```

### Backend

```bash
cd agent-backend
cp .env.example .env
# Fill in all values (see .env.example for docs)
npm install
npm run dev
```

**Required env vars:**

```
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
AGENT_ENCRYPTION_KEY=   # 32-byte hex: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
RELAYER_KEYPAIR=        # JSON array of 64 bytes
MINT_KEYPAIR=           # JSON array of 64 bytes (generate below)
MINT_SK=                # BN254 scalar hex (your mint's mathematical secret key)
RPC_URL=https://api.devnet.solana.com
PORT=4000
ALLOWED_ORIGIN=http://localhost:3000
```

**Generate a mint keypair:**

```bash
cd agent-backend
node -e "
const { Keypair } = require('@solana/web3.js');
const kp = Keypair.generate();
console.log('MINT_KEYPAIR=' + JSON.stringify(Array.from(kp.secretKey)));
console.log('Pubkey (fund this on devnet):', kp.publicKey.toBase58());
"
```

Then airdrop devnet SOL to both the mint pubkey and the relayer pubkey:

```bash
solana airdrop 1 <PUBKEY> --url devnet
```

### Frontend

```bash
cd agent-ui
cp .env.example .env
# Fill in Supabase URL, anon key, and backend URL
npm install
npm run dev
```

**Required env vars:**

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deployed program

The Solana program is deployed on devnet:

```
Program ID: 786pocjFvsLKLL4Ly5cYm2e5qsT4GMBvK21Cx97PWK1o
```

Source: [`prototype/programs/ghost_vault/src/lib.rs`](prototype/programs/ghost_vault/src/lib.rs)

---

## Architecture

See [`architecture/architecture.md`](architecture/architecture.md) for the full system diagram, privacy protocol walkthrough, and component map.

---

## License

MIT
