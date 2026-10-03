import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { randomBytes, randomUUID } from "node:crypto";
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import { z } from "zod";
import { CHARITY_BPS, FALLBACK_CONFIG, PLATFORM_COIN, cfg, LAMPORTS, RELAY_ON } from "./config.js";
import { db, getCharity, getCoin, isHolding, now, routingState, updateCoin, type Charity, type Coin } from "./db.js";
import { authority, buybackWallet, isWallet, submit } from "./chain.js";
import { auditLive, buildLaunch, checkHouse, switchCharity, verifyRelayRouting } from "./pump.js";
import { LINE_TEMPLATE, checkCoin, coinFallback, fallbackConfigId, forwardCoin, heldBalance, relayPending, treasury, waitingFor } from "./relay.js";
import { accruedFees, getHonoree, readTokenMeta } from "./market.js";
import { cardFor } from "./cards.js";
import { botPost, finishLogin, lookupUser, startLogin } from "./x.js";
import { pinMetadata } from "./metadata.js";
import { ROUTER_ID, feeAdmin } from "./router.js";
import { activate, buybackTotals, fmtUsd, solUsd, usd } from "./worker.js";
import { RoleError, declineRecipient, lockRecipient, setPayout, walletChallenge } from "./roles.js";


const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

const charityInfo = (id: string | null | undefined) => {
  const ch = id ? getCharity(id) : undefined;
  return ch ? { config_id: ch.config_id, name: ch.name, x_handle: ch.x_handle, url: ch.url } : null;
};

function publicCoin(c: Coin) {
  const h = c.opted_out ? undefined : getHonoree(c.honoree_user_id);
  const r = c.recipient_user_id ? getHonoree(c.recipient_user_id) : undefined;
  const state = routingState(c);
  const holding = isHolding(c);
  const fallback = charityInfo(coinFallback(c));
  const payoutNonprofit = state === "active" && c.payout_kind === "nonprofit" ? charityInfo(c.payout_config_id) : null;
  return {
    mint: c.mint,
    name: c.name,
    symbol: c.symbol,
    image: c.image,
    mcap_lamports: c.mcap_lamports,
    // Chooser: the X account the coin is named for. (Kept as honoree* for older clients.)
    honoree: c.opted_out ? null : c.honoree_handle,
    honoree_name: h?.name ?? null,
    honoree_avatar: h?.avatar ?? null,
    // Recipient: locked permanently once chosen. Handle refreshed from the stable X id.
    recipient: c.recipient_user_id ? r?.handle ?? c.recipient_handle : null,
    recipient_name: r?.name ?? null,
    recipient_avatar: r?.avatar ?? null,
    recipient_is_chooser: !!c.recipient_user_id && c.recipient_user_id === c.honoree_user_id,
    recipient_selected_at: c.recipient_selected_at,
    recipient_selected_via: c.recipient_selected_via,
    selection_tweet: c.selection_tweet_id,
    // @FeeFlowApp's post about this coin: the chooser can reply to it with the recipient's @handle.
    announce_tweet: c.announce_tweet,
    recipient_declined_at: c.recipient_declined_at,
    state,
    payout:
      state === "active"
        ? { kind: c.payout_kind, wallet: c.payout_kind === "wallet" ? c.payout_wallet : null, nonprofit: payoutNonprofit, set_at: c.routing_set_at }
        : null,
    fallback,
    fallback_at: c.released_at,
    registered_via: c.registered_via,
    holding,
    waiting_lamports: holding ? waitingFor(c) : heldBalance(c.mint),
    release_at: holding && cfg.HOLD_DAYS ? c.created_at + cfg.HOLD_DAYS * 86400 : null,
    released_by_fallback: state === "fallback" || state === "declined",
    opted_out: !!c.opted_out,
    // The nonprofit funds currently go to, if any: the recipient's pick, or the fallback once it's active.
    charity: payoutNonprofit ?? (state === "fallback" || state === "declined" ? fallback : null),
    mode: c.mode,
    vault: c.mode === "relay" ? c.vault : null,
    status: c.status,
    donated_lamports: c.donated_lamports,
    created_at: c.created_at,
  };
}

/**
 * Wallets may add their own safety checks before signing (Phantom adds Lighthouse assertion
 * instructions and can adjust the priority fee). Those are fine; anything else is not. Returns why the
 * signed launch differs from the one we built, or null if every instruction we built is there unchanged,
 * with the same payer and signers, and the only extras are compute-budget or Lighthouse instructions.
 */
