/**
 * Nonprofit list management.
 *
 *   npm run charity -- discover            donate.gg configs already used on Pump.fun, with the nonprofit,
 *                                          fee and status each one pays (looked up on donate.gg's public API)
 *   npm run charity -- check <configId>    look up one config on donate.gg without adding it
 *   npm run charity -- import <configId> [@handle]
 *                                          verify a config on donate.gg and add its nonprofit
 *   npm run charity -- import-onboarded   add every nonprofit that has onboarded with donate.gg
 *                                          (and sets DEFAULT_CONFIG_ID in .env if it's empty)
 *   npm run charity -- add <configId> "<name>" [@handle] [url]   add by hand (no verification)
 *   npm run charity -- list
 *   npm run charity -- disable <configId>
 */
import { PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { db, now } from "./db.js";
import { LAMPORTS } from "./config.js";

// Stores each config's donate.gg fee so the site can show nonprofits' real share.
try {
  db.exec("ALTER TABLE charities ADD COLUMN fee_bps INTEGER");
} catch {
  /* already there */
}

type DonateConfig = {
  id: { hex: string; base58: string };
  feeBps: string;
  charities: { name: string; website: string; status: string; isEnabled: boolean; weight: string; socials?: { twitterHandle?: string | null }; stats?: { displayedUsdE6?: string } }[];
};

const API = "https://www.donate.gg/api/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Public lookup on donate.gg (no API key; ~20 requests/minute). */
async function lookup(configId: string): Promise<DonateConfig | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${API}/configs/${configId}`, { headers: { accept: "application/json" } });
    if (r.status === 404) return null;
    if (r.status === 429) {
      await sleep(Number(r.headers.get("retry-after") ?? 10) * 1000);
      continue;
    }
    if (!r.ok) throw new Error(`donate.gg returned ${r.status} for ${configId}`);
    return (await r.json()) as DonateConfig;
  }
  throw new Error("donate.gg rate limit; try again in a minute");
}

/** Why a config shouldn't be used, or null if it's fine. */
function problems(c: DonateConfig): string[] {
  const out: string[] = [];
  if (c.charities.length !== 1) out.push(`pays ${c.charities.length} nonprofits (FeeFlow lists single-nonprofit configs)`);
  for (const ch of c.charities) {
    if (!ch.isEnabled) out.push(`${ch.name} is disabled on donate.gg`);
    if (ch.status === "OPTED_OUT" || ch.status === "PLATFORM_DISABLED" || ch.status === "SOFT_HIDDEN") out.push(`${ch.name} status is ${ch.status}`);
  }
  return out;
}

const pct = (bps: string | number) => `${(Number(bps) / 100).toFixed(Number(bps) % 100 ? 1 : 0)}%`;

function describe(c: DonateConfig) {
  const ch = c.charities[0];
  const onboarded = ch?.status === "ACTIVE_ONBOARDED" ? "onboarded" : ch?.status === "ACTIVE_NOT_ONBOARDED" ? "NOT onboarded" : ch?.status ?? "?";
  return `${c.charities.map((x) => x.name).join(" + ")}  |  donate.gg fee ${pct(c.feeBps)}  |  ${onboarded}${ch?.socials?.twitterHandle ? `  |  @${ch.socials.twitterHandle}` : ""}`;
}

function save(configId: string, name: string, handle: string | null, url: string | null, feeBps: number | null) {
  db.prepare("INSERT OR REPLACE INTO charities (config_id, name, x_handle, url, active, added_at, fee_bps) VALUES (?, ?, ?, ?, 1, ?, ?)")
    .run(configId, name, handle, url, now(), feeBps);
}

/** donate.gg returns ids as base58 or 0x-hex; the escrows need base58. */
function toBase58(id: string): string | null {
  try {
    if (/^0x[0-9a-fA-F]{64}$/.test(id)) return new PublicKey(Buffer.from(id.slice(2), "hex")).toBase58();
    return new PublicKey(id).toBase58();
  } catch {
    return null;
  }
}

type ListedCharity = { name: string; status?: string; isEnabled?: boolean; configId?: string; website?: string; socials?: { twitterHandle?: string | null }; stats?: { displayedUsdE6?: string } };

/** Pages through donate.gg's public charity list. Returns null if the list isn't available without an API key. */
async function listCharities(): Promise<ListedCharity[] | null> {
  const out: ListedCharity[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 400; page++) {
    const url = `${API}/charities?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (r.status === 429) {
      await sleep(Number(r.headers.get("retry-after") ?? 10) * 1000);
      page--;
      continue;
    }
    if (r.status === 401 || r.status === 403 || r.status === 404) return null;
    if (!r.ok) throw new Error(`donate.gg returned ${r.status} listing charities`);
    const j = (await r.json()) as { response?: ListedCharity[]; data?: ListedCharity[]; items?: ListedCharity[]; pageKey?: string | null; nextCursor?: string | null };
    const items = j.response ?? j.data ?? j.items ?? [];
    out.push(...items);
    process.stdout.write(`\r  ${out.length} charities read...`);
    cursor = j.pageKey ?? j.nextCursor ?? null;
    if (!cursor || !items.length) break;
    await sleep(3200);
  }
  process.stdout.write("\n");
  return out;
}

