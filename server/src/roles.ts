/**
 * Chooser → recipient → payout destination.
 *
 *  - Chooser: the X account a coin is named for (honoree_* columns). Picks the recipient, once.
 *  - Recipient: any X account, including the chooser. The chooser can't change their pick, but the current
 *    recipient can pass it on to another account until a payout destination is set.
 *  - Payout destination: the recipient's verified wallet, or a donate.gg nonprofit.
 *
 * Accounts are stored by stable X id; handles are for display and selection only.
 */
import { createPublicKey, randomBytes, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { cfg } from "./config.js";
import { addEvent, db, getCharity, getCoin, kvGet, kvSet, now, routingState, type Coin } from "./db.js";
import { rememberHonoree } from "./market.js";
import { activateFallback, charityName, coinFallback, forwardCoin } from "./relay.js";
import { coinPost, fit } from "./posts.js";
import { botAccount, botEnabled, fetchMentions, lookupUser, type Mention, type XUser } from "./x.js";

export class RoleError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

const link = (mint: string) => `${cfg.PUBLIC_URL}/c/${mint}`;
const fallbackName = (c: Coin) => getCharity(coinFallback(c))?.name ?? "the fallback nonprofit";
const deadline = (c: Coin) => (cfg.HOLD_DAYS ? new Date((c.created_at + cfg.HOLD_DAYS * 86400) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

// ---------- chooser locks the recipient ----------

export async function lockRecipient(
  c: Coin,
  user: XUser,
  via: "site" | "x_reply",
  reply: { tweetId: string } | null = null
): Promise<Coin> {
  if (c.recipient_user_id) throw new RoleError(409, `$${c.symbol}'s recipient is already selected: @${c.recipient_handle}.`);
  if (c.released_at) throw new RoleError(409, `$${c.symbol}'s recipient share already goes to ${fallbackName(c)}, so a recipient can't be chosen anymore.`);
  // Guard against a race between the website and an X reply: only the first one wins.
  const res = db
    .prepare(
      `UPDATE coins SET recipient_user_id = ?, recipient_handle = ?, recipient_selected_at = ?, recipient_selected_via = ?, selection_tweet_id = ?, updated_at = ?
       WHERE mint = ? AND recipient_user_id IS NULL AND released_at IS NULL`
    )
    .run(user.id, user.username, now(), via, reply?.tweetId ?? null, now(), c.mint);
  if (res.changes !== 1) throw new RoleError(409, `$${c.symbol}'s recipient was just selected by another request.`);
  db.prepare("INSERT OR REPLACE INTO honorees (user_id, handle, name, avatar, updated_at) VALUES (?, ?, ?, ?, ?)").run(user.id, user.username, user.name, user.avatar, now());
  const self = user.id === c.honoree_user_id;
  addEvent(c.mint, "recipient_locked", {
    actor_id: c.honoree_user_id,
    actor_handle: c.honoree_handle,
    detail: self ? `@${user.username} (themselves), id ${user.id}` : `@${user.username}, id ${user.id}`,
    tweet_id: reply?.tweetId ?? null,
  });

  const by = deadline(c);
  const until = by ? `Not set by ${by}? Funds go to ${fallbackName(c)}.` : "";
  const text = self
    ? fit(`@${c.honoree_handle} you selected yourself as $${c.symbol}'s recipient. Log in to choose where funds go, your wallet or a nonprofit: ${link(c.mint)}#act{0}`, until ? `\n\n${until}` : "")
    : fit(
        `@${c.honoree_handle} selected @${user.username} as $${c.symbol}'s recipient.\n\n@${user.username}: log in to accept and choose your wallet or a nonprofit, or reply with another @handle to pass it on: ${link(c.mint)}#act{0}`,
        until ? `\n\n${until}` : ""
      );
  await coinPost(c.mint, "recipient_locked", text, reply?.tweetId ?? c.announce_tweet);
  return getCoin(c.mint)!;
}

// ---------- the recipient passes it on ----------

/** The current recipient hands the coin to another X account, before any payout destination is set. */
export async function redirectRecipient(
  c: Coin,
  fromUserId: string,
  user: XUser,
  via: "site" | "x_reply",
  reply: { tweetId: string } | null = null
): Promise<Coin> {
  const state = routingState(c);
  if (state === "active") throw new RoleError(409, "This coin's payout destination is already set, so it can't be passed on.");
  if (state !== "awaiting_routing" || c.recipient_user_id !== fromUserId) throw new RoleError(409, `Only $${c.symbol}'s current recipient can pass it on.`);
  if (user.id === fromUserId) throw new RoleError(400, `@${user.username} is already $${c.symbol}'s recipient.`);
  const from = c.recipient_handle;
  // Only the current recipient, and only once: a race between the website and an X reply can't hand it on twice.
  const res = db
    .prepare(
      `UPDATE coins SET recipient_user_id = ?, recipient_handle = ?, recipient_selected_at = ?, recipient_selected_via = ?, selection_tweet_id = ?, updated_at = ?
       WHERE mint = ? AND recipient_user_id = ? AND payout_kind IS NULL AND released_at IS NULL AND recipient_declined_at IS NULL`
    )
    .run(user.id, user.username, now(), via, reply?.tweetId ?? null, now(), c.mint, fromUserId);
  if (res.changes !== 1) throw new RoleError(409, `$${c.symbol}'s recipient just changed. Reload and try again.`);
  db.prepare("INSERT OR REPLACE INTO honorees (user_id, handle, name, avatar, updated_at) VALUES (?, ?, ?, ?, ?)").run(user.id, user.username, user.name, user.avatar, now());
  addEvent(c.mint, "recipient_redirected", {
    actor_id: fromUserId,
    actor_handle: from,
    detail: `@${from} → @${user.username}, id ${user.id}`,
    tweet_id: reply?.tweetId ?? null,
  });
  const by = deadline(c);
  const until = by ? `Not set by ${by}? Funds go to ${fallbackName(c)}.` : "";
  await coinPost(
    c.mint,
    "recipient_redirected",
    fit(
      `@${from} passed $${c.symbol}'s creator fees to @${user.username}.\n\n@${user.username}: log in to accept and choose your wallet or a nonprofit, or reply with another @handle to pass it on: ${link(c.mint)}#act{0}`,
      until ? `\n\n${until}` : ""
    ),
    reply?.tweetId ?? c.announce_tweet
  );
  return getCoin(c.mint)!;
}

// ---------- recipient sets the payout destination ----------

const CHALLENGE_TTL = 15 * 60;

/** A one-time message for the recipient's wallet to sign, proving they own it. */
export function walletChallenge(c: Coin, xUserId: string, wallet: string) {
  let key: PublicKey;
  try {
    key = new PublicKey(wallet);
  } catch {
    throw new RoleError(400, "That isn't a Solana wallet address.");
  }
  if (!PublicKey.isOnCurve(key.toBytes())) throw new RoleError(400, "That address can't sign messages. Use a regular wallet address.");
  db.prepare("DELETE FROM wallet_challenges WHERE created_at < ?").run(now() - CHALLENGE_TTL);
  const nonce = randomBytes(16).toString("hex");
  const message = [
    "Feeward payout wallet",
    "",
    `X account: @${c.recipient_handle} (id ${c.recipient_user_id})`,
    `Coin: $${c.symbol} (${c.mint})`,
    `Pay the recipient share of this coin's creator fees to: ${key.toBase58()}`,
    "",
    `Nonce: ${nonce}`,
    `Issued: ${new Date().toISOString()}`,
  ].join("\n");
  db.prepare("INSERT INTO wallet_challenges (nonce, mint, x_user_id, wallet, message, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(nonce, c.mint, xUserId, key.toBase58(), message, now());
  return { nonce, message };
}

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
function verifyWalletSignature(wallet: string, message: string, signatureB64: string) {
  const sig = Buffer.from(signatureB64, "base64");
  if (sig.length !== 64) return false;
  const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(new PublicKey(wallet).toBytes())]), format: "der", type: "spki" });
  return verify(null, Buffer.from(message, "utf8"), key, sig);
}

