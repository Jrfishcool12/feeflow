/**
 * Relayed coins: coins launched anywhere on Pump.fun that give through Feeward.
 *
 * A deployer sets the coin's fee sharing to 100% to the Feeward treasury, locks it, and puts
 * one line in the coin's description:
 *
 *     In honor of @handle via Feeward
 *
 * (optionally followed by "for @nonprofit" to pick the starting nonprofit). Nothing else: the
 * indexer finds the coin on-chain and registers it. Fee payouts into the treasury are
 * attributed per coin from the transactions themselves, then forwarded with the standard split.
 */
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { FALLBACK_CONFIG, MIN_FORWARD, VAULT_RESERVE, cfg } from "./config.js";
import { authority, conn, send, treasury } from "./chain.js";
import { addDonation, addEvent, db, getCharity, getCoin, isHolding, kvGet, kvSet, now, updateCoin, type Coin } from "./db.js";
import { coinEscrow, houseEscrow, readCurve, readSharing, sendSplit, switchCharity } from "./pump.js";
import { coinPost } from "./posts.js";
import { cardFor } from "./cards.js";
import { pumpSdk } from "./sdk.js";
import { lookupUser } from "./x.js";
import { readTokenMeta } from "./market.js";

const { OnlinePumpSdk, PUMP_SDK, PUMP_FEE_PROGRAM_ID, isSharingConfigEditable } = pumpSdk;
const pump = new OnlinePumpSdk(conn);

export { treasury };