const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPPUCZRVw7aYMV5hD2V8fCg";
const BUDGET = ComputeBudgetProgram.programId.toBase58();
export function launchMismatch(builtB64: string, signed: VersionedTransaction): string | null {
  if (Buffer.from(signed.message.serialize()).toString("base64") === builtB64) return null;
  if (signed.message.addressTableLookups?.length) return "the wallet added address lookup tables";
  const builtMsg = VersionedMessage.deserialize(Buffer.from(builtB64, "base64"));
  const ours = TransactionMessage.decompile(builtMsg);
  const theirs = TransactionMessage.decompile(signed.message);
  if (!theirs.payerKey.equals(ours.payerKey)) return "the fee payer changed";
  const signers = (m: VersionedMessage) => m.staticAccountKeys.slice(0, m.header.numRequiredSignatures).map((k) => k.toBase58()).sort().join(",");
  if (signers(signed.message) !== signers(builtMsg)) return "the signers changed";
  const sig = (ix: TransactionMessage["instructions"][number]) =>
    JSON.stringify([ix.programId.toBase58(), ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner]), Buffer.from(ix.data).toString("base64")]);
  const a = ours.instructions.filter((ix) => ix.programId.toBase58() !== BUDGET).map(sig);
  const extra = theirs.instructions.filter((ix) => ![BUDGET, LIGHTHOUSE].includes(ix.programId.toBase58()));
  const b = extra.map(sig);
  if (a.length === b.length && a.every((x, i) => x === b[i])) return null;
  const unknown = [...new Set(extra.map((ix) => ix.programId.toBase58()).filter((p) => !ours.instructions.some((o) => o.programId.toBase58() === p)))];
  return unknown.length ? `the wallet added instructions for ${unknown.join(", ")}` : "the launch instructions changed";
}

/** "@name", "name", "x.com/name" or a full link → a full https link (null if empty). */
function socialLink(v: string | undefined, base: string, field: string): string | undefined {
  const s = (v ?? "").trim();
  if (!s) return undefined;
  if (base !== "https://" && /^@?[A-Za-z0-9_]{1,32}$/.test(s)) return `${base}${s.replace(/^@/, "")}`;
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(url);
    if (!u.hostname.includes(".")) throw new Error();
    return u.toString();
  } catch {
    throw Object.assign(new Error(`That ${field} link doesn't look right.`), { statusCode: 400 });
  }
}

const LaunchBody = z.object({
  deployer: z.string().refine(isWallet, "Connect a Solana wallet first."),
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().transform((s) => s.replace(/^\$/, "").toUpperCase()).pipe(z.string().regex(/^[A-Z0-9]{1,10}$/, "Ticker must be 1-10 letters or numbers")),
  description: z.string().trim().max(400).default(""),
  image: z.string().optional(),
  uri: z.string().url().optional(),
  honoree: z.string().trim().min(1),
  // The coin's own links, shown on Pump.fun like any coin's. All optional.
  twitter: z.string().trim().max(200).optional(),
  website: z.string().trim().max(200).optional(),
  telegram: z.string().trim().max(200).optional(),
  dev_buy_sol: z.coerce.number().min(0).max(50).default(0),
});

// Small per-IP limiter on launch builds (each one costs X and RPC calls).
const hits = new Map<string, number[]>();
const allow = (ip: string, max: number) => {
  const t = Date.now();
  const recent = (hits.get(ip) ?? []).filter((x) => t - x < 3_600_000);
  hits.set(ip, [...recent, t]);
  return recent.length < max;
};

const auditCache = new Map<string, { at: number; value: unknown }>();

/** The platform coin's ticker, read once from its own metadata. */
let platformSymbol: { mint: string; symbol: string | null } | null = null;
async function platformCoinSymbol(): Promise<string | null> {
  if (!PLATFORM_COIN) return null;
  if (platformSymbol?.mint === PLATFORM_COIN && platformSymbol.symbol) return platformSymbol.symbol;
  const meta = await readTokenMeta(PLATFORM_COIN).catch(() => null);
  platformSymbol = { mint: PLATFORM_COIN, symbol: meta?.symbol || null };
  return platformSymbol.symbol;
}