type PayoutInput = { kind: "nonprofit"; config_id: string } | { kind: "wallet"; nonce: string; signature: string };

export async function setPayout(c: Coin, xUserId: string, input: PayoutInput): Promise<{ coin: Coin; sent: number }> {
  const state = routingState(c);
  if (state === "declined" || state === "fallback") throw new RoleError(409, `$${c.symbol}'s recipient share already goes to ${fallbackName(c)}.`);
  // The payout destination is permanent once set, like the recipient.
  if (state === "active") throw new RoleError(409, "This coin's payout destination is already set, and it can't be changed.");

  let patch: Partial<Coin>;
  let detail: string;
  if (input.kind === "nonprofit") {
    const ch = getCharity(input.config_id);
    if (!ch || !ch.active) throw new RoleError(400, "Pick a nonprofit from the list.");
    patch = { payout_kind: "nonprofit", payout_config_id: ch.config_id, payout_wallet: null };
    detail = `nonprofit: ${ch.name} (donate.gg)`;
  } else {
    const row = db.prepare("SELECT * FROM wallet_challenges WHERE nonce = ? AND mint = ? AND x_user_id = ?").get(input.nonce, c.mint, xUserId) as
      | { wallet: string; message: string; created_at: number }
      | undefined;
    if (!row || row.created_at < now() - CHALLENGE_TTL) throw new RoleError(400, "That signing request expired. Connect your wallet again.");
    if (!verifyWalletSignature(row.wallet, row.message, input.signature)) throw new RoleError(400, "The wallet signature didn't match. Sign the message with the wallet you connected.");
    db.prepare("DELETE FROM wallet_challenges WHERE nonce = ?").run(input.nonce);
    patch = { payout_kind: "wallet", payout_wallet: row.wallet, payout_config_id: null };
    detail = `wallet: ${row.wallet} (ownership signed)`;
  }

  // Only the first request wins: the destination can't be replaced.
  const set = db
    .prepare("UPDATE coins SET payout_kind = ?, payout_wallet = ?, payout_config_id = ?, routing_set_at = ?, updated_at = ? WHERE mint = ? AND payout_kind IS NULL AND released_at IS NULL")
    .run(patch.payout_kind, patch.payout_wallet ?? null, patch.payout_config_id ?? null, now(), now(), c.mint);
  if (set.changes !== 1) throw new RoleError(409, "This coin's payout destination was just set by another request.");
  addEvent(c.mint, "payout_set", { actor_id: c.recipient_user_id, actor_handle: c.recipient_handle, detail });
  const after = getCoin(c.mint)!;
  const sent = await forwardCoin(after).catch((e) => (console.error(`release after payout set ${c.mint}:`, e.message), 0));

  const amount = sent ? `${(sent / 1e9).toFixed(2)} SOL` : null;
  const dest = after.payout_kind === "wallet" ? "their wallet, as support" : charityName(after.payout_config_id!);
  await coinPost(
    c.mint,
    "payout_set",
    `@${c.recipient_handle} accepted $${c.symbol}'s fees${amount ? `. ${amount} was just sent to ${dest}` : ` and chose ${dest}`}. Future creator fees go there too. ${link(c.mint)}`,
    c.announce_tweet
  );
  return { coin: getCoin(c.mint)!, sent };
}