export const LINE_TEMPLATE = "Fees to @handle via Feeward";
const LINE = /(?:fees to|for|in honor of|in the name of|giving in)\s+@([A-Za-z0-9_]{1,15})(?:'s name)?\s+via\s+(?:feeward|feeflow|goodcall)/i;
const FOR = /via\s+(?:feeward|feeflow|goodcall)[^@\n]{0,20}\b(?:fallback|for)\s+@([A-Za-z0-9_]{1,15})/i;

export function parseLine(description: string | null): { handle: string | null; nonprofitHandle: string | null } {
  if (!description) return { handle: null, nonprofitHandle: null };
  return { handle: description.match(LINE)?.[1] ?? null, nonprofitHandle: description.match(FOR)?.[1] ?? null };
}

/** The fallback nonprofit for new coins (FALLBACK_CONFIG_ID, else DEFAULT_CONFIG_ID, else the first one added). */
export function fallbackConfigId(): string | null {
  const id = FALLBACK_CONFIG();
  // The fallback only needs to exist: it can be disabled so recipients don't see it in the picker.
  if (id && getCharity(id)) return id;
  return (db.prepare("SELECT config_id FROM charities WHERE active = 1 ORDER BY added_at LIMIT 1").get() as { config_id: string } | undefined)?.config_id ?? null;
}
/** A coin's fallback nonprofit. */
export const coinFallback = (c: Coin) => c.fallback_config_id ?? c.config_id;

export type CheckStep = { key: string; ok: boolean; label: string; detail?: string };
export type CheckResult = { mint: string; registered: boolean; live: boolean; steps: CheckStep[]; handle: string | null };

/**
 * Checks every condition for a relayed coin, in the order they usually fail, and registers it
 * when they all pass. Used by the indexer and by the "check my coin" page.
 */
export async function checkCoin(mintStr: string, via: "indexer" | "site"): Promise<CheckResult> {
  const steps: CheckStep[] = [];
  const done = (handle: string | null = null): CheckResult => {
    const c = getCoin(mintStr);
    return { mint: mintStr, registered: !!c, live: c?.status === "live", steps, handle };
  };
  let mint: PublicKey;
  try {
    mint = new PublicKey(mintStr);
  } catch {
    steps.push({ key: "address", ok: false, label: "Valid mint address", detail: "That isn't a Solana address." });
    return done();
  }

  const existing = getCoin(mintStr);
  if (existing?.mode === "launch") {
    steps.push({ key: "launched", ok: true, label: "Launched on Feeward", detail: "This coin gives directly; nothing to set up." });
    return done(existing.honoree_handle);
  }

  const curve = (await readCurve(mint)) as any;
  steps.push({ key: "pump", ok: !!curve, label: "Pump.fun coin", detail: curve ? undefined : "No Pump.fun bonding curve at this address." });
  if (!curve) return done();
  const eligible = !curve.isHolderReward && !curve.isCashbackCoin;
  steps.push({ key: "type", ok: eligible, label: "Pays creator fees", detail: eligible ? undefined : "Holder-rewards and cashback coins don't pay creator fees." });
  if (!eligible) return done();

  const sharing = await readSharing(mint);
  const t = treasury().publicKey;
  steps.push({ key: "sharing", ok: !!sharing, label: "Fee sharing turned on", detail: sharing ? undefined : "Open the coin on Pump.fun and set up fee sharing." });
  if (!sharing) return done();

  const holders = sharing.shareholders;
  const whole = holders.length === 1 && holders[0].address.equals(t) && holders[0].shareBps === 10_000;
  const includes = holders.some((h) => h.address.equals(t));
  steps.push({
    key: "whole",
    ok: whole,
    label: "100% of fees to the Feeward treasury",
    detail: whole ? undefined : includes ? "The treasury gets only part of the fees. It has to be 100%, with no other recipients." : `Fees go elsewhere. Add ${t.toBase58()} at 100%.`,
  });
  const locked = !isSharingConfigEditable({ sharingConfig: sharing });
  steps.push({ key: "locked", ok: locked, label: "Fee sharing locked", detail: locked ? undefined : "Revoke the fee-sharing authority on Pump.fun so fees can't be redirected later." });

  const meta = await readTokenMeta(mintStr).catch(() => null);
  const { handle, nonprofitHandle } = parseLine(meta?.description ?? null);
  steps.push({
    key: "line",
    ok: !!handle,
    label: "Honoree named in the description",
    detail: handle ? `@${handle}` : `Add this line to the coin's description: "${LINE_TEMPLATE}".`,
  });
  let user = null;
  if (handle) {
    let xDown = false;
    user = await lookupUser(handle).catch(() => ((xDown = true), null));
    steps.push({
      key: "x",
      ok: !!user,
      label: "Honoree exists on X",
      detail: user ? undefined : xDown ? "Couldn't reach X to check. Try again in a minute." : `@${handle} wasn't found on X.`,
    });
  }
  if (!whole || !locked || !user || existing?.status === "live") return done(handle);

  void nonprofitHandle; // older description lines could name a nonprofit; every coin now falls back to the same one
  const configId = fallbackConfigId();
  if (!configId) {
    steps.push({ key: "nonprofit", ok: false, label: "A nonprofit to start with", detail: "No nonprofits are set up on this server yet." });
    return done(handle);
  }

  const t0 = now();
  db.prepare(
    `INSERT OR REPLACE INTO coins (mint, name, symbol, uri, deployer, honoree_handle, honoree_user_id, config_id, fallback_config_id, mode, vault, routing, status,
       image, description, meta_at, registered_via, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'relay', ?, ?, ?, ?, 'relay', ?, 'sharing', 'live', ?, ?, ?, ?, ?, ?)`
  ).run(mintStr, meta?.name || "Unknown", meta?.symbol || "?", meta?.uri ?? "", user.username, user.id, configId, configId, t.toBase58(),
    meta?.image ?? null, meta?.description ?? null, t0, via, t0, t0);
  db.prepare("INSERT INTO routing_changes (mint, from_config, to_config, reason, signature, created_at) VALUES (?, NULL, ?, 'setup', NULL, ?)").run(mintStr, configId, t0);
  console.log(`relay registered: $${meta?.symbol} for @${user.username} (${via})`);
  return done(handle);
}

/** Finds every fee-sharing config whose first shareholder is the treasury and registers the eligible ones. */
export async function scanTreasury() {
  const t = treasury().publicKey;
  // Sharing config layout: 8 discriminator, 3 header bytes, 32 mint, 32 admin, 1 revoke flag, 4 count, then shareholders.
  const accts = await conn.getProgramAccounts(PUMP_FEE_PROGRAM_ID, { filters: [{ memcmp: { offset: 80, bytes: t.toBase58() } }] });
  for (const a of accts) {
    try {
      const mint = PUMP_SDK.decodeSharingConfig(a.account).mint.toBase58();
      if (getCoin(mint)?.status === "live") continue;
      await checkCoin(mint, "indexer");
    } catch (e) {
      console.error("scan:", (e as Error).message);
    }
  }
}

/** Pays out accrued fees for each relayed coin into the treasury (permissionless on Pump.fun). */
export async function distributeRelayed() {
  for (const c of db.prepare("SELECT mint FROM coins WHERE mode = 'relay' AND status = 'live'").all() as { mint: string }[]) {
    try {
      const mint = new PublicKey(c.mint);
      const min = await pump.getMinimumDistributableFee(mint, treasury().publicKey);
      if (min.canDistribute) await send((await pump.buildDistributeCreatorFeesInstructions(mint, { payer: treasury().publicKey })).instructions, 600_000);
    } catch (e) {
      console.error(`distribute ${c.mint}:`, (e as Error).message);
    }
  }
}

/**
 * Attributes every payment into the treasury to the coin it came from, by reading the
 * transactions themselves. That covers payouts anyone triggered, not just ours.
 */
export async function syncClaims() {
  const t = treasury().publicKey;
  // Relayed coins send all fees here; launched coins send their nonprofit share here while it's held.
  const relayMints = new Set((db.prepare("SELECT mint FROM coins WHERE status = 'live'").all() as { mint: string }[]).map((r) => r.mint));
  const until = kvGet("treasury_sig") ?? undefined;
  const sigs = (await conn.getSignaturesForAddress(t, { until, limit: 1000 }, "confirmed")).filter((s) => !s.err).reverse();
  for (const s of sigs) {
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (tx?.meta) {
      const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses ?? undefined });
      const all = [...keys.staticAccountKeys, ...(keys.accountKeysFromLookups?.writable ?? []), ...(keys.accountKeysFromLookups?.readonly ?? [])];
      const i = all.findIndex((k) => k.equals(t));
      const delta = i >= 0 ? tx.meta.postBalances[i] - tx.meta.preBalances[i] : 0;
      const mints = all.map((k) => k.toBase58()).filter((k) => relayMints.has(k));
      if (delta > 0 && mints.length === 1)
        db.prepare("INSERT OR IGNORE INTO claims (mint, lamports, signature, created_at) VALUES (?, ?, ?, ?)").run(mints[0], delta, s.signature, s.blockTime ?? now());
    }
    kvSet("treasury_sig", s.signature);
  }
}