export async function buildServer() {
  const app = Fastify({ logger: { level: "info" }, trustProxy: true, bodyLimit: 4 * 1024 * 1024 });
  await app.register(fastifyCookie, { secret: cfg.SESSION_SECRET });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => i.message).join("; ") });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: "Something broke on our side. Try again in a minute." });
  });

  const session = (req: any): { x_user_id: string; x_handle: string } | null => {
    const raw = req.cookies?.sid;
    if (!raw) return null;
    const un = req.unsignCookie(raw);
    if (!un.valid || !un.value) return null;
    return (db.prepare("SELECT x_user_id, x_handle FROM sessions WHERE sid = ?").get(un.value) as any) ?? null;
  };


  // ----- public reads -----

  if (RELAY_ON) {
    const problem = await checkHouse().catch((e) => `couldn't check HOUSE_MINT: ${e.message}`);
    if (problem) app.log.warn(`relay mode: ${problem}`);
  }

  app.get("/api/config", async () => ({
    relay: RELAY_ON,
    hold_days: cfg.HOLD_DAYS,
    treasury: treasury().publicKey.toBase58(),
    router: ROUTER_ID?.toBase58() ?? null,
    fee_admin: feeAdmin().toBase58(),
    charity_bps: CHARITY_BPS,
    platform_bps: cfg.PLATFORM_BPS,
    buyback_bps: cfg.BUYBACK_BPS,
    platform_coin: PLATFORM_COIN ?? null,
    platform_coin_symbol: await platformCoinSymbol(),
    buyback_wallet: buybackWallet.publicKey.toBase58(),
    buybacks: buybackTotals(),
    fallback: charityInfo(fallbackConfigId()),
    authority: authority.publicKey.toBase58(),
    upload: true,
    sol_usd: await solUsd(),
  }));

  // Share-card image for a coin (link previews on X and elsewhere). Cached for 10 minutes.
  const cardCache = new Map<string, { at: number; png: Buffer }>();
  app.get("/api/cards/:file", async (req, reply) => {
    const mint = String((req.params as any).file).replace(/\.png$/, "");
    const c = getCoin(mint);
    if (!c || c.status !== "live") throw httpError(404, "No coin with that address here.");
    const hit = cardCache.get(mint);
    let png = hit && Date.now() - hit.at < 600_000 ? hit.png : null;
    if (!png) {
      const holding = isHolding(c);
      png = await cardFor(c, holding ? "waiting" : "sent", fmtUsd(await usd(holding ? waitingFor(c) : c.donated_lamports)));
      if (!png) throw httpError(503, "Couldn't draw the card right now.");
      cardCache.set(mint, { at: Date.now(), png });
    }
    return reply.type("image/png").header("cache-control", "public, max-age=600").send(png);
  });

  app.get("/api/charities", async (req) => {
    const q = String((req.query as any).q ?? "").trim();
    const rows = q
      ? db.prepare("SELECT * FROM charities WHERE active = 1 AND (name LIKE ? OR x_handle LIKE ?) ORDER BY name LIMIT 50").all(`%${q}%`, `%${q}%`)
      : db.prepare("SELECT * FROM charities WHERE active = 1 ORDER BY name LIMIT 200").all();
    return { charities: (rows as Charity[]).map(({ config_id, name, x_handle, url }) => ({ config_id, name, x_handle, url })) };
  });

  app.get("/api/buybacks", async () => ({
    sol_usd: await solUsd(),
    platform_coin: PLATFORM_COIN ?? null,
    totals: buybackTotals(),
    recent: db.prepare("SELECT lamports, tokens_raw, buy_sig, burn_sig, created_at FROM buybacks ORDER BY id DESC LIMIT 50").all(),
  }));

  const SORTS: Record<string, string> = { given: "donated_lamports DESC", mcap: "mcap_lamports DESC", new: "created_at DESC" };
  app.get("/api/coins", async (req) => {
    const q = req.query as { sort?: string; mode?: string; config?: string; limit?: string };
    const where = ["status = 'live'"];
    const args: unknown[] = [];
    if (q.mode === "launch" || q.mode === "relay") (where.push("mode = ?"), args.push(q.mode));
    if (q.config) (where.push("((payout_kind = 'nonprofit' AND payout_config_id = ?) OR (released_at IS NOT NULL AND COALESCE(fallback_config_id, config_id) = ?))"), args.push(q.config, q.config));
    const limit = Math.min(Number(q.limit) || 200, 500);
    const rows = db.prepare(`SELECT * FROM coins WHERE ${where.join(" AND ")} ORDER BY ${SORTS[q.sort ?? "given"] ?? SORTS.given} LIMIT ${limit}`).all(...args) as Coin[];
    return { sol_usd: await solUsd(), coins: rows.map(publicCoin) };
  });

  app.get("/api/honorees", async () => ({
    sol_usd: await solUsd(),
    honorees: db
      .prepare(
        `SELECT c.honoree_handle AS handle, h.name, h.avatar, SUM(c.donated_lamports) AS donated_lamports, COUNT(*) AS coins
         FROM coins c LEFT JOIN honorees h ON h.user_id = c.honoree_user_id
         WHERE c.status = 'live' AND c.opted_out = 0 GROUP BY c.honoree_user_id ORDER BY donated_lamports DESC LIMIT 100`
      )
      .all(),
  }));

  /** One honoree: who they are on X, what's been given in their name, and where. */
  app.get("/api/profile/:handle", async (req) => {
    const handle = String((req.params as any).handle).replace(/^@/, "");
    const coins = db.prepare("SELECT * FROM coins WHERE status = 'live' AND opted_out = 0 AND lower(honoree_handle) = lower(?) ORDER BY donated_lamports DESC").all(handle) as Coin[];
    if (!coins.length) throw httpError(404, `Nothing has been given in @${handle}'s name yet.`);
    const h = getHonoree(coins[0].honoree_user_id);
    const nonprofits = db
      .prepare(
        `SELECT d.config_id, ch.name, ch.x_handle, SUM(d.lamports) AS lamports FROM donations d JOIN coins c ON c.mint = d.mint
         LEFT JOIN charities ch ON ch.config_id = d.config_id
         WHERE c.honoree_user_id = ? AND d.kind = 'donation' GROUP BY d.config_id ORDER BY lamports DESC`
      )
      .all(coins[0].honoree_user_id);
    return {
      sol_usd: await solUsd(),
      profile: { handle: coins[0].honoree_handle, name: h?.name ?? null, avatar: h?.avatar ?? null, total_lamports: coins.reduce((a, c) => a + c.donated_lamports, 0), coins: coins.length },
      coins: coins.map(publicCoin),
      nonprofits,
    };
  });

  app.get("/api/nonprofits", async () => ({
    sol_usd: await solUsd(),
    nonprofits: db
      .prepare(
        `SELECT ch.config_id, ch.name, ch.x_handle, ch.url,
           COALESCE((SELECT SUM(lamports) FROM donations d WHERE d.config_id = ch.config_id), 0) AS received_lamports,
           (SELECT COUNT(*) FROM coins c WHERE c.status = 'live' AND ((c.payout_kind = 'nonprofit' AND c.payout_config_id = ch.config_id)
              OR (c.released_at IS NOT NULL AND COALESCE(c.fallback_config_id, c.config_id) = ch.config_id))) AS coins
         FROM charities ch WHERE ch.active = 1 ORDER BY received_lamports DESC, ch.name`
      )
      .all(),
  }));

  app.get("/api/nonprofits/:id", async (req) => {
    const ch = getCharity((req.params as any).id);
    if (!ch) throw httpError(404, "No nonprofit with that id.");
    const received = (db.prepare("SELECT COALESCE(SUM(lamports), 0) t FROM donations WHERE config_id = ?").get(ch.config_id) as { t: number }).t;
    const coins = db
      .prepare(
        `SELECT * FROM coins WHERE status = 'live' AND ((payout_kind = 'nonprofit' AND payout_config_id = ?) OR (released_at IS NOT NULL AND COALESCE(fallback_config_id, config_id) = ?))
         ORDER BY donated_lamports DESC`
      )
      .all(ch.config_id, ch.config_id) as Coin[];
    return { sol_usd: await solUsd(), nonprofit: { config_id: ch.config_id, name: ch.name, x_handle: ch.x_handle, url: ch.url, received_lamports: received }, coins: coins.map(publicCoin) };
  });

  /** The public donation feed. Filter by coin, nonprofit or honoree; page with `before` (an id). */
  app.get("/api/donations", async (req) => {
    const q = req.query as { mint?: string; config?: string; handle?: string; before?: string; limit?: string };
    const where = ["1 = 1"];
    const args: unknown[] = [];
    if (q.mint) (where.push("d.mint = ?"), args.push(q.mint));
    if (q.config) (where.push("d.config_id = ?"), args.push(q.config));
    if (q.handle) (where.push("lower(c.honoree_handle) = lower(?) AND c.opted_out = 0"), args.push(q.handle.replace(/^@/, "")));
    if (q.before) (where.push("d.id < ?"), args.push(Number(q.before)));
    const limit = Math.min(Number(q.limit) || 50, 200);
    const rows = db
      .prepare(
        `SELECT d.id, d.mint, d.config_id, d.lamports, d.source, d.signature, d.kind, d.wallet, d.created_at, c.recipient_handle AS recipient,
           c.symbol, c.name, c.image, CASE WHEN c.opted_out = 1 THEN NULL ELSE c.honoree_handle END AS honoree,
           CASE WHEN c.opted_out = 1 THEN NULL ELSE h.avatar END AS honoree_avatar, ch.name AS nonprofit, ch.x_handle AS nonprofit_handle
         FROM donations d JOIN coins c ON c.mint = d.mint LEFT JOIN honorees h ON h.user_id = c.honoree_user_id
         LEFT JOIN charities ch ON ch.config_id = d.config_id
         WHERE ${where.join(" AND ")} ORDER BY d.id DESC LIMIT ${limit}`
      )
      .all(...args);
    return { sol_usd: await solUsd(), donations: rows };
  });

  /** Totals and a daily series for the analytics page. */
  app.get("/api/stats", async (req) => {
    const range = String((req.query as any).range ?? "30d");
    const since = range === "1d" ? now() - 86400 : range === "7d" ? now() - 7 * 86400 : range === "all" ? 0 : now() - 30 * 86400;
    const one = <T,>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as T;
    const donated = one<{ t: number; n: number }>("SELECT COALESCE(SUM(lamports), 0) t, COUNT(*) n FROM donations WHERE created_at >= ?", since);
    const byKind = one<{ d: number; s: number }>(
      "SELECT COALESCE(SUM(CASE WHEN kind = 'donation' THEN lamports END), 0) d, COALESCE(SUM(CASE WHEN kind = 'support' THEN lamports END), 0) s FROM donations WHERE created_at >= ?",
      since
    );
    const bucket = range === "1d" ? 3600 : 86400;
    const series = db
      .prepare(`SELECT (created_at / ${bucket}) * ${bucket} AS t, SUM(lamports) AS lamports FROM donations WHERE created_at >= ? GROUP BY 1 ORDER BY 1`)
      .all(since);
    const forwardsCut = one<{ p: number; b: number }>("SELECT COALESCE(SUM(platform_lamports), 0) p, COALESCE(SUM(buyback_lamports), 0) b FROM forwards WHERE created_at >= ?", since);
    return {
      sol_usd: await solUsd(),
      range,
      donated_lamports: donated.t,
      donation_lamports: byKind.d,
      support_lamports: byKind.s,
      donations: donated.n,
      coins: one<{ n: number }>("SELECT COUNT(*) n FROM coins WHERE status = 'live'").n,
      coins_new: one<{ n: number }>("SELECT COUNT(*) n FROM coins WHERE status = 'live' AND created_at >= ?", since).n,
      honorees: one<{ n: number }>("SELECT COUNT(DISTINCT honoree_user_id) n FROM coins WHERE status = 'live'").n,
      honorees_chose: one<{ n: number }>("SELECT COUNT(DISTINCT honoree_user_id) n FROM coins WHERE status = 'live' AND recipient_user_id IS NOT NULL").n,
      recipients: one<{ n: number }>("SELECT COUNT(DISTINCT recipient_user_id) n FROM coins WHERE status = 'live' AND recipient_user_id IS NOT NULL").n,
      nonprofits: one<{ n: number }>("SELECT COUNT(DISTINCT config_id) n FROM donations WHERE kind = 'donation'").n,
      buyback_lamports: one<{ t: number }>("SELECT COALESCE(SUM(lamports), 0) t FROM buybacks WHERE created_at >= ?", since).t,
      held_lamports: one<{ t: number }>("SELECT COALESCE(SUM(held_lamports), 0) t FROM forwards").t,
      relay_platform_lamports: forwardsCut.p,
      relay_buyback_lamports: forwardsCut.b,
      series,
      top_nonprofits: db
        .prepare(`SELECT d.config_id, ch.name, SUM(d.lamports) lamports FROM donations d LEFT JOIN charities ch ON ch.config_id = d.config_id WHERE d.created_at >= ? AND d.kind = 'donation' GROUP BY d.config_id ORDER BY lamports DESC LIMIT 8`)
        .all(since),
    };
  });

  // X profile preview for the launch guide (cached, rate-limited).
  const lookups = new Map<string, { at: number; value: unknown }>();
  app.get("/api/x/lookup", async (req) => {
    const handle = String((req.query as any).handle ?? "").replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw httpError(400, "That isn't an X handle.");
    const key = handle.toLowerCase();
    const hit = lookups.get(key);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.value;
    if (!allow(`x:${req.ip}`, 60)) throw httpError(429, "Too many lookups. Try again soon.");
    let u;
    try {
      u = await lookupUser(handle);
    } catch {
      // Don't report "not found" (or cache anything) when X itself didn't answer.
      throw httpError(503, "Couldn't reach X to check that handle. Try again in a minute.");
    }
    const value = { found: !!u, handle: u?.username ?? handle, name: u?.name ?? null, avatar: u?.avatar ?? null };
    lookups.set(key, { at: Date.now(), value });
    return value;
  });

  app.get("/api/coins/:mint", async (req) => {
    const c = getCoin((req.params as any).mint);
    if (!c || c.status === "built") throw httpError(404, "No coin with that address here.");
    if (c.status === "pending") return { sol_usd: await solUsd(), coin: publicCoin(c), changes: [], forwards: [], audit: null, me: session(req), honoree_id_match: false };
    const changes = db
      .prepare("SELECT from_config, to_config, reason, signature, created_at FROM routing_changes WHERE mint = ? ORDER BY id DESC")
      .all(c.mint)
      .map((r: any) => ({ ...r, to_name: getCharity(r.to_config)?.name ?? r.to_config, from_name: r.from_config ? getCharity(r.from_config)?.name ?? r.from_config : null }));

    let audit: unknown = null;
    if (c.status === "live") {
      const cached = auditCache.get(c.mint);
      if (cached && Date.now() - cached.at < 60_000) audit = cached.value;
      else {
        audit =
          c.mode === "relay"
            ? await verifyRelayRouting(c.mint, c.vault!).then(
                () => ({ ok: true, problems: [] }),
                (e) => (e?.statusCode === 422 ? { ok: false, problems: [e.message] } : { ok: false, unchecked: true, problems: [] })
              )
            : await auditLive(c.mint, null).catch(() => ({ ok: false, unchecked: true, problems: [] }));
        auditCache.set(c.mint, { at: Date.now(), value: audit });
      }
    }
    // Completed payouts only (rows that moved the recipient share), with their public transactions.
    const forwards = (
      db
        .prepare("SELECT config_id, wallet, lamports, platform_lamports, buyback_lamports, signature, created_at FROM forwards WHERE mint = ? AND lamports > 0 ORDER BY id DESC LIMIT 100")
        .all(c.mint) as any[]
    ).map((f) => ({ ...f, kind: f.wallet ? "support" : "donation", charity: f.wallet ? null : getCharity(f.config_id)?.name ?? f.config_id }));
    const events = db.prepare("SELECT kind, actor_handle, detail, tweet_id, created_at FROM coin_events WHERE mint = ? ORDER BY id DESC LIMIT 50").all(c.mint);
    const me = session(req);
    const fees = c.status === "live" ? await accruedFees(c.mint, c.mode === "relay" ? treasury().publicKey : authority.publicKey) : null;
    return {
      sol_usd: await solUsd(),
      coin: {
        ...publicCoin(c),
        description: c.description,
        pending_lamports: relayPending(c.mint),
        accrued_lamports: fees?.accrued ?? null,
        accrue_min_lamports: fees?.minimum ?? null,
      },
      changes,
      forwards,
      events,
      audit,
      me,
      honoree_id_match: me?.x_user_id === c.honoree_user_id,
      is_chooser: me?.x_user_id === c.honoree_user_id,
      is_recipient: !!c.recipient_user_id && me?.x_user_id === c.recipient_user_id,
    };
  });

  // ----- launch -----

  app.post("/api/launch/build", async (req) => {
    if (!allow(req.ip, 15)) throw httpError(429, "Too many launches from this connection. Try again in an hour.");
    const b = LaunchBody.parse(req.body);
    const fallbackId = fallbackConfigId();
    const charity = fallbackId ? getCharity(fallbackId) : undefined;
    if (!charity) throw httpError(503, "No fallback nonprofit is set up on this server yet.");
    const honoree = await lookupUser(b.honoree);
    if (!honoree) throw httpError(400, `Couldn't find @${b.honoree.replace(/^@/, "")} on X.`);

    // Spelled out in the coin's own metadata, so nobody mistakes the naming for an endorsement.
    const description = [
      b.description,
      `Fees via ${cfg.PUBLIC_URL.replace(/^https?:\/\//, "")}: @${honoree.username} chooses who receives 90% of this coin's creator fees (any X account, including themselves)${cfg.HOLD_DAYS ? `; unclaimed after ${cfg.HOLD_DAYS} days go to ${charity.name}` : ""}. @${honoree.username} has not endorsed this coin.`,
    ].filter(Boolean).join("\n\n");

    let uri = b.uri;
    if (!uri) {
      if (!b.image) throw httpError(400, "Add an image or paste a metadata URI.");
      uri = await pinMetadata({
        name: b.name,
        symbol: b.symbol,
        description,
        imageDataUrl: b.image,
        twitter: socialLink(b.twitter, "https://x.com/", "X"),
        website: socialLink(b.website, "https://", "website"),
        telegram: socialLink(b.telegram, "https://t.me/", "Telegram"),
      });
    }

    const built = await buildLaunch({
      deployer: new PublicKey(b.deployer),
      name: b.name,
      symbol: b.symbol,
      uri,
      devBuyLamports: Math.round(b.dev_buy_sol * LAMPORTS),
    });
    const t = now();
    db.prepare(
      `INSERT INTO coins (mint, name, symbol, uri, deployer, honoree_handle, honoree_user_id, config_id, fallback_config_id, status, built_message, built_mint_secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'built', ?, ?, ?, ?)`
    ).run(built.mint, b.name, b.symbol, uri, b.deployer, honoree.username, honoree.id, charity.config_id, charity.config_id, built.message, built.mintSecret, t, t);
    return { mint: built.mint, tx: built.tx };
  });

  app.post("/api/launch/submit", async (req) => {
    const { mint, tx } = z.object({ mint: z.string(), tx: z.string() }).parse(req.body);
    const c = getCoin(mint);
    if (!c || c.status !== "built") throw httpError(404, "That launch expired. Start again.");
    const signed = VersionedTransaction.deserialize(Buffer.from(tx, "base64"));
    // The wallet may only add its signature; any change to what we built is rejected.
    // The wallet may add its own safety checks; any change to what we built is rejected.
    const mismatch = launchMismatch(c.built_message!, signed);
    if (mismatch) {
      console.error(`launch ${mint} rejected: ${mismatch}`);
      throw httpError(400, `The signed transaction doesn't match the one we built (${mismatch}). Start again.`);
    }
    if (!c.built_mint_secret) throw httpError(404, "That launch expired. Start again.");
    // The wallet signed first; now add the new coin's own signature.
    signed.sign([Keypair.fromSecretKey(Buffer.from(c.built_mint_secret, "base64"))]);
    let sig: string;
    try {
      sig = await submit(signed);
    } catch (e) {
      throw httpError(400, `The launch transaction failed: ${(e as Error).message}`);
    }
    updateCoin(mint, { status: "launched", launch_sig: sig, built_message: null, built_mint_secret: null });
    activate(getCoin(mint)!).catch(() => {}); // worker retries if this fails
    return { mint, signature: sig };
  });

  // ----- relay mode: any Pump.fun coin, no sign-up -----

  app.get("/api/relay/info", async () => ({
    enabled: RELAY_ON,
    treasury: RELAY_ON ? treasury().publicKey.toBase58() : null,
    line: LINE_TEMPLATE,
  }));

  /** Checks a coin against every relay condition and registers it right away if it passes. */
  app.post("/api/check", async (req) => {
    if (!RELAY_ON) throw httpError(404, "This server only supports coins launched on FeeFlow.");
    if (!allow(`check:${req.ip}`, 30)) throw httpError(429, "Too many checks. Try again in a few minutes.");
    const { mint } = z.object({ mint: z.string().trim().min(32).max(44) }).parse(req.body);
    return checkCoin(mint, "site");
  });

  // ----- honoree -----

  app.get("/auth/x/start", async (req, reply) => {
    const mint = String((req.query as any).mint ?? "");
    if (!getCoin(mint)) throw httpError(404, "No coin with that address here.");
    const { url, codeVerifier, state } = startLogin();
    db.prepare("DELETE FROM oauth_states WHERE created_at < ?").run(now() - 900);
    db.prepare("INSERT INTO oauth_states (state, verifier, mint, created_at) VALUES (?, ?, ?, ?)").run(state, codeVerifier, mint, now());
    return reply.redirect(url);
  });

  app.get("/auth/x/callback", async (req, reply) => {
    const { state, code } = req.query as { state?: string; code?: string };
    const row = state ? (db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state) as any) : null;
    if (!row || !code) return reply.redirect("/?login=failed");
    db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    const me = await finishLogin(code, row.verifier);
    const sid = randomBytes(24).toString("hex");
    db.prepare("INSERT INTO sessions (sid, x_user_id, x_handle, created_at) VALUES (?, ?, ?, ?)").run(sid, me.id, me.username, now());
    reply.setCookie("sid", sid, { signed: true, httpOnly: true, sameSite: "lax", secure: cfg.PUBLIC_URL.startsWith("https"), path: "/", maxAge: 7 * 86400 });
    return reply.redirect(`/c/${row.mint}#act`);
  });

  const liveCoinFor = (req: any) => {
    const me = session(req);
    if (!me) throw httpError(401, "Log in with X first.");
    const c = getCoin(req.params.mint);
    if (!c || c.status !== "live") throw httpError(404, "No live coin with that address here.");
    return { me, c };
  };
  /** The chooser: the X account the coin is named for (matched by X id). */
  const requireChooser = (req: any) => {
    const { me, c } = liveCoinFor(req);
    if (me.x_user_id !== c.honoree_user_id) throw httpError(403, `You're logged in as @${me.x_handle}. Only @${c.honoree_handle} can choose this coin's recipient.`);
    return { me, c };
  };
  /** The recipient: the X account the chooser locked in (matched by X id). */
  const requireRecipient = (req: any) => {
    const { me, c } = liveCoinFor(req);
    if (!c.recipient_user_id) throw httpError(409, "No recipient has been chosen for this coin yet.");
    if (me.x_user_id !== c.recipient_user_id) throw httpError(403, `You're logged in as @${me.x_handle}. Only @${c.recipient_handle} can set where funds go.`);
    return { me, c };
  };
  const roles = <T,>(fn: () => Promise<T>) =>
    fn().catch((e) => {
      if (e instanceof RoleError) throw httpError(e.statusCode, e.message);
      throw e;
    });

  /** The chooser locks the recipient. Permanent. */
  app.post("/api/coins/:mint/recipient", async (req) => {
    const { c } = requireChooser(req);
    const b = z.object({ handle: z.string().trim().min(1), confirm: z.literal(true, { message: "Confirm that the choice is permanent." }) }).parse(req.body);
    let user;
    try {
      user = await lookupUser(b.handle);
    } catch {
      throw httpError(503, "Couldn't reach X to check that handle. Try again in a minute.");
    }
    if (!user) throw httpError(400, `Couldn't find @${b.handle.replace(/^@/, "")} on X.`);
    const after = await roles(() => lockRecipient(c, user!, "site"));
    auditCache.delete(c.mint);
    return {
      ok: true,
      message:
        user.id === c.honoree_user_id
          ? "You're locked in as the recipient. Choose where funds go below."
          : `@${user.username} is locked in as the recipient. They log in here to accept and choose where funds go.`,
      coin: publicCoin(after),
    };
  });

  /** A one-time message for the recipient's wallet to sign. */
  app.post("/api/coins/:mint/wallet-challenge", async (req) => {
    const { me, c } = requireRecipient(req);
    const { wallet } = z.object({ wallet: z.string().trim().min(32).max(44) }).parse(req.body);
    return roles(async () => walletChallenge(c, me.x_user_id, wallet));
  });

  /** The recipient chooses where funds go, once: their verified wallet, or a donate.gg nonprofit. */
  app.post("/api/coins/:mint/payout", async (req) => {
    const { me, c } = requireRecipient(req);
    const b = z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("nonprofit"), config_id: z.string().trim(), confirm: z.literal(true, { message: "Confirm that the destination is permanent." }) }),
        z.object({ kind: z.literal("wallet"), nonce: z.string().trim(), signature: z.string().trim(), confirm: z.literal(true, { message: "Confirm that the destination is permanent." }) }),
      ])
      .parse(req.body);
    const { coin, sent } = await roles(() => setPayout(c, me.x_user_id, b));
    auditCache.delete(c.mint);
    const dest = coin.payout_kind === "wallet" ? `your wallet ${coin.payout_wallet!.slice(0, 4)}…${coin.payout_wallet!.slice(-4)}` : getCharity(coin.payout_config_id!)?.name ?? "the nonprofit";
    return {
      ok: true,
      message: sent ? `${fmtUsd(await usd(sent))} is on its way to ${dest}. Future fees go there too.` : `Funds from this coin will go to ${dest}.`,
      coin: publicCoin(coin),
    };
  });

  /** The recipient declines: funds go to the fallback nonprofit. */
  app.post("/api/coins/:mint/decline", async (req) => {
    const { c } = requireRecipient(req);
    z.object({ confirm: z.literal(true, { message: "Confirm that you're declining." }) }).parse(req.body);
    const after = await roles(() => declineRecipient(c));
    return { ok: true, message: `Declined. This coin's recipient share goes to ${getCharity(coinFallback(after))?.name ?? "the fallback nonprofit"}.`, coin: publicCoin(after) };
  });

  /** The chooser can keep their name off the coin's page and posts. */
  app.post("/api/coins/:mint/optout", async (req) => {
    const { c } = requireChooser(req);
    const { out } = z.object({ out: z.boolean() }).parse(req.body);
    updateCoin(c.mint, { opted_out: out ? 1 : 0 });
    return { ok: true, message: out ? "Your name is off this coin's page and our posts." : "Your name is back on this coin's page." };
  });

  app.post("/api/logout", async (_req, reply) => {
    reply.clearCookie("sid", { path: "/" });
    return { ok: true };
  });

  return app;
}