export async function declineRecipient(c: Coin): Promise<Coin> {
  const state = routingState(c);
  if (state !== "awaiting_routing") throw new RoleError(409, state === "active" ? "You've already accepted. Funds go to the destination you chose." : "There's nothing to decline.");
  const res = db.prepare("UPDATE coins SET recipient_declined_at = ?, updated_at = ? WHERE mint = ? AND payout_kind IS NULL AND released_at IS NULL").run(now(), now(), c.mint);
  if (res.changes !== 1) throw new RoleError(409, "This coin's payout destination was just set, so it can't be declined.");
  addEvent(c.mint, "recipient_declined", { actor_id: c.recipient_user_id, actor_handle: c.recipient_handle });
  const sent = await activateFallback(getCoin(c.mint)!, "declined").catch((e) => (console.error(`fallback after decline ${c.mint}:`, e.message), 0));
  await coinPost(
    c.mint,
    "declined",
    `@${c.recipient_handle} declined $${c.symbol}'s fees, so they go to ${charityName(coinFallback(c))}${sent ? `: ${(sent / 1e9).toFixed(2)} SOL sent so far` : ""}. ${link(c.mint)}`,
    c.announce_tweet
  );
  return getCoin(c.mint)!;
}

// ---------- selection by replying on X ----------

