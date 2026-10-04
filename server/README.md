# Feeward server

The API and background worker behind [feeward.app](https://feeward.app): launches coins, collects creator fees, holds each coin's recipient share in the treasury, pays it out to the recipient's wallet or nonprofit, handles X login and @feewardx's posts and replies, and runs the Feeward coin buyback.

How it works and how to verify it: [README](../README.md). How to run it: [DEPLOY.md](../DEPLOY.md).

| File | What it does |
|---|---|
| `src/server.ts` | HTTP API (Fastify): coins, payouts, stats, launch, X login, chooser and recipient actions |
| `src/worker.ts` | Background loop: collects fees, pays out, refreshes coin data, posts milestones, reads replies, buybacks |
| `src/roles.ts` | Chooser → recipient → payout destination: locking the recipient, wallet-signature proof, declining, X-reply parsing |
| `src/relay.ts` | Treasury: attributes each payment to its coin, holds the recipient share, pays out, fallback |
| `src/pump.ts` | Pump.fun: launch transactions, fee sharing setup and checks, fee collection, buyback and burn |
| `src/cards.ts` | Receipt card images for posts and link previews |
| `src/posts.ts`, `src/x.ts` | @feewardx posting, X lookups and login |
| `src/db.ts` | SQLite schema and migrations |
| `src/cli.ts` | `npm run charity`: manage the donate.gg nonprofit list |
| `src/doctor.ts` | `npm run doctor`: checks the setup |
| `xauth.cjs` | Authorizes the bot's X account (`node xauth.cjs start`) |
