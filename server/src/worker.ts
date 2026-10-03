import { randomInt } from "node:crypto";
import { LAMPORTS, MIN_FORWARD, PLATFORM_COIN, RELAY_ON, VAULT_RESERVE, cfg } from "./config.js";
import { addDonation, configHistory, coinsByStatus, db, getCharity, getCoin, isHolding, kvGet, kvSet, now, routingState, updateCoin, type Coin } from "./db.js";
import { buybackWallet, conn } from "./chain.js";
import { coinFallback, distributeRelayed, forwardCoin, relayTotal, releaseExpired, scanTreasury, syncClaims, waitingFor } from "./relay.js";
import { refreshMarket, rememberHonoree } from "./market.js";
import { cardFor } from "./cards.js";
import { routerOn } from "./router.js";
import { buyAndBurn, crank, donatedTotal, forwardRelay, harvestRelay, relayPending, setupRouting } from "./pump.js";
import { botPost } from "./x.js";
import { coinPost, fit } from "./posts.js";
import { pollReplies } from "./roles.js";

let price = { usd: 0, at: 0 };
export async function solUsd() {
  if (price.usd && Date.now() - price.at < 60_000) return price.usd;
  try {
    const j = (await (await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")).json()) as any;
    if (j?.solana?.usd) price = { usd: j.solana.usd, at: Date.now() };
  } catch {
    /* keep last price */
  }
  return price.usd;
}

export const usd = async (lamports: number) => Math.round((lamports / LAMPORTS) * (await solUsd()));
export const fmtUsd = (n: number) => "$" + n.toLocaleString("en-US");
export const link = (mint: string) => `${cfg.PUBLIC_URL}/c/${mint}`;

/** "@StJude" if we know their handle, else the charity's name. */
export function charityTag(configId: string) {
  const c = getCharity(configId);
  return c?.x_handle ? `@${c.x_handle}` : c?.name ?? "charity";
}

// ---------- after launch: switch on fee routing ----------

export async function activate(c: Coin) {
  try {
    const sig = await setupRouting(c.mint, c.config_id, c.honoree_user_id);
    db.prepare("INSERT INTO routing_changes (mint, from_config, to_config, reason, signature, created_at) VALUES (?, NULL, ?, 'setup', ?, ?)")
      .run(c.mint, c.config_id, sig, now());
    // The deployed router routes straight to the fallback nonprofit (holding needs router v2).
    updateCoin(c.mint, { status: "live", error: null, ...(routerOn() ? { released_at: now() } : {}) });
    // Art and profile picture first, so the post's link preview shows them.
    await refreshMarket(getCoin(c.mint)!).catch(() => {});
    await rememberHonoree(c.honoree_user_id, c.honoree_handle).catch(() => {});
    const id = await coinPost(
      c.mint,
      "announce",
      `@${c.honoree_handle} you were tagged on $${c.symbol}. Choose who gets its creator fees: you, a friend, a project, a cause or a charity.\n\nReply with one @handle (or "me") or use ${link(c.mint)}#act.`
    );
    if (id) updateCoin(c.mint, { announce_tweet: id });
    console.log(`live: ${c.mint}`);
  } catch (e) {
    console.error(`setup ${c.mint}:`, (e as Error).message);
    updateCoin(c.mint, { error: (e as Error).message });
  }
}

// ---------- keep money moving and totals fresh ----------

// ---------- relay coins live in relay.ts (treasury, indexer, claims, forwards) ----------

export { forwardCoin as flushRelay, relayTotal } from "./relay.js";

/** While funds are held, milestones nudge whoever has to act next: the chooser, or the locked recipient. */
async function heldMilestone(c: Coin) {
  const waiting = waitingFor(c);
  const dollars = await usd(waiting);
  const hit = LADDER.filter((m) => dollars >= m).at(-1);
  if (!hit || hit <= c.last_milestone) return;
  updateCoin(c.mint, { last_milestone: hit });
  const state = routingState(c);
  if (state === "awaiting_selection" && c.opted_out) return;
  await coinPost(
    c.mint,
    "milestone",
    state === "awaiting_routing"
      ? `@${c.recipient_handle} ${fmtUsd(dollars)} from $${c.symbol} creator fees is waiting for you. Log in to accept and choose your wallet or a nonprofit: ${link(c.mint)}#act`
      : `@${c.honoree_handle} ${fmtUsd(dollars)} from $${c.symbol} creator fees is waiting for a recipient. Reply with their @handle (or "me"), or choose at ${link(c.mint)}#act.`,
    c.announce_tweet,
    await cardFor(c, "waiting", fmtUsd(dollars))
  );
}

/** Payout milestones, worded by destination: support to a wallet, or a donation to a nonprofit. */
async function milestone(c: Coin, total: number) {
  if (isHolding(c)) return heldMilestone(c);
  const dollars = await usd(total);
  // The first payout is always announced, so the recipient (and chooser) hear about it on X right away.
  if (total > 0 && c.posted_lamports === 0 && dollars < LADDER[0]) {
    updateCoin(c.mint, { posted_lamports: total });
    const amount = dollars >= 1 ? fmtUsd(dollars) : `${(total / 1e9).toFixed(3)} SOL`;
    const state = routingState(c);
    const text =
      state === "active" && c.payout_kind === "wallet"
        ? `@${c.recipient_handle} the first payout from $${c.symbol} creator fees just landed in your wallet: ${amount}. Every fee after this follows. Receipt: ${link(c.mint)}`
        : state === "active"
          ? `First payout from $${c.symbol} creator fees: ${amount} donated to ${charityTag(c.payout_config_id!)}, chosen by @${c.recipient_handle}. Receipt: ${link(c.mint)}`
          : `First payout from $${c.symbol} creator fees: ${amount} donated to ${charityTag(coinFallback(c))} (fallback). Receipt: ${link(c.mint)}`;
    await coinPost(c.mint, "first_payout", text, c.announce_tweet, await cardFor(c, "sent", amount));
    return;
  }
  const hit = LADDER.filter((m) => dollars >= m).at(-1);
  if (!hit || hit <= c.last_milestone) return;
  const since = await usd(total - c.posted_lamports);
  updateCoin(c.mint, { last_milestone: hit, posted_lamports: total });
  const state = routingState(c);
  const text =
    state === "active" && c.payout_kind === "wallet"
      ? `${fmtUsd(since)} from $${c.symbol} creator fees was sent to @${c.recipient_handle} as support.\n\nTotal so far: ${fmtUsd(dollars)}`
      : state === "active"
        ? `${fmtUsd(since)} from $${c.symbol} creator fees was donated to ${charityTag(c.payout_config_id!)}, chosen by @${c.recipient_handle}.\n\nTotal so far: ${fmtUsd(dollars)}`
        : `${fmtUsd(since)} from $${c.symbol} creator fees was donated to ${charityTag(coinFallback(c))} (fallback).\n\nTotal so far: ${fmtUsd(dollars)}`;
  await coinPost(c.mint, "milestone", text, c.announce_tweet, await cardFor(c, "sent", fmtUsd(since)));
}

const LADDER = [100, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

async function tick() {
  for (const c of coinsByStatus("launched")) await activate(c);

  // Launches nobody signed within an hour are dropped.
  db.prepare("DELETE FROM coins WHERE status = 'built' AND created_at < ?").run(now() - 3600);

  for (const c of coinsByStatus("live", "launch")) {
    try {
      // Pay accrued fees out to the split; the nonprofit share lands in the treasury and is forwarded below.
      await crank(c.mint, []);
      const total = relayTotal(c.mint);
      updateCoin(c.mint, { donated_lamports: total });
      await milestone({ ...c, donated_lamports: total }, total);
    } catch (e) {
      console.error(`tick ${c.mint}:`, (e as Error).message);
    }
  }

  // Art, description, market cap and honoree profiles (cheap reads; rate-limited inside).
  for (const c of coinsByStatus("live")) {
    await refreshMarket(c).catch((e) => console.error(`market ${c.mint}:`, e.message));
    await rememberHonoree(c.honoree_user_id, c.honoree_handle).catch(() => {});
    if (c.recipient_user_id) await rememberHonoree(c.recipient_user_id, c.recipient_handle ?? undefined).catch(() => {});
  }

  // The treasury: relayed coins' fees, and launched coins' nonprofit share while it's held.
  if (RELAY_ON) {
    await scanTreasury().catch((e) => console.error("scan:", e.message));
    await distributeRelayed().catch((e) => console.error("distribute:", e.message));
  }
  await syncClaims().catch((e) => console.error("claims:", e.message));
  await releaseExpired().catch((e) => console.error("release:", e.message));
  for (const c of coinsByStatus("live")) {
    try {
      await forwardCoin(c);
      if (c.mode === "relay") {
        const total = relayTotal(c.mint);
        updateCoin(c.mint, { donated_lamports: total });
        await milestone({ ...c, donated_lamports: total }, total);
      }
    } catch (e) {
      console.error(`treasury ${c.mint}:`, (e as Error).message);
    }
  }
  // Push everything relayed coins sent to the house escrows on to the donation relay.
  if (RELAY_ON) {
    const used = (db.prepare("SELECT DISTINCT f.config_id c FROM forwards f WHERE f.lamports > 0 AND f.config_id != 'wallet'").all() as { c: string }[]).map((r) => r.c);
    if (used.length) await crank(cfg.HOUSE_MINT!, used).catch((e) => console.error("house crank:", e.message));
  }
}

// ---------- platform coin: buy and burn with the buyback share ----------

const BUYBACK_RESERVE = 5_000_000; // rent + the token account the first buy creates
const MIN_BUYBACK = 50_000_000;

export const buybackTotals = () =>
  db.prepare("SELECT COALESCE(SUM(lamports), 0) lamports, COUNT(*) n FROM buybacks").get() as { lamports: number; n: number };

async function buyback() {
  if (!PLATFORM_COIN || cfg.BUYBACK_BPS === 0) return;
  const spendable = (await conn.getBalance(buybackWallet.publicKey, "confirmed")) - BUYBACK_RESERVE;
  if (spendable < MIN_BUYBACK) return;

  const r = await buyAndBurn(PLATFORM_COIN, buybackWallet, spendable);
  db.prepare("INSERT INTO buybacks (lamports, tokens_raw, buy_sig, burn_sig, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(spendable, r.burned.toString(), r.buySig, r.burnSig, now());
  console.log(`buyback: ${(spendable / LAMPORTS).toFixed(3)} SOL, burned ${r.burned}`);

  const dollars = await usd(buybackTotals().lamports);
  const hit = LADDER.filter((m) => dollars >= m).at(-1) ?? 0;
  if (hit > Number(kvGet("buyback_milestone") ?? 0)) {
    kvSet("buyback_milestone", String(hit));
    await botPost(`FeeFlow coins have now bought back and burned ${fmtUsd(dollars)} of the platform coin. 5% of every coin's fees buys it back. ${cfg.PUBLIC_URL}`);
  }
}

/**
 * Next buyback delay in ms, uniformly random between BUYBACK_MIN_SECONDS and BUYBACK_MAX_SECONDS
 * (5 minutes to 1 hour by default). Uses the OS's cryptographic randomness, so the schedule
 * can't be worked out from past buy times. The next time is never stored or exposed by the API.
 */
export const nextBuybackDelay = () => randomInt(cfg.BUYBACK_MIN_SECONDS * 1000, cfg.BUYBACK_MAX_SECONDS * 1000 + 1);

function scheduleBuybacks() {
  if (!PLATFORM_COIN || cfg.BUYBACK_BPS === 0) return;
  const loop = () => {
    setTimeout(async () => {
      // If the wallet is below the minimum, nothing is bought and a new random time is picked.
      await buyback().catch((e) => console.error("buyback:", e.message));
      loop();
    }, nextBuybackDelay());
  };
  loop(); // also random after a restart, so restarts don't reveal the timing
  console.log(`buybacks: random, every ${cfg.BUYBACK_MIN_SECONDS / 60}-${cfg.BUYBACK_MAX_SECONDS / 60} min`);
}

let busy = false;
export function startWorker() {
  const run = async () => {
    if (busy) return;
    busy = true;
    await tick().catch((e) => console.error("tick:", e));
    busy = false;
  };
  void run();
  setInterval(run, cfg.CRANK_SECONDS * 1000);
  console.log(`worker: every ${cfg.CRANK_SECONDS}s`);
  scheduleBuybacks();
  if (cfg.REPLY_POLL_SECONDS) {
    let reading = false;
    const poll = async () => {
      if (reading) return;
      reading = true;
      await pollReplies().catch((e) => console.error("replies:", e.message));
      reading = false;
    };
    setInterval(poll, cfg.REPLY_POLL_SECONDS * 1000);
    void poll();
    console.log(`replies: every ${cfg.REPLY_POLL_SECONDS}s`);
  }
}
