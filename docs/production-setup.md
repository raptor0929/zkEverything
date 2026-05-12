# Production Setup — zkEverything Backend

Frontend is live at **https://app.zkeverything.me** (Vercel).  
This doc covers everything needed to deploy the `agent-backend` and wire it to the frontend.

---

## 1. Deploy on Railway

### 1.1 Fix the start command first (do this before deploying)

The `start` script currently uses `ts-node` which is too slow for production.  
Update `agent-backend/package.json`:

```json
"build": "tsc",
"start": "node dist/server.js"
```

Commit and push this change before connecting Railway.

### 1.2 Create a Railway project

1. Go to https://railway.app and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select this repository
4. Railway will detect the monorepo — click **Add service → GitHub repo** again if needed
5. In the service settings → **Source**, set **Root Directory** to `agent-backend`

### 1.3 Set build and start commands

In the service settings → **Deploy**:

- **Build command**: `npm run build`
- **Start command**: `npm start`

Railway injects `PORT` automatically — the backend already reads `process.env.PORT ?? 4000` so no change needed.

### 1.4 Add environment variables

In the service settings → **Variables**, add every variable from section 3 below.  
Do **not** add `PORT` — Railway manages it.

### 1.5 Add a custom domain

1. In service settings → **Networking → Custom Domain**, click **Add Domain**
2. Enter `api.zkeverything.me`
3. Railway shows a CNAME target (e.g. `<hash>.up.railway.app`)
4. In your DNS provider, add a **CNAME record**: `api → <hash>.up.railway.app`
5. Wait for DNS propagation (~1–5 min). Railway provisions TLS automatically.

### 1.6 SSE streaming timeout

The `/api/chat` endpoint streams responses via SSE. Railway's default request timeout is **60 seconds** — enough for most transfers but tight if Solana devnet is slow.

To extend it: service settings → **Networking** → set **Request Timeout** to `300`.

### 1.7 Verify the deploy

Railway shows build logs in real time. Look for:

```
agent-backend listening on port <PORT>
```

If the build fails, the most common cause is a TypeScript error — check the build logs and fix before redeploying.

---

## 2. Fix the start command for production

The `start` script currently uses `ts-node` which is too slow for production.  
Update `agent-backend/package.json` scripts:

```json
"build": "tsc",
"start": "node dist/server.js"
```

Set the host's **build command** to `npm run build` and **start command** to `npm start`.

---

## 3. Set environment variables on the host

Add every variable from `.env.example`. Values to fill in:

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | Your OpenAI key |
| `SUPABASE_URL` | `https://ruazqhrjgbvaqnpplfns.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase dashboard → Project Settings → API → service_role |
| `SUPABASE_JWT_SECRET` | From Supabase dashboard → Project Settings → API → JWT Settings |
| `AGENT_ENCRYPTION_KEY` | 32-byte hex — keep the same value as local `.env` so existing agent wallets still decrypt |
| `RELAYER_KEYPAIR` | JSON byte array of relayer wallet secret key |
| `MINT_KEYPAIR` | JSON byte array of mint wallet secret key |
| `MINT_SK` | BN254 hex scalar for the mint |
| `RPC_URL` | `https://api.devnet.solana.com` (or mainnet endpoint) |
| `PORT` | `4000` (or omit — Railway/Render set this automatically) |
| `ALLOWED_ORIGIN` | `https://app.zkeverything.me` |

**Never commit `.env` to git.** Use the host's secrets/env dashboard.

---

## 4. Update Vercel environment variables

In the Vercel dashboard for `app.zkeverything.me`, set:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `https://api.zkeverything.me` (or whatever URL your backend gets) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ruazqhrjgbvaqnpplfns.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase dashboard → Project Settings → API → anon/public |

After updating, trigger a redeploy in Vercel.

---

## 5. Update Supabase auth settings

In the Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL**: `https://app.zkeverything.me`
- **Redirect URLs**: add `https://app.zkeverything.me/**`

---

## 6. Fund the relayer and mint wallets (devnet)

The relayer pays for deposit and redeem transactions (~0.012 SOL each).  
The mint pays for announce transactions (~0.000005 SOL each).

Check balances and airdrop if needed:

```bash
solana balance <RELAYER_PUBKEY> --url devnet
solana balance <MINT_PUBKEY> --url devnet
solana airdrop 2 <RELAYER_PUBKEY> --url devnet
solana airdrop 1 <MINT_PUBKEY> --url devnet
```