/** Sets DEFAULT_CONFIG_ID in .env if it isn't set yet. */
function setDefaultIfEmpty(configId: string, name: string) {
  const path = ".env";
  if (!existsSync(path)) return;
  const env = readFileSync(path, "utf8");
  const m = env.match(/^DEFAULT_CONFIG_ID=(.*)$/m);
  if (m && m[1].trim()) return console.log(`DEFAULT_CONFIG_ID is already set; left it as is.`);
  const line = `DEFAULT_CONFIG_ID=${configId}`;
  writeFileSync(path, m ? env.replace(/^DEFAULT_CONFIG_ID=.*$/m, line) : env.replace(/\s*$/, "\n") + line + "\n");
  console.log(`Set DEFAULT_CONFIG_ID in .env to ${name}. Change it any time.`);
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "discover") {
  const { discoverConfigs } = await import("./pump.js");
  console.log("Reading Pump.fun donation escrows (this can take a minute)...");
  const rows = await discoverConfigs();
  const known = new Set((db.prepare("SELECT config_id FROM charities").all() as { config_id: string }[]).map((r) => r.config_id));
  console.log(`${rows.length} configs in use. Looking each up on donate.gg (a few seconds each to respect their rate limit)...\n`);
  for (const r of rows.slice(0, Number(args[0]) || 40)) {
    let info = "not found on donate.gg (don't use)";
    try {
      const c = await lookup(r.configId);
      if (c) info = describe(c) + (problems(c).length ? `  |  SKIP: ${problems(c).join("; ")}` : "");
    } catch (e) {
      info = `lookup failed: ${(e as Error).message}`;
    }
    console.log(`${known.has(r.configId) ? "[listed] " : ""}${r.configId}\n    ${(r.donated / LAMPORTS).toFixed(2)} SOL donated via ${r.coins} coin(s)  |  ${info}`);
    await sleep(3200);
  }
  console.log("\nAdd one with:  npm run charity -- import <configId>");
} else if (cmd === "check" || cmd === "import") {
  const [configId, handleArg] = args;
  if (!configId) throw new Error(`Usage: ${cmd} <configId>${cmd === "import" ? " [@handle]" : ""}`);
  new PublicKey(configId); // must be a base58 config id
  const c = await lookup(configId);
  if (!c) throw new Error("donate.gg has no config with that id. Don't use it.");
  console.log(describe(c));
  const bad = problems(c);
  if (bad.length) throw new Error(`Not adding: ${bad.join("; ")}`);
  if (c.id.base58 !== configId) throw new Error(`Use the base58 id: ${c.id.base58}`);
  if (cmd === "import") {
    const ch = c.charities[0];
    const handle = handleArg?.replace(/^@/, "") || ch.socials?.twitterHandle?.replace(/^@/, "") || null;
    save(configId, ch.name, handle, ch.website || null, Number(c.feeBps));
    console.log(`added ${ch.name}${handle ? ` (@${handle})` : ""}. A nonprofit gets ${pct(Math.round(9000 * (1 - Number(c.feeBps) / 10000)))} of each coin's creator fees.`);
    if (ch.status !== "ACTIVE_ONBOARDED") console.log("note: this nonprofit hasn't onboarded with donate.gg yet.");
  }
} else if (cmd === "import-onboarded") {
  const known = new Set((db.prepare("SELECT config_id FROM charities WHERE active = 1").all() as { config_id: string }[]).map((r) => r.config_id));
  console.log("Reading donate.gg's charity list (public API, rate-limited, so this takes a few minutes)...");
  let candidates: { configId: string; name: string; usd: number }[] = [];
  const listed = await listCharities();
  if (listed) {
    const onboarded = listed.filter((c) => c.status === "ACTIVE_ONBOARDED" && c.isEnabled !== false && c.configId);
    console.log(`${listed.length} charities listed, ${onboarded.length} onboarded with a config.`);
    candidates = onboarded
      .map((c) => ({ configId: toBase58(c.configId!) ?? "", name: c.name, usd: Number(c.stats?.displayedUsdE6 ?? 0) / 1e6 }))
      .filter((c) => c.configId);
  } else {
    console.log("donate.gg's charity list needs an API key, so using the configs already used on Pump.fun instead...");
    const { discoverConfigs } = await import("./pump.js");
    candidates = (await discoverConfigs()).map((r) => ({ configId: r.configId, name: "", usd: r.donated }));
  }

  let added = 0, skipped = 0;
  let best: { configId: string; name: string; usd: number } | null = null;
  for (const cand of candidates) {
    if (known.has(cand.configId)) continue;
    try {
      const c = await lookup(cand.configId);
      await sleep(3200);
      if (!c || problems(c).length || c.charities[0]?.status !== "ACTIVE_ONBOARDED") {
        skipped++;
        continue;
      }
      const ch = c.charities[0];
      const handle = ch.socials?.twitterHandle?.replace(/^@/, "") || null;
      save(c.id.base58, ch.name, handle, ch.website || null, Number(c.feeBps));
      added++;
      console.log(`  + ${ch.name}${handle ? ` (@${handle})` : ""}  fee ${pct(c.feeBps)}`);
      // Default fallback: the onboarded nonprofit that has received the most through donate.gg.
      const usd = Number(ch.stats?.displayedUsdE6 ?? 0) / 1e6 || cand.usd;
      if (!best || usd > best.usd) best = { configId: c.id.base58, name: ch.name, usd };
    } catch (e) {
      skipped++;
      console.log(`  ! ${cand.name || cand.configId}: ${(e as Error).message}`);
    }
  }
  console.log(`\nAdded ${added} onboarded nonprofits; skipped ${skipped} (not onboarded, multi-nonprofit, disabled or not found).`);
  if (best) setDefaultIfEmpty(best.configId, best.name);
  else if (!added) console.log("Nothing added. Run `npm run charity -- discover` to see what's available.");
} else if (cmd === "add") {
  const [configId, name, handle, url] = args;
  new PublicKey(configId);
  if (!name) throw new Error('Usage: add <configId> "<name>" [@handle] [url]');
  save(configId, name, handle?.replace(/^@/, "") || null, url || null, null);
  console.log(`added ${name} (not verified on donate.gg; prefer: npm run charity -- import ${configId})`);
} else if (cmd === "disable") {
  db.prepare("UPDATE charities SET active = 0 WHERE config_id = ?").run(args[0]);
  console.log("disabled");
} else {
  const rows = db.prepare("SELECT * FROM charities ORDER BY name").all() as any[];
  if (!rows.length) console.log("No nonprofits yet. Run: npm run charity -- discover");
  for (const c of rows)
    console.log(`${c.active ? " " : "x"} ${c.config_id}  ${c.name}${c.x_handle ? "  @" + c.x_handle : ""}${c.fee_bps != null ? `  (donate.gg fee ${pct(c.fee_bps)})` : ""}`);
}
