# FeeFlow

**Give in their name.** Launch a coin. Fees are automatically donated to verified nonprofits in the person's name, and that person can choose the cause.

Brand: Charcoal `#0B0B0B`, White `#FFFFFF`, Good Green `#22C55E`, Light Gray `#F4F5F7`, Mint `#DCFCE7`. Type: Inter.

Two ways in, side by side:

| | **Direct** (launch here) | **Relayed** (any existing coin) |
|---|---|---|
| Who can use it | New coins launched on this site | Any Pump.fun coin, however it was launched |
| Where fees go | Straight from Pump.fun to the charity's donation escrow | Pump.fun → the coin's relay vault → forwarded to the charity's escrow |
| Touches your wallet | Never | Yes, briefly (see "Relay mode" below) |
| Honoree's charity switch | On-chain fee-sharing update | Changes where the next forward goes |
| Shown on the site as | Direct | Relayed |

The honoree never receives money. They get a public plaque, running totals, and the power to pick where the money goes. Picking is their natural moment to post about it.

## How it works

1. **Launch.** A deployer launches a coin here: name, ticker, image, the X account it honors, a starting charity, and an optional dev buy. Their wallet signs a Pump.fun `create_v2` whose creator is this app's routing key. The coin's description states who it honors and that they haven't endorsed it.
2. **Routing switches on.** Seconds later the routing key turns on Pump.fun fee sharing for the coin and points it at:
   - the charity's **donation escrow** (`DonationFeePda`, Pump.fun's native escrow behind Charity Coins and donate.gg): 90%
   - the platform wallet: 5% (`PLATFORM_BPS`)
   - the buyback wallet: 5% (`BUYBACK_BPS`), which buys the platform coin and burns it
   The bot announces it and tags the honoree with a link to choose.
3. **Money moves.** Every 10 minutes the worker pays out accrued fees to the split and cranks each escrow into donate.gg's relay, which delivers to the charity. Both steps are permissionless.
4. **Totals and posts.** Totals are read from the escrows themselves (`totalDonated`), not tracked by us. As totals cross $100, $500, $1K, $2.5K… the bot posts: "@elonmusk, $BIGJ holders just gave $4,120 to @BestFriends in your name. Total: $38,900."
5. **The honoree chooses.** They log in with X, pick any charity on the list, and the routing key swaps the escrow. Pending fees go out to the old charity first. After the first pick they can switch once every 30 days (`CHANGE_COOLDOWN_DAYS`). The bot announces their pick.
6. **Opt-out.** The honoree can remove their name from the coin's page and the bot's posts. Fees keep going to charity.

## Platform coin buyback

5% of every coin's fees (`BUYBACK_BPS`), direct or relayed, goes to the **buyback wallet**. At a random moment between 5 minutes and 1 hour after the last attempt (`BUYBACK_MIN_SECONDS` / `BUYBACK_MAX_SECONDS`), if it holds at least 0.05 SOL, the worker spends it buying the platform coin (`PLATFORM_COIN_MINT`, defaulting to `HOUSE_MINT`) and burns every token bought.

- **Unpredictable timing.** Each wait is drawn fresh from the OS's cryptographic randomness, so past buy times say nothing about the next one, and nobody can sit in front of it. Restarts pick a random time too. The next time is never stored or exposed by the API.
- **What randomness doesn't hide.** The buyback wallet is public on-chain, so anyone can watch its balance grow and know a buy is coming *at some point*. They just can't know when.

- Graduated platform coins are bought on PumpSwap through the SDK, which prices against effective quote reserves, so buys stay correct when a pool's virtual quote reserves are negative.
- The buyback wallet's key is derived from the routing key, so there's no extra secret. It only ever holds SOL waiting to be spent.
- Every buy and burn is stored with its transactions (`/api/buybacks`), the wall shows the running total, and the bot posts at $100, $500, $1K… burned.
- Paying for a token buyback out of charity-coin trading fees is part of how this coin is marketed. Say it plainly (the site does, on every page that shows the split) and get a lawyer's view, since it ties the platform coin's value to the platform's activity.

## Trust model: read this

Pump.fun's fee sharing has one admin, and only the admin can change the split. There's no public instruction to hand that admin to someone else, so the only way to let the honoree choose later is for this app's routing key to be the coin's creator and fee-sharing admin. That's why coins must be launched here; existing coins can't be converted.

What keeps that key honest:
- **The code can only route to three places.** `expectedShares()` in `src/pump.ts` is the only split ever written: the chosen charity's donation escrow, the platform wallet and the buyback wallet, at fixed percentages. `switchCharity()` refuses to touch a coin whose live split doesn't already match.
- **Anyone can check.** Every coin page reads the live on-chain split and checks it against that rule, and lists every routing change with its transaction.

That's for direct coins. Relayed coins add the relay vaults to the trust surface: the server holds their keys, so the published forwards are the proof that money reached charity.

**Changing the percentages later.** Live direct coins keep the split they were set up with, and `switchCharity()` refuses coins whose split doesn't match the current settings. Decide the percentages before launch, or plan a migration that re-applies the split to every live coin.

What it doesn't stop: someone who steals the routing key could rewrite splits, and someone who steals `MASTER_SEED` could drain relay vaults. Keep it in a secrets manager on the server, keep only enough SOL in it for fees, and watch for split changes you didn't make.

