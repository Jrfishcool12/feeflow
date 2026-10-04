import "dotenv/config";
import { z } from "zod";

const opt = z.string().optional().transform((v) => v || undefined);

const Env = z.object({
  RPC_URL: z.string().url(),
  AUTHORITY_SECRET_KEY: z.string().min(1),
  PLATFORM_WALLET: z.string().min(32),
  PLATFORM_BPS: z.coerce.number().int().min(0).max(1000).default(500),
  // Share of every coin's fees that buys the platform's own coin and burns it.
  BUYBACK_BPS: z.coerce.number().int().min(0).max(1000).default(500),
  // Buybacks fire at a random time between these bounds, picked fresh after each one.
  BUYBACK_MIN_SECONDS: z.coerce.number().int().min(60).default(300),
  BUYBACK_MAX_SECONDS: z.coerce.number().int().min(60).default(3600),
  // The platform's coin. Defaults to HOUSE_MINT.
  PLATFORM_COIN_MINT: z.string().optional().transform((v) => v || undefined),
  // The coin shown in the home page's hero card. Empty: the top coin is picked automatically.
  FEATURED_COIN_MINT: z.string().optional().transform((v) => v || undefined),
  CHANGE_COOLDOWN_DAYS: z.coerce.number().int().min(0).default(30),
  PINATA_JWT: opt,

  // On-chain router (program/). When set, the router program, not the server key, is every
  // launched coin's creator and fee-sharing admin. Leave empty to use the server key.
  ROUTER_PROGRAM_ID: z.string().optional().transform((v) => v || undefined),

  // Relay mode (existing coins). Leave HOUSE_MINT empty to turn relay mode off.
  MASTER_SEED: opt,
  // Fallback nonprofit for relayed coins whose description doesn't name one ("for @handle").
  DEFAULT_CONFIG_ID: opt,
  // A coin's nonprofit share is held until the honoree chooses a nonprofit. If they haven't chosen
  // after this many days, it goes to the coin's fallback nonprofit. 0 = hold until they choose, forever.
  HOLD_DAYS: z.coerce.number().int().min(0).default(90),
  // Where unclaimed or declined funds go (a donate.gg config id). Defaults to DEFAULT_CONFIG_ID.
  FALLBACK_CONFIG_ID: opt,
  // How often to read replies to @feewardx for recipient selections. 0 turns it off.
  REPLY_POLL_SECONDS: z.coerce.number().int().min(0).default(120),
  HOUSE_MINT: opt,

  X_BEARER_TOKEN: z.string().min(1),
  X_CLIENT_ID: z.string().min(1),
  X_CLIENT_SECRET: opt,
  X_BOT_APP_KEY: opt,
  X_BOT_APP_SECRET: opt,
  X_BOT_ACCESS_TOKEN: opt,
  X_BOT_ACCESS_SECRET: opt,
  BRAND_HANDLE: z.string().default("feewardx"),

  PUBLIC_URL: z.string().url(),
  PORT: z.coerce.number().int().default(8787),
  DB_PATH: z.string().default("./goodcall.db"),
  SESSION_SECRET: z.string().min(32),
  CRANK_SECONDS: z.coerce.number().int().min(60).default(600),
});

export const cfg = Env.parse(process.env);
if (cfg.HOUSE_MINT && (!cfg.MASTER_SEED || cfg.MASTER_SEED.length < 32)) throw new Error("Relay mode needs MASTER_SEED (32+ chars) to derive relay vaults.");
export const RELAY_ON = !!(cfg.HOUSE_MINT && cfg.MASTER_SEED);
// Held donations sit in the treasury, which is derived from MASTER_SEED.
if (!cfg.MASTER_SEED || cfg.MASTER_SEED.length < 32) throw new Error("MASTER_SEED (32+ characters) is required: it derives the treasury that holds donations until honorees choose.");
// The platform coin is its own setting: HOUSE_MINT is the escrow host coin, which nobody should buy.
export const PLATFORM_COIN = cfg.PLATFORM_COIN_MINT;
if (cfg.BUYBACK_MIN_SECONDS >= cfg.BUYBACK_MAX_SECONDS) throw new Error("BUYBACK_MIN_SECONDS must be less than BUYBACK_MAX_SECONDS.");
if (cfg.BUYBACK_BPS > 0 && !PLATFORM_COIN) console.warn("Buybacks wait until PLATFORM_COIN_MINT is set to the Feeward coin.");
/** Unclaimed or declined funds go here. */
export const FALLBACK_CONFIG = () => cfg.FALLBACK_CONFIG_ID ?? cfg.DEFAULT_CONFIG_ID ?? null;
/** Recipient's share of every coin's creator fees, in basis points. */
export const CHARITY_BPS = 10_000 - cfg.PLATFORM_BPS - cfg.BUYBACK_BPS;
/** Lamports left in each relay vault so it stays rent-exempt. */
export const VAULT_RESERVE = 1_000_000;
/** Pay out once a coin has at least this much collected (0.005 SOL). */
export const MIN_FORWARD = 5_000_000;
export const LAMPORTS = 1_000_000_000;
