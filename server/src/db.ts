import Database from "better-sqlite3";
import { cfg } from "./config.js";

export const db = new Database(cfg.DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
-- Charities an honoree can pick. Each maps to a donate.gg config id, which is what
-- Pump.fun's donation escrow (DonationFeePda) is keyed on. Curated with \`npm run charity\`.
CREATE TABLE IF NOT EXISTS charities (
  config_id  TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  x_handle   TEXT,
  url        TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  added_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coins (
  mint              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  symbol            TEXT NOT NULL,
  uri               TEXT NOT NULL,
  deployer          TEXT NOT NULL,
  honoree_handle    TEXT NOT NULL,
  honoree_user_id   TEXT NOT NULL,
  config_id         TEXT NOT NULL REFERENCES charities(config_id),  -- current charity
  mode              TEXT NOT NULL DEFAULT 'launch',  -- launch: fees go straight to the escrow | relay: through our vault
  vault             TEXT UNIQUE,         -- relay only: where the coin's fees are routed
  vault_nonce       TEXT UNIQUE,         -- relay only: derives the vault key with MASTER_SEED (never shown)
  routing           TEXT,                -- relay only: direct (vault is creator) | sharing (locked fee sharing)
  status            TEXT NOT NULL,       -- built | launched | pending (relay, awaiting routing) | live | failed
  built_message     TEXT,                -- base64 of the exact message we asked the deployer to sign
  launch_sig        TEXT,
  honoree_chose_at  INTEGER,             -- set the first time the honoree picks
  last_change_at    INTEGER,
  opted_out         INTEGER NOT NULL DEFAULT 0,
  donated_lamports  INTEGER NOT NULL DEFAULT 0,   -- sum of totalDonated across this coin's escrows
  last_milestone    INTEGER NOT NULL DEFAULT 0,   -- USD
  posted_lamports   INTEGER NOT NULL DEFAULT 0,   -- total at the last "just gave" post
  announce_tweet    TEXT,
  error             TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS coins_status ON coins(status);
CREATE INDEX IF NOT EXISTS coins_honoree ON coins(honoree_user_id);

-- Every fee-routing change we make, with its signature, for the public audit trail.
CREATE TABLE IF NOT EXISTS routing_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mint        TEXT NOT NULL,
  from_config TEXT,
  to_config   TEXT NOT NULL,
  reason      TEXT NOT NULL,             -- setup | honoree
  signature   TEXT,                      -- null for relay coins: the switch happens in our forwarding, not on-chain
  created_at  INTEGER NOT NULL
);

-- Relay forwards: one row per on-chain transfer from a relay vault to a charity escrow.
CREATE TABLE IF NOT EXISTS forwards (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  mint               TEXT NOT NULL,
  config_id          TEXT NOT NULL,
  lamports           INTEGER NOT NULL,
  platform_lamports  INTEGER NOT NULL,
  buyback_lamports   INTEGER NOT NULL DEFAULT 0,
  signature          TEXT NOT NULL UNIQUE,
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS forwards_mint ON forwards(mint);

-- Platform coin buy-and-burns, funded by the buyback share of every coin's fees.
CREATE TABLE IF NOT EXISTS buybacks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lamports     INTEGER NOT NULL,
  tokens_raw   TEXT NOT NULL,        -- base units burned (string: can exceed 2^53)
  buy_sig      TEXT NOT NULL UNIQUE,
  burn_sig     TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- Relay treasury claims: one row per on-chain transaction that paid a relayed coin's fees into the treasury.
CREATE TABLE IF NOT EXISTS claims (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mint        TEXT NOT NULL,
  lamports    INTEGER NOT NULL,
  signature   TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS claims_mint ON claims(mint);

-- Every donation, direct or relayed: the public feed and analytics read from here.
CREATE TABLE IF NOT EXISTS donations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mint        TEXT NOT NULL,
  config_id   TEXT NOT NULL,
  lamports    INTEGER NOT NULL,
  source      TEXT NOT NULL,             -- direct | relay
  signature   TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS donations_time ON donations(created_at);
CREATE INDEX IF NOT EXISTS donations_mint ON donations(mint);

-- X profiles of honorees (name and avatar), refreshed now and then.
CREATE TABLE IF NOT EXISTS honorees (
  user_id     TEXT PRIMARY KEY,
  handle      TEXT NOT NULL,
  name        TEXT,
  avatar      TEXT,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, verifier TEXT NOT NULL, mint TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, x_user_id TEXT NOT NULL, x_handle TEXT NOT NULL, created_at INTEGER NOT NULL);
`);

// Columns added after the first schema; ALTER is a no-op if they already exist.
for (const [col, def] of [
  ["image", "TEXT"],
  ["description", "TEXT"],
  ["mcap_lamports", "INTEGER NOT NULL DEFAULT 0"],
  ["meta_at", "INTEGER"],
  ["registered_via", "TEXT NOT NULL DEFAULT 'site'"],
  ["released_at", "INTEGER"],
  ["built_mint_secret", "TEXT"], // the new coin's key, kept only between building and submitting a launch
]) {
  try {
    db.exec(`ALTER TABLE coins ADD COLUMN ${col} ${def}`);
  } catch {
    /* already there */
  }
}

try {
  db.exec("ALTER TABLE forwards ADD COLUMN held_lamports INTEGER NOT NULL DEFAULT 0");
} catch {
  /* already there */
}

// ----- Roles: chooser (the X account a coin is named for, honoree_* columns), recipient (the X account
// the chooser locks in), payout destination (the recipient's wallet or a donate.gg nonprofit). -----
for (const [col, def] of [
  ["recipient_user_id", "TEXT"],          // stable X id: handles are display only
  ["recipient_handle", "TEXT"],
  ["recipient_selected_at", "INTEGER"],
  ["recipient_selected_via", "TEXT"],     // site | x_reply | migrated
  ["selection_tweet_id", "TEXT"],         // the chooser's reply, when selected on X
  ["recipient_declined_at", "INTEGER"],
  ["payout_kind", "TEXT"],                // wallet | nonprofit
  ["payout_wallet", "TEXT"],
  ["payout_config_id", "TEXT"],
  ["routing_set_at", "INTEGER"],
  ["fallback_config_id", "TEXT"],
]) {
  try {
    db.exec(`ALTER TABLE coins ADD COLUMN ${col} ${def}`);
  } catch {
    /* already there */
  }
}
for (const [table, col, def] of [
  ["donations", "kind", "TEXT NOT NULL DEFAULT 'donation'"], // donation (nonprofit via donate.gg) | support (recipient wallet)
  ["donations", "wallet", "TEXT"],
  ["forwards", "wallet", "TEXT"],
]) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  } catch {
    /* already there */
  }
}
db.exec(`
-- Every post the bot made about a coin, so replies to any of them can be matched to the coin.
CREATE TABLE IF NOT EXISTS bot_posts (tweet_id TEXT PRIMARY KEY, mint TEXT NOT NULL, kind TEXT NOT NULL, mentions TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS bot_posts_mint ON bot_posts(mint);
-- Replies to the bot we've already handled (each is acted on or answered once).
CREATE TABLE IF NOT EXISTS replies (tweet_id TEXT PRIMARY KEY, mint TEXT, author_id TEXT, outcome TEXT NOT NULL, created_at INTEGER NOT NULL);
-- Public record of every role and routing event on a coin.
CREATE TABLE IF NOT EXISTS coin_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, kind TEXT NOT NULL, actor_id TEXT, actor_handle TEXT,
  detail TEXT, tweet_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS coin_events_mint ON coin_events(mint);
-- One-time messages a recipient's wallet signs to prove they own it.
CREATE TABLE IF NOT EXISTS wallet_challenges (nonce TEXT PRIMARY KEY, mint TEXT NOT NULL, x_user_id TEXT NOT NULL, wallet TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL);
`);

// One-time migration from the nonprofit-only model: a named person who already picked a nonprofit
// becomes their own recipient, routing to that nonprofit. Earlier coins keep the fallback they launched with.
db.exec(`UPDATE coins SET fallback_config_id = config_id WHERE fallback_config_id IS NULL`);
db.exec(`UPDATE coins SET recipient_user_id = honoree_user_id, recipient_handle = honoree_handle, recipient_selected_at = honoree_chose_at,
  recipient_selected_via = 'migrated', payout_kind = 'nonprofit', payout_config_id = config_id, routing_set_at = honoree_chose_at
  WHERE honoree_chose_at IS NOT NULL AND recipient_user_id IS NULL AND released_at IS NULL`);
db.exec(`INSERT OR IGNORE INTO bot_posts (tweet_id, mint, kind, mentions, created_at) SELECT announce_tweet, mint, 'announce', honoree_handle, created_at FROM coins WHERE announce_tweet IS NOT NULL`);

export type RoutingState = "awaiting_selection" | "awaiting_routing" | "active" | "declined" | "fallback";
/** Where a coin is in the chooser → recipient → payout flow. */
export function routingState(c: Pick<Coin, "recipient_user_id" | "recipient_declined_at" | "payout_kind" | "released_at">): RoutingState {
  if (c.recipient_declined_at) return "declined";
  if (c.released_at) return "fallback";
  if (c.payout_kind) return "active";
  if (c.recipient_user_id) return "awaiting_routing";
  return "awaiting_selection";
}

/** True while a coin's recipient share is held in the treasury: no payout destination and no fallback yet. */
export const isHolding = (c: { payout_kind?: string | null; released_at?: number | null }) => !c.payout_kind && !c.released_at;

export function addEvent(mint: string, kind: string, e: { actor_id?: string | null; actor_handle?: string | null; detail?: string | null; tweet_id?: string | null } = {}) {
  db.prepare("INSERT INTO coin_events (mint, kind, actor_id, actor_handle, detail, tweet_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(mint, kind, e.actor_id ?? null, e.actor_handle ?? null, e.detail ?? null, e.tweet_id ?? null, now());
}

export const kvGet = (k: string) => (db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | undefined)?.v;
export const kvSet = (k: string, v: string) => db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").run(k, v);

export const now = () => Math.floor(Date.now() / 1000);

export interface Charity { config_id: string; name: string; x_handle: string | null; url: string | null; active: number; added_at: number }
export interface Coin {
  mint: string; name: string; symbol: string; uri: string; deployer: string;
  honoree_handle: string; honoree_user_id: string; config_id: string;
  mode: "launch" | "relay"; vault: string | null; vault_nonce: string | null; routing: "direct" | "sharing" | null;
  status: "built" | "launched" | "pending" | "live" | "failed";
  built_message: string | null; launch_sig: string | null;
  honoree_chose_at: number | null; last_change_at: number | null; opted_out: number;
  donated_lamports: number; last_milestone: number; posted_lamports: number; announce_tweet: string | null; error: string | null;
  image: string | null; description: string | null; mcap_lamports: number; meta_at: number | null; registered_via: "site" | "indexer";
  released_at: number | null;
  recipient_user_id: string | null; recipient_handle: string | null; recipient_selected_at: number | null;
  recipient_selected_via: "site" | "x_reply" | "migrated" | null; selection_tweet_id: string | null; recipient_declined_at: number | null;
  payout_kind: "wallet" | "nonprofit" | null; payout_wallet: string | null; payout_config_id: string | null; routing_set_at: number | null;
  fallback_config_id: string | null; built_mint_secret?: string | null;
  created_at: number; updated_at: number;
}

export const getCoin = (mint: string) => db.prepare("SELECT * FROM coins WHERE mint = ?").get(mint) as Coin | undefined;
export const getCharity = (id: string) => db.prepare("SELECT * FROM charities WHERE config_id = ?").get(id) as Charity | undefined;
export const coinsByStatus = (s: Coin["status"], mode?: Coin["mode"]) =>
  (mode
    ? db.prepare("SELECT * FROM coins WHERE status = ? AND mode = ?").all(s, mode)
    : db.prepare("SELECT * FROM coins WHERE status = ?").all(s)) as Coin[];

export function updateCoin(mint: string, patch: Partial<Coin>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE coins SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @updated_at WHERE mint = @mint`)
    .run({ ...patch, updated_at: now(), mint });
}

/** Every escrow config this coin has ever routed to (totals live on each escrow). */
export const configHistory = (mint: string): string[] =>
  (db.prepare("SELECT DISTINCT to_config c FROM routing_changes WHERE mint = ?").all(mint) as { c: string }[]).map((r) => r.c);

/** Records a completed payout: a donation to a donate.gg nonprofit, or support sent to the recipient's wallet. */
export function addDonation(mint: string, configId: string, lamports: number, source: "direct" | "relay", signature: string | null, wallet: string | null = null) {
  if (lamports <= 0) return;
  db.prepare("INSERT INTO donations (mint, config_id, lamports, source, signature, kind, wallet, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(mint, wallet ? "wallet" : configId, lamports, source, signature, wallet ? "support" : "donation", wallet, now());
}
