# Deploying FeeFlow

FeeFlow is two parts: the **server** (API + background worker, with a SQLite database) and the **web** site (Next.js), which proxies `/api` and `/auth` to the server.

## 1. Server

Needs Node 22, a Solana RPC URL, a funded server wallet, and a persistent disk for the database.

```bash
cd server
npm install
cp .env.example .env    # fill it in: every setting is described in the file
npm run doctor          # checks the settings, RPC, X keys and nonprofits
npm run charity -- import-onboarded   # adds every nonprofit onboarded with donate.gg
npm run house           # once: creates the escrow host coin, writes HOUSE_MINT to .env
npm run dev             # or: npx tsx src/index.ts
```

Key settings:

| Setting | What it is |
|---|---|
| `AUTHORITY_SECRET_KEY` | Server wallet: launches coins and sets their fee sharing. Keep it funded with a little SOL. |
| `MASTER_SEED` | Derives the treasury key. **Back it up with the database**: losing it loses the treasury. |
| `PLATFORM_WALLET` | Receives the 5% platform share. |
| `PLATFORM_COIN_MINT` | The FeeFlow coin, bought back and burned with the 5% buyback share. |
| `FALLBACK_CONFIG_ID` | donate.gg config of the fallback nonprofit. |
| `HOLD_DAYS` | Days a recipient has to set a payout destination before the fallback applies (default 90). |
| `X_*` | X API keys: bearer token (lookups), OAuth 2.0 client (login), and the bot account's OAuth 1.0a tokens (posting, reading replies). Run `node xauth.cjs start` to authorize the bot account. |
| `PUBLIC_URL` | The website's address, e.g. `https://feeflow.io`. |

The included `Dockerfile` runs on Railway, Fly or any container host. Mount a volume at `/data` (the database lives at `/data/goodcall.db`).

## 2. Website

```bash
cd web
npm install
BACKEND_URL=https://your-server SITE_URL=https://your-site npm run build
```

On Vercel, set `BACKEND_URL` and `SITE_URL` as environment variables before the first build.

## 3. X

In the X developer portal, under User authentication settings:

- App permissions: **Read and write**
- Type of app: **Web App, Automated App or Bot**
- Callback URI: `https://your-site/auth/x/callback`
- Website URL: `https://your-site`

Authorize the bot account with `node xauth.cjs start` (in `server/`), opened while logged in to X as the bot account.