---

## 7. Alternative: Deploy on Google Compute Engine (GCE)

Use this instead of Railway if you want full control over the VM.

### 7.0 Configure gcloud on your local machine

### Check for existing GCE instances

Before creating a new VM, check if you already have one running:

```bash
gcloud compute instances list
```

The output shows all VMs across zones with their status, external IP, and machine type:

```
NAME                   ZONE           MACHINE_TYPE  INTERNAL_IP  EXTERNAL_IP     STATUS
my-existing-vm         us-central1-a  e2-micro      10.128.0.2   34.123.45.67    RUNNING
```

If you see an existing instance you want to use:

```bash
# Set it as your target zone (if different from default)
gcloud config set compute/zone <ZONE>

# SSH into it directly
gcloud compute ssh <INSTANCE_NAME>
```

Then skip to step **7.3** (installing dependencies) — you don't need to create a new VM or open firewall ports if the instance is already configured. Just verify port 4000 is open:

```bash
gcloud compute firewall-rules list --filter="name~allow-backend"
```

If that returns nothing, run the firewall rule from step 7.2.

---

**Install the gcloud CLI** (if not already installed):

```bash
# macOS via Homebrew
brew install --cask google-cloud-sdk
```

Or download the installer from https://cloud.google.com/sdk/docs/install and run:

```bash
./google-cloud-sdk/install.sh
```

**Authenticate and set your project:**

```bash
# Opens browser to log in with your Google account
gcloud auth login

# List available projects
gcloud projects list

# Set the project you want to deploy to
gcloud config set project <YOUR_PROJECT_ID>

# Set a default zone so you don't have to pass --zone every time
gcloud config set compute/zone us-central1-a

# Verify
gcloud config list
```

If you don't have a GCP project yet:

```bash
gcloud projects create zkeverything --name="zkEverything"
gcloud config set project zkeverything

# Enable billing in the GCP console first, then enable required APIs:
gcloud services enable compute.googleapis.com
```

### 7.1 Create the VM

```bash
gcloud compute instances create zkeverything-backend \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=http-server,https-server \
  --boot-disk-size=20GB
```

### 7.2 Open firewall ports

```bash
gcloud compute firewall-rules create allow-backend \
  --allow tcp:4000 \
  --target-tags=http-server \
  --description="zkEverything backend port"
```

### 7.3 SSH into the VM and install dependencies

```bash
gcloud compute ssh zkeverything-backend --zone=us-central1-a
```

Once inside:

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Clone the repo
git clone https://github.com/<your-org>/dev3pack.git
cd dev3pack/agent-backend

# Install and build
npm install
npm run build
```

### 7.4 Create the .env file on the VM

```bash
nano .env
```

Paste all variables from section 3 above with production values. Save with `Ctrl+O`, exit with `Ctrl+X`.

### 7.5 Run with PM2 (keeps the process alive on restart)

```bash
sudo npm install -g pm2
pm2 start dist/server.js --name zkeverything-backend
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

### 7.6 Point api.zkeverything.me at the VM

1. Get the VM's external IP: `gcloud compute instances describe zkeverything-backend --zone=us-central1-a --format='get(networkInterfaces[0].accessConfigs[0].natIP)'`
2. In your DNS provider, add an **A record**: `api.zkeverything.me → <external IP>`

### 7.7 Add HTTPS with Nginx + Certbot

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Create Nginx config
sudo nano /etc/nginx/sites-available/zkeverything
```

Paste:

```nginx
server {
    server_name api.zkeverything.me;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        # Required for SSE streaming (AI chat responses)
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/zkeverything /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Issue TLS certificate
sudo certbot --nginx -d api.zkeverything.me
```

Certbot auto-renews. After this, the backend is available at `https://api.zkeverything.me`.

### 7.8 Update ALLOWED_ORIGIN in .env

```bash
# In /home/<user>/dev3pack/agent-backend/.env
ALLOWED_ORIGIN=https://app.zkeverything.me
```

Then restart the process:

```bash
pm2 restart zkeverything-backend
```

---

## 8. Smoke test

1. Open https://app.zkeverything.me
2. Register a new account
3. Create agent wallet
4. Fund it from the devnet faucet: https://faucet.solana.com
5. Send a private transfer to any devnet address
6. Confirm the Solscan link appears at the end of the chat