const claimed = (mint: string) => (db.prepare("SELECT COALESCE(SUM(lamports), 0) t FROM claims WHERE mint = ?").get(mint) as { t: number }).t;
const processed = (mint: string) =>
  (db.prepare("SELECT COALESCE(SUM(lamports + platform_lamports + buyback_lamports + held_lamports), 0) t FROM forwards WHERE mint = ?").get(mint) as { t: number }).t;
/** Treasury funds attributed to a coin that haven't been forwarded or set aside yet. */
export const relayPending = (mint: string) => Math.max(0, claimed(mint) - processed(mint));
/** The nonprofit share set aside for the honoree, waiting for them to choose. */
export const heldBalance = (mint: string) => (db.prepare("SELECT COALESCE(SUM(held_lamports), 0) t FROM forwards WHERE mint = ?").get(mint) as { t: number }).t;
export const relayTotal = (mint: string) => (db.prepare("SELECT COALESCE(SUM(lamports), 0) t FROM forwards WHERE mint = ?").get(mint) as { t: number }).t;

/** How a pending treasury amount splits for this coin. Launched coins only send their nonprofit share to the treasury. */
function splitPending(c: Coin, pending: number) {
  if (c.mode !== "relay") return { charity: pending, platform: 0, buyback: 0 };
  const platform = Math.floor((pending * cfg.PLATFORM_BPS) / 10_000);
  const buyback = Math.floor((pending * cfg.BUYBACK_BPS) / 10_000);
  return { charity: pending - platform - buyback, platform, buyback };
}

/** Where a coin's recipient share goes right now, or null while it's held. */
export function payoutTarget(c: Coin): { kind: "wallet"; wallet: string } | { kind: "nonprofit"; configId: string } | null {
  if (c.released_at) return { kind: "nonprofit", configId: coinFallback(c) };
  if (c.payout_kind === "wallet" && c.payout_wallet) return { kind: "wallet", wallet: c.payout_wallet };
  if (c.payout_kind === "nonprofit" && c.payout_config_id) return { kind: "nonprofit", configId: c.payout_config_id };
  return null;
}

/** Held amount plus the recipient share of what's pending: what's waiting for the recipient. */
export const waitingFor = (c: Coin) => heldBalance(c.mint) + (isHolding(c) ? splitPending(c, relayPending(c.mint)).charity : 0);

/**
 * Processes a coin's treasury funds. While the honoree hasn't chosen, the nonprofit share is set
 * aside (it stays in the treasury) and only the platform and buyback shares go out. Once they've
 * chosen (or the hold period has passed), everything set aside goes to the chosen nonprofit.
 */