export type Parsed = { kind: "handle"; handle: string } | { kind: "self" } | { kind: "clarify"; reason: "none" | "multiple" | "ambiguous" };

/**
 * Reads a chooser's reply. X puts the people being replied to at the start of a reply; those are
 * skipped (the bot, and anyone the bot's post tagged other than the chooser). What's left must name
 * exactly one account, or say "me".
 */
export function parseSelection(text: string, botHandle: string, autoTagged: string[], chooserHandle: string): Parsed {
  const skip = new Set([botHandle.toLowerCase(), ...autoTagged.map((h) => h.toLowerCase())]);
  skip.delete(chooserHandle.toLowerCase());
  let body = text.replace(/https?:\/\/\S+/g, " ");
  for (;;) {
    const m = body.match(/^\s*@([A-Za-z0-9_]{1,15})\b/);
    if (!m || !skip.has(m[1].toLowerCase())) break;
    body = body.slice(m[0].length);
  }
  const handles = [...new Set([...body.matchAll(/@([A-Za-z0-9_]{1,15})\b/g)].map((m) => m[1]).filter((h) => h.toLowerCase() !== botHandle.toLowerCase()).map((h) => h.toLowerCase()))];
  const words = body.replace(/@[A-Za-z0-9_]{1,15}\b/g, " ");
  const unsure = /\?|\b(not|maybe|or|either|instead|undecided|later|unsure|idk|if)\b/i.test(words);
  if (handles.length > 1) return { kind: "clarify", reason: "multiple" };
  if (handles.length === 1) return unsure ? { kind: "clarify", reason: "ambiguous" } : { kind: "handle", handle: handles[0] };
  if (/\b(me|myself|mine|self)\b/i.test(words) && !unsure) return { kind: "self" };
  return { kind: "clarify", reason: unsure ? "ambiguous" : "none" };
}

const logReply = (m: Mention, mint: string | null, outcome: string) =>
  db.prepare("INSERT OR IGNORE INTO replies (tweet_id, mint, author_id, outcome, created_at) VALUES (?, ?, ?, ?, ?)").run(m.id, mint, m.author_id, outcome, now());

/** Finds the coin a reply belongs to: through the post it answers, or the thread it's in. */
function coinForReply(m: Mention): { mint: string; tagged: string[] } | null {
  for (const id of [m.replied_to, m.conversation_id]) {
    if (!id) continue;
    const row = db.prepare("SELECT mint, mentions FROM bot_posts WHERE tweet_id = ?").get(id) as { mint: string; mentions: string | null } | undefined;
    if (row) return { mint: row.mint, tagged: (row.mentions ?? "").split(",").filter(Boolean) };
  }
  return null;
}

