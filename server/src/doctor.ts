/**
 * Checks the server's setup and prints what's left to do.
 *   npm run doctor
 */
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { cfg, RELAY_ON } from "./config.js";
import { authority, buybackWallet, conn, platformWallet, treasury } from "./chain.js";
import { db } from "./db.js";

const MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
let failures = 0;
const line = (ok: boolean | "warn", label: string, detail = "") => {
  if (ok === false) failures++;
  console.log(`${ok === true ? "  ok  " : ok === "warn" ? " warn " : " FIX  "} ${label}${detail ? `: ${detail}` : ""}`);
};

console.log("Feeward server check\n");

try {
  const genesis = await conn.getGenesisHash();
  line(genesis === MAINNET ? true : "warn", "RPC", genesis === MAINNET ? "mainnet" : `not mainnet (genesis ${genesis.slice(0, 8)}…)`);
} catch (e) {
  line(false, "RPC", `can't reach RPC_URL (${(e as Error).message})`);
}

line(cfg.ROUTER_PROGRAM_ID ? "warn" : true, "Mode", cfg.ROUTER_PROGRAM_ID ? `router ${cfg.ROUTER_PROGRAM_ID} (donations aren't held in router mode yet)` : "key mode, donations held until honorees choose");

const server = authority.publicKey;
try {
  const bal = (await conn.getBalance(server)) / LAMPORTS_PER_SOL;
  line(bal >= 0.3 ? true : bal > 0 ? "warn" : false, "Server key", `${server.toBase58()} has ${bal} SOL${bal < 0.3 ? " (send ~0.9 SOL for fees and per-coin setup)" : ""}`);
} catch {
  line("warn", "Server key", `${server.toBase58()} (couldn't read balance)`);
}

line(!platformWallet.equals(server) && PublicKey.isOnCurve(platformWallet.toBytes()) ? true : false, "Platform wallet", platformWallet.toBase58());
line(true, "Buyback wallet", buybackWallet.publicKey.toBase58());
line(true, "Treasury (holds donations)", treasury().publicKey.toBase58());
line(cfg.HOLD_DAYS ? true : "warn", "Hold period", cfg.HOLD_DAYS ? `${cfg.HOLD_DAYS} days, then the fallback nonprofit` : "none: held until a payout destination is set, with no time limit");

const n = (db.prepare("SELECT COUNT(*) n FROM charities WHERE active = 1").get() as { n: number }).n;
line(n > 0, "Nonprofits", n ? `${n} listed` : "none yet: run npm run charity -- import-onboarded");
const fbId = cfg.FALLBACK_CONFIG_ID ?? cfg.DEFAULT_CONFIG_ID;
const def = fbId ? (db.prepare("SELECT name FROM charities WHERE config_id = ?").get(fbId) as { name: string } | undefined) : undefined;
line(def ? true : RELAY_ON ? false : "warn", "Fallback nonprofit", def ? def.name : fbId ? "FALLBACK_CONFIG_ID isn't in the nonprofit list (npm run charity -- import <id>)" : "FALLBACK_CONFIG_ID not set");
line(cfg.REPLY_POLL_SECONDS ? true : "warn", "Recipient selection by X reply", cfg.REPLY_POLL_SECONDS ? `reads replies every ${cfg.REPLY_POLL_SECONDS}s` : "off (REPLY_POLL_SECONDS=0)");

const dummy = (v?: string) => !v || v === "dummy";
line(dummy(cfg.X_BEARER_TOKEN) ? false : true, "X bearer token", dummy(cfg.X_BEARER_TOKEN) ? "needed to look up honorees at launch" : "set");
line(dummy(cfg.X_CLIENT_ID) ? false : true, "X OAuth client", dummy(cfg.X_CLIENT_ID) ? "needed for honoree login" : "set");
line(cfg.X_BOT_ACCESS_TOKEN ? true : "warn", "X bot", cfg.X_BOT_ACCESS_TOKEN ? "set" : "not set: posts are only logged");
line(RELAY_ON ? true : "warn", "Relayed coins and buyback", RELAY_ON ? `on (house coin ${cfg.HOUSE_MINT})` : "off until HOUSE_MINT is set (after you launch the Feeward coin)");
line(cfg.PUBLIC_URL.startsWith("https") ? true : "warn", "PUBLIC_URL", cfg.PUBLIC_URL);

console.log(failures ? `\n${failures} thing(s) to fix.` : "\nReady.");
process.exit(0);