export async function forwardCoin(c: Coin): Promise<number> {
  const pending = relayPending(c.mint);
  const held = heldBalance(c.mint);
  const holding = isHolding(c);
  if (pending < MIN_FORWARD && (holding || held === 0)) return 0;
  const { charity, platform, buyback } = pending >= MIN_FORWARD ? splitPending(c, pending) : { charity: 0, platform: 0, buyback: 0 };
  const insert = db.prepare(
    "INSERT INTO forwards (mint, config_id, lamports, platform_lamports, buyback_lamports, held_lamports, signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );

  if (holding) {
    const sig = await sendSplit(treasury(), null, 0, platform, buyback);
    insert.run(c.mint, c.config_id, 0, platform, buyback, charity, sig ?? `hold:${c.mint}:${now()}:${Math.random().toString(36).slice(2, 8)}`, now());
    return 0;
  }

  const target = payoutTarget(c);
  if (!target) return 0;
  const release = charity + held;
  const available = (await conn.getBalance(treasury().publicKey, "confirmed")) - VAULT_RESERVE;
  if (release + platform + buyback > available) {
    const short = release + platform + buyback - available;
    // The treasury keeps a small reserve so its account stays open; the server wallet tops it up when that's all that's missing.
    if (short > VAULT_RESERVE + 1_000_000) {
      console.error(`treasury short for ${c.mint}: needs ${release + platform + buyback}, has ${available}`);
      return 0;
    }
    await send([SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: treasury().publicKey, lamports: short })]);
    console.log(`treasury reserve topped up by ${short} lamports`);
  }
  // Wallet payouts go straight to the recipient's verified wallet. Nonprofit payouts go to that nonprofit's
  // donate.gg escrow on the escrow host coin (HOUSE_MINT): Pump.fun locks a coin's own fee split after setup.
  const dest = target.kind === "wallet" ? new PublicKey(target.wallet) : await houseEscrow(target.configId);
  const configId = target.kind === "wallet" ? "wallet" : target.configId;
  const wallet = target.kind === "wallet" ? target.wallet : null;
  const sig = await sendSplit(treasury(), dest, release, platform, buyback);
  if (!sig) return 0;
  db.prepare(
    "INSERT INTO forwards (mint, config_id, lamports, platform_lamports, buyback_lamports, held_lamports, signature, wallet, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(c.mint, configId, release, platform, buyback, -held, sig, wallet, now());
  addDonation(c.mint, configId, release, c.mode === "relay" ? "relay" : "direct", sig, wallet);
  updateCoin(c.mint, { donated_lamports: relayTotal(c.mint) });
  return release;
}

/**
 * Fallback: funds go to the coin's fallback nonprofit, now and from then on. Happens when the recipient
 * declines, or when no payout destination is set within HOLD_DAYS of launch.
 */
export async function activateFallback(c: Coin, reason: "deadline" | "declined"): Promise<number> {
  const configId = coinFallback(c);
  db.prepare("INSERT INTO routing_changes (mint, from_config, to_config, reason, signature, created_at) VALUES (?, NULL, ?, 'fallback', NULL, ?)").run(c.mint, configId, now());
  updateCoin(c.mint, { released_at: now() });
  addEvent(c.mint, "fallback", { detail: `${reason}: ${getCharity(configId)?.name ?? configId}` });
  return forwardCoin(getCoin(c.mint)!);
}

export async function releaseExpired() {
  if (!cfg.HOLD_DAYS) return;
  const cutoff = now() - cfg.HOLD_DAYS * 86400;
  const due = db.prepare("SELECT * FROM coins WHERE status = 'live' AND payout_kind IS NULL AND released_at IS NULL AND created_at < ?").all(cutoff) as Coin[];
  for (const c of due) {
    try {
      const sent = await activateFallback(c, "deadline");
      const after = getCoin(c.mint)!;
      const to = charityName(coinFallback(c));
      const amount = `${(sent / 1e9).toFixed(2)} SOL`;
      const who = c.recipient_handle ? `@${c.recipient_handle} didn't choose where funds go` : c.opted_out ? "No recipient was chosen" : `@${c.honoree_handle} didn't choose a recipient`;
      await coinPost(
        c.mint,
        "fallback",
        `${who} within ${cfg.HOLD_DAYS} days, so ${sent ? `${amount} from $${c.symbol} creator fees was sent to ${to}` : `$${c.symbol}'s recipient share now goes to ${to}`}, and future fees go there too.`,
        c.announce_tweet,
        sent ? await cardFor(after, "sent", amount) : null
      );
    } catch (e) {
      console.error(`release ${c.mint}:`, (e as Error).message);
    }
  }
}

/** "@StJude" if we know the nonprofit's handle, else its name. */
export function charityName(configId: string) {
  const ch = getCharity(configId);
  return ch?.x_handle ? `@${ch.x_handle}` : ch?.name ?? "the fallback nonprofit";
}