**v2 should remove this trust** with a small on-chain program as the fee-sharing admin. It would only accept splits of the form "donation escrow for this mint + fixed platform wallet", and only for charities the honoree signs off on (via a server attestation of their X login). Then even a stolen server key couldn't redirect money.

## Relay mode

For coins launched anywhere else. The deployer registers the coin (mint, name, ticker, honoree, starting charity) and gets a relay vault address unique to that coin. They set Pump.fun fee sharing to 100% to the vault and lock it; **Check and go live** verifies that on-chain. Registrations that never get routed expire after 24 hours.

Every 10 minutes the worker collects the coin's fees into its vault and, once there's at least 0.02 SOL, forwards it in one transaction: the charity share to the donation escrow, the platform cut to the platform wallet. When the honoree switches charities, whatever is already in the vault goes to the old charity first.

**Why forwards go through the house coin.** A donation escrow is tied to one coin, and only that coin's admin can create it. We aren't the admin of relayed coins, so their forwards go to escrows on the **house coin** (`HOUSE_MINT`): one coin launched through this site, which our routing key administers. donate.gg will attribute those donations to the house coin; this site tracks each relayed coin's own total from its forwards (every one is a public transaction). To set it up, launch the FeeFlow coin through the site and set `HOUSE_MINT` to its mint. Relay mode stays off until `HOUSE_MINT` and `MASTER_SEED` are set.

**Back up `MASTER_SEED` and the database.** Each relay vault's key is derived from `MASTER_SEED` plus a nonce stored in the database. Lose either and the money sitting in vaults is stuck.

**Talk to an accountant before turning this on.** In relay mode, creator fees pass through wallets your company controls before they reach charity. That can count as income to you, and a company's deduction for charitable gifts is limited, so you could owe tax on money you gave away. Direct mode avoids this because the money never touches your wallets.

## Charities

The list is curated. Each entry is a donate.gg config id, which is what Pump.fun's donation escrows are keyed on.

```bash
npm run charity -- discover                      # config ids already used on Pump.fun, by SOL donated
npm run charity -- add <configId> "St. Jude Children's Research Hospital" @StJude https://www.stjude.org
npm run charity -- list
npm run charity -- disable <configId>
```

`discover` shows which config ids are in use but not which charity each one pays. **Confirm every id with donate.gg before adding it.** A wrong id sends money to the wrong charity. Ideally get a partnership with donate.gg and an official list.

## Run it

```bash
cp .env.example .env     # fill it in
npm install
npm run charity -- add ...   # add at least one charity
npm run dev                  # http://localhost:8787
```

You need:
- a Solana RPC,
- a routing key with ~1 SOL for setup and crank fees,
- a platform wallet,
- an X developer app: bearer token for handle lookups, OAuth 2.0 with callback `PUBLIC_URL/auth/x/callback` for honoree login, and OAuth 1.0a bot tokens for posts (without them, posts are logged),
- optionally a Pinata JWT, so deployers can upload a coin image instead of pasting a metadata URI,
- for relay mode: `MASTER_SEED` (32+ random characters) and `HOUSE_MINT` (see "Relay mode").

## Files

```
src/pump.ts       launch tx, fee-sharing setup, charity switch, cranks, totals, on-chain audit, config discovery,
                  relay: routing check, harvest, house escrows, forwards
src/server.ts     API: launch build/submit, honoree login, charity pick, opt-out, coin pages
src/worker.ts     activate new coins, crank fees, refresh totals, milestone posts
src/metadata.ts   image + metadata upload to IPFS (Pinata)
src/x.ts          X lookups, bot posts, OAuth login
src/chain.ts      RPC, routing key, transaction sending
src/db.ts         SQLite schema
src/cli.ts        nonprofit list management
src/sdk.ts        loads the Pump SDKs' CommonJS builds (their ESM builds break on import)
web/index.html    the whole frontend
```

## Before launch

- **Test relay mode too:** register a coin launched on pump.fun, route and lock its fees, trade it, and confirm the vault fills, the forward lands in the house escrow, and the house crank passes it on.
- **Run it end to end on mainnet with a throwaway coin:** launch, confirm the split on-chain, trade, confirm the escrow fills and the crank forwards it, switch charities, confirm totals. The instructions come from Pump's official SDK and their signers and transaction sizes are checked, but they haven't been run against mainnet here. A launch with a dev buy is the largest transaction; if it's too big, launch without one and buy separately.
- **Talk to donate.gg.** You depend on their relay, their charity mapping and their fee: an independent tracker reports a 10% Charity Coins fee, taken out of the charity's 90%. That means roughly 81% of fees actually reach the charity; be upfront about that. Their consent problems are public, too: nonprofits listed without agreeing. Ask about charity opt-in.
- **Fees before routing switches on.** Trades in the seconds between launch and setup pay into the routing key's own creator vault, shared by every coin it created. Setup sweeps that into the new coin's escrow, so a few lamports from a neighbouring launch could land in the wrong escrow. It's still charity money either way.
- **Using someone's name.** The coin says "in honor of" and "has not endorsed", the honoree can opt out, and they never receive money, so their posts aren't paid endorsements. Still get a lawyer's read on using famous names to market a coin.
