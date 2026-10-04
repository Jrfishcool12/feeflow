# Feeward

**Launch a coin and tag anyone on X. They choose who gets its creator fees: a friend, a project, a cause, themselves or a charity.** Every payout is a public Solana transaction.

Live at [feeward.app](https://feeward.app) · [@feewardx](https://x.com/feewardx)

## How it works

1. **Launch.** A coin is launched on Pump.fun through Feeward and tags an X account (the *chooser*). [@feewardx](https://x.com/feewardx) tags them on X.
2. **Choose.** The chooser replies to @feewardx with one @handle (or "me"), or picks on the coin's page after logging in with X. That account becomes the *recipient*.
3. **Claim or pass it on.** The recipient logs in with X and chooses a *payout destination*, once: their own wallet (proven with a signed message) or a nonprofit on [donate.gg](https://donate.gg). Or they pass the fees on to another X account (reply with its @handle), which gets the same choice.
4. **Paid.** Creator fees are collected and paid out automatically. Every payout appears on the coin's page and in the public feed with its transaction, and @feewardx posts a receipt.

If the recipient declines, or no destination is set within 90 days, the recipient share goes to the fallback nonprofit shown on the coin's page.

## Where the fees go

Each coin's Pump.fun fee sharing is set once at launch and locked by Pump.fun:

| Share | Goes to |
|---|---|
| 90% | The Feeward treasury, held for the coin and then paid to the recipient's wallet or nonprofit |
| 5% | Feeward |
| 5% | Buys the Feeward coin at random times and burns it |

These are shares of the coin's **creator fees**, not of trading volume. donate.gg charges its own processing fee on nonprofit payouts.

## Verify it yourself

| What | Address |
|---|---|
| Treasury (holds recipient shares until payout) | `BER6xKSZxCPa2AHEvriu52PFvBMsQWZ1nncEQWbz2p4e` |
| Feeward platform wallet | `4Stb1jMDPDaX1qw2TydBxdhKGzkdP8GzuJGrHZpi6uMa` |
| Buyback wallet | `5qvhdanYuZh8xoaiKL9Ye2ZHy8Thavc4ZicY6RBvrw9i` |
| Server authority (launches coins, sets fee sharing) | `6KB4hAUkPsfewtNgSajVsEHZXx15r2ZoQsYe7mWQjnoa` |
| Escrow host coin (holds donate.gg nonprofit escrows) | `4WBLivH9ZeSP2FH2Pskv2yoViSsQ3ChbEVGiBSFuzNLJ` |

Every coin page shows its fee split checked on-chain, each payout with its transaction, and a record of who chose what and when. The code that does this is in this repo:

- Fee split and launch: [`server/src/pump.ts`](server/src/pump.ts)
- Holding and paying out the recipient share: [`server/src/relay.ts`](server/src/relay.ts)
- Chooser, recipient, wallet-signature check, X-reply parsing: [`server/src/roles.ts`](server/src/roles.ts)
- Buyback and burn: [`server/src/worker.ts`](server/src/worker.ts)

## Repo layout

```
web/       Next.js site (feeward.app)
server/    TypeScript API + background worker (Fastify, SQLite): launches, fee collection,
           payouts, X login, @feewardx posts and reply handling, buybacks
program/   Solana router program (Anchor). Devnet only; not used in production
```

See [DEPLOY.md](DEPLOY.md) to run your own copy.

## Disclaimers

Being tagged on a coin or chosen as its recipient doesn't mean an account endorsed it. Feeward confirms control of an X account by X login only and doesn't verify nonprofit status. Memecoins are speculative. The Feeward coin grants no rights, revenue share or claim on Feeward. See the [disclosures](https://feeward.app/legal/disclosures).

## License

MIT. See [LICENSE](LICENSE).
