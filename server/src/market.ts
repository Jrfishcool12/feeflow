/**
 * What the site shows about a coin besides donations: its name, art and description
 * (from the token's own metadata), its market cap (from its bonding curve or PumpSwap pool),
 * and the honoree's X name and avatar.
 */
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getTokenMetadata } from "@solana/spl-token";
import { conn } from "./chain.js";
import { db, now, updateCoin, type Coin } from "./db.js";
import { readCurve } from "./pump.js";
import { pumpSdk, pumpSwapSdk } from "./sdk.js";
import { lookupUser, lookupUserById } from "./x.js";

const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const { canonicalPumpPoolPda } = pumpSdk;
const { PUMP_AMM_SDK } = pumpSwapSdk;

export type TokenMeta = { name: string; symbol: string; uri: string; description: string | null; image: string | null };

/** Reads name/symbol/uri from Token-2022 metadata (current Pump coins) or Metaplex (older ones). */
async function onchainMeta(mint: PublicKey): Promise<{ name: string; symbol: string; uri: string } | null> {
  try {
    const info = await conn.getAccountInfo(mint);
    if (info?.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      const m = await getTokenMetadata(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
      if (m) return { name: m.name, symbol: m.symbol, uri: m.uri };
    }
  } catch {
    /* fall through to Metaplex */
  }
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX.toBuffer(), mint.toBuffer()], METAPLEX);
  const acct = await conn.getAccountInfo(pda);
  if (!acct) return null;
  const d = acct.data;
  let o = 1 + 32 + 32; // key, update authority, mint
  const str = () => {
    const len = d.readUInt32LE(o);
    const v = d.subarray(o + 4, o + 4 + len).toString("utf8").replace(/\0+$/, "").trim();
    o += 4 + len;
    return v;
  };
  return { name: str(), symbol: str(), uri: str() };
}

// ipfs.io and dweb.link rate-limit servers (HTTP 429), so metadata is read through Pump.fun's own gateway first.
const GATEWAYS = ["https://pump.mypinata.cloud/ipfs/", "https://4everland.io/ipfs/", "https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/"];
const cidPath = (u: string) => u.match(/^ipfs:\/\/(?:ipfs\/)?(.+)$/)?.[1] ?? u.match(/^https?:\/\/[^/]+\/ipfs\/(.+)$/)?.[1] ?? null;
/** An IPFS link rewritten to the fastest gateway (other links unchanged). */
export const gatewayUrl = (u: string) => {
  const p = cidPath(u);
  return p ? GATEWAYS[0] + p : u;
};
async function fetchJson(u: string): Promise<any | null> {
  const p = cidPath(u);
  for (const url of p ? GATEWAYS.map((g) => g + p) : [u]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return await r.json();
    } catch {
      /* try the next gateway */
    }
  }
  return null;
}

export async function readTokenMeta(mintStr: string): Promise<TokenMeta | null> {
  const base = await onchainMeta(new PublicKey(mintStr));
  if (!base) return null;
  let description: string | null = null;
  let image: string | null = null;
  if (base.uri) {
    const j = (await fetchJson(base.uri)) as { description?: string; image?: string } | null;
    if (j) {
      description = typeof j.description === "string" ? j.description.slice(0, 2000) : null;
      image = typeof j.image === "string" ? gatewayUrl(j.image) : null;
    }
  }
  return { ...base, description, image };
}

/** Market cap in lamports: price from the bonding curve, or from the PumpSwap pool's effective reserves once graduated. */
export async function marketCap(mintStr: string): Promise<number> {
  const mint = new PublicKey(mintStr);
  const curve = (await readCurve(mint)) as any;
  if (!curve) return 0;
  const supply = Number(curve.tokenTotalSupply?.toString() ?? 0);
  if (!curve.complete) {
    const vq = Number((curve.virtualQuoteReserves ?? curve.virtualSolReserves)?.toString() ?? 0);
    const vt = Number(curve.virtualTokenReserves?.toString() ?? 0);
    return vt ? Math.round((vq / vt) * supply) : 0;
  }
  const poolKey = canonicalPumpPoolPda(mint);
  const info = await conn.getAccountInfo(poolKey);
  if (!info) return 0;
  const pool = PUMP_AMM_SDK.decodePool(info) as any;
  const [base, quote] = await Promise.all([
    conn.getTokenAccountBalance(pool.poolBaseTokenAccount),
    conn.getTokenAccountBalance(pool.poolQuoteTokenAccount),
  ]);
  // Price against effective quote reserves: vault balance plus the signed virtual reserves.
  const effectiveQuote = Number(quote.value.amount) + Number(pool.virtualQuoteReserves?.toString() ?? 0);
  const baseAmt = Number(base.value.amount);
  return baseAmt ? Math.round((effectiveQuote / baseAmt) * supply) : 0;
}

/** Creator fees a coin has earned on Pump.fun that haven't been collected yet, and Pump.fun's minimum to collect them. Cached for a minute. */
const online = new pumpSdk.OnlinePumpSdk(conn);
const accrueCache = new Map<string, { at: number; v: { accrued: number; minimum: number } | null }>();
export async function accruedFees(mintStr: string, payer: PublicKey) {
  const hit = accrueCache.get(mintStr);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  let v: { accrued: number; minimum: number } | null = null;
  try {
    const m = (await online.getMinimumDistributableFee(new PublicKey(mintStr), payer)) as any;
    v = { accrued: Number(m.distributableFees?.toString() ?? 0), minimum: Number(m.minimumRequired?.toString() ?? 0) };
  } catch {
    /* RPC hiccup: show nothing rather than a wrong number */
  }
  accrueCache.set(mintStr, { at: Date.now(), v });
  return v;
}

/** Refreshes a coin's art, description and market cap. */
export async function refreshMarket(c: Coin) {
  const patch: Partial<Coin> = {};
  // Every 6 hours, or every tick until the art has loaded at least once.
  if (!c.meta_at || now() - c.meta_at > 6 * 3600 || !c.image) {
    const meta = await readTokenMeta(c.mint).catch(() => null);
    if (meta) {
      patch.image = meta.image ?? c.image;
      patch.description = meta.description ?? c.description;
      if (meta.name) patch.name = meta.name;
      if (meta.symbol) patch.symbol = meta.symbol;
    }
    patch.meta_at = now();
  }
  const mcap = await marketCap(c.mint).catch(() => null);
  if (mcap !== null) patch.mcap_lamports = mcap;
  updateCoin(c.mint, patch);
}

export const getHonoree = (userId: string) =>
  db.prepare("SELECT * FROM honorees WHERE user_id = ?").get(userId) as { user_id: string; handle: string; name: string | null; avatar: string | null; updated_at: number } | undefined;

/** Stores an honoree's X name and avatar. Refreshed at most once a day per person. */
export async function rememberHonoree(userId: string, handle?: string) {
  const known = getHonoree(userId);
  if (known && now() - known.updated_at < 86400) return known;
  const u = (await lookupUserById(userId).catch(() => null)) ?? (handle ? await lookupUser(handle).catch(() => null) : null);
  if (!u) return known;
  db.prepare("INSERT OR REPLACE INTO honorees (user_id, handle, name, avatar, updated_at) VALUES (?, ?, ?, ?, ?)").run(u.id, u.username, u.name, u.avatar, now());
  return getHonoree(userId);
}