async function handleReply(m: Mention, botHandle: string) {
  if (db.prepare("SELECT 1 FROM replies WHERE tweet_id = ?").get(m.id)) return;
  const found = coinForReply(m);
  if (!found) return logReply(m, null, "unrelated");
  const c = getCoin(found.mint);
  if (!c || c.status !== "live") return logReply(m, found.mint, "no_coin");
  // The current recipient can pass the coin on by replying with another @handle. Matched by X id.
  if (c.recipient_user_id && m.author_id === c.recipient_user_id && routingState(c) === "awaiting_routing") return handleRecipientReply(m, c, botHandle, found.tagged);
  // Otherwise only the chooser's account can select. Matched by X id, never by handle.
  if (m.author_id !== c.honoree_user_id) return logReply(m, c.mint, "not_chooser");

  const answer = (text: string, outcome: string) => (logReply(m, c.mint, outcome), coinPost(c.mint, "reply", text, m.id));
  const p = parseSelection(m.text, botHandle, found.tagged, c.honoree_handle);

  if (c.recipient_user_id) {
    if (p.kind === "clarify" && p.reason === "none") return logReply(m, c.mint, "chatter");
    return answer(`@${c.honoree_handle} $${c.symbol}'s recipient is already selected: @${c.recipient_handle}.`, "already_locked");
  }
  if (c.released_at) return answer(`@${c.honoree_handle} $${c.symbol}'s recipient share already goes to ${fallbackName(c)}, so a recipient can't be chosen anymore.`, "closed");

  if (p.kind === "clarify") {
    const ask = {
      none: `@${c.honoree_handle} to choose who receives $${c.symbol}'s creator fees, reply with one @handle, or "me" for yourself. You can also choose here: ${link(c.mint)}#act`,
      multiple: `@${c.honoree_handle} that reply names more than one account. Reply with just one @handle to choose $${c.symbol}'s recipient (or "me").`,
      ambiguous: `@${c.honoree_handle} we couldn't tell who you meant. Reply with only the @handle of $${c.symbol}'s recipient, or "me" for yourself.`,
    }[p.reason];
    return answer(ask, `clarify_${p.reason}`);
  }

  let user: XUser | null;
  if (p.kind === "self") user = { id: c.honoree_user_id, username: c.honoree_handle, name: null, avatar: null };
  else {
    try {
      user = await lookupUser(p.handle);
    } catch {
      return; // X didn't answer: leave it unlogged so the next poll tries again
    }
    if (!user) return answer(`@${c.honoree_handle} we couldn't find @${p.handle} on X. Check the spelling and reply again with one @handle.`, "not_found");
  }
  if (p.kind === "self") {
    const me = await lookupUser(c.honoree_handle).catch(() => null);
    if (me && me.id === c.honoree_user_id) user = me;
  }
  try {
    await lockRecipient(c, user!, "x_reply", { tweetId: m.id });
    logReply(m, c.mint, "selected");
    await rememberHonoree(user!.id, user!.username).catch(() => {});
  } catch (e) {
    if (e instanceof RoleError) return answer(`@${c.honoree_handle} ${e.message}`, "rejected");
    throw e;
  }
}

async function handleRecipientReply(m: Mention, c: Coin, botHandle: string, tagged: string[]) {
  const who = c.recipient_handle!;
  const answer = (text: string, outcome: string) => (logReply(m, c.mint, outcome), coinPost(c.mint, "reply", text, m.id));
  const p = parseSelection(m.text, botHandle, tagged, who);
  if (p.kind === "self") return answer(`@${who} to accept $${c.symbol}'s creator fees, log in and choose your wallet or a nonprofit: ${link(c.mint)}#act`, "accept_hint");
  if (p.kind === "clarify") {
    if (p.reason === "none") return logReply(m, c.mint, "chatter");
    return answer(`@${who} to pass $${c.symbol}'s creator fees on, reply with just one @handle. To accept them, log in: ${link(c.mint)}#act`, `clarify_${p.reason}`);
  }
  let user: XUser | null;
  try {
    user = await lookupUser(p.handle);
  } catch {
    return; // X didn't answer: leave it unlogged so the next poll tries again
  }
  if (!user) return answer(`@${who} we couldn't find @${p.handle} on X. Check the spelling and reply again with one @handle.`, "not_found");
  try {
    await redirectRecipient(c, m.author_id, user, "x_reply", { tweetId: m.id });
    logReply(m, c.mint, "redirected");
    await rememberHonoree(user.id, user.username).catch(() => {});
  } catch (e) {
    if (e instanceof RoleError) return answer(`@${who} ${e.message}`, "rejected");
    throw e;
  }
}

/** Reads new replies to @feewardx and acts on recipient selections. */
export async function pollReplies() {
  if (!botEnabled()) return;
  const acct = await botAccount();
  if (!acct) return;
  const since = kvGet("mentions_since");
  if (!since) {
    // First run: start from now rather than acting on old replies (an X id made from the current time).
    kvSet("mentions_since", ((BigInt(Date.now()) - 1288834974657n) << 22n).toString());
    return;
  }
  const mentions = await fetchMentions(since);
  for (const m of mentions) {
    try {
      await handleReply(m, acct.username);
    } catch (e) {
      console.error(`reply ${m.id}:`, (e as Error).message);
      break; // retry from here next poll
    }
    kvSet("mentions_since", m.id);
  }
}
