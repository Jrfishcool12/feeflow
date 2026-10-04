import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createHmac } from "node:crypto";
import bs58 from "bs58";
import { cfg } from "./config.js";

/**
 * RPC usage, logged every 3 minutes: calls per method, and which methods the provider refused (HTTP 429)
 * with its reason, so rate limits can be traced to the calls that cause them.
 */
const rpcCalls = new Map<string, number>();
const rpcLimited = new Map<string, number>();
let rpcReason = "";
const rpcFetch = async (input: any, init?: any) => {
  let methods: string[] = [];
  try {
    const body = JSON.parse(String(init?.body ?? ""));
    methods = (Array.isArray(body) ? body : [body]).map((x: any) => String(x.method));
  } catch {
    /* not a JSON-RPC body */
  }
  for (const m of methods) rpcCalls.set(m, (rpcCalls.get(m) ?? 0) + 1);
  const res = await fetch(input, init);
  if (res.status === 429) {
    for (const m of methods) rpcLimited.set(m, (rpcLimited.get(m) ?? 0) + 1);
    if (!rpcReason) rpcReason = (await res.clone().text().catch(() => "")).slice(0, 200);
  }
  return res;
};
const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(", ");
setInterval(() => {
  const total = [...rpcCalls.values()].reduce((a, b) => a + b, 0);
  if (total) console.log(`rpc: ${total} calls in 3 min (${(total / 180).toFixed(1)}/s avg): ${top(rpcCalls)}`);
  if (rpcLimited.size) console.log(`rpc 429s: ${top(rpcLimited)}${rpcReason ? ` | provider said: ${rpcReason}` : ""}`);
  rpcCalls.clear();
  rpcLimited.clear();
  rpcReason = "";
}, 180_000).unref();

export const conn = new Connection(cfg.RPC_URL, { commitment: "confirmed", fetch: rpcFetch as any });

function parseKeypair(secret: string): Keypair {
  const s = secret.trim();
  return s.startsWith("[") ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s))) : Keypair.fromSecretKey(bs58.decode(s));
}

/** Creator of every coin launched here and admin of each coin's fee sharing. Pays setup and crank fees. */
export const authority = parseKeypair(cfg.AUTHORITY_SECRET_KEY);
export const platformWallet = new PublicKey(cfg.PLATFORM_WALLET);

/**
 * Buyback wallet: receives the buyback share of every coin's fees and spends it buying
 * the platform coin, then burns what it bought. Derived from the authority key, so there's
 * no extra secret to manage. It only ever holds SOL waiting to be spent.
 */
// The "iyn-" salts below predate the Feeward name. Never change them: they derive live keys.
export const buybackWallet = Keypair.fromSeed(createHmac("sha256", Buffer.from(authority.secretKey)).update("iyn-buyback").digest());
if (buybackWallet.publicKey.equals(platformWallet)) throw new Error("PLATFORM_WALLET can't be the buyback wallet.");

export const budget = (units = 400_000) => [
  ComputeBudgetProgram.setComputeUnitLimit({ units }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
];

/** Sends a transaction paid by the authority, also signed by any extra keys it needs (e.g. a relay vault). */
export async function send(ixs: TransactionInstruction[], units: number | null = 400_000, extra: Keypair[] = []) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  // units = null skips the compute-budget instructions, for transactions right at the size limit.
  const msg = new TransactionMessage({ payerKey: authority.publicKey, recentBlockhash: blockhash, instructions: [...(units === null ? [] : budget(units)), ...ixs] }).compileToV0Message();
  const required = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures);
  const tx = new VersionedTransaction(msg);
  tx.sign([authority, ...extra].filter((k) => required.some((r) => r.equals(k.publicKey))));
  return submit(tx, blockhash, lastValidBlockHeight);
}

/**
 * Sends a signed transaction and waits for it to confirm. Confirmation is checked over plain HTTP
 * (RPC providers rate-limit websocket subscriptions), re-sending every few seconds until it lands or
 * its blockhash expires.
 */
export async function submit(tx: VersionedTransaction, _blockhash?: string, lastValidBlockHeight?: number) {
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { maxRetries: 3 });
  const expiry = lastValidBlockHeight ?? (await conn.getLatestBlockhash("confirmed")).lastValidBlockHeight;
  for (let i = 0; ; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error(`Transaction ${sig} failed: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
    if (i % 4 === 3) {
      if ((await conn.getBlockHeight("confirmed")) > expiry) throw new Error(`Transaction ${sig} expired before it confirmed`);
      await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    }
  }
}

/** The Feeward treasury: holds donations until honorees choose, and receives relayed coins' fees. */
export function treasury(): Keypair {
  return Keypair.fromSeed(createHmac("sha256", cfg.MASTER_SEED!).update("goodcall-treasury").digest());
}

/** Relay vault for one coin, derived from MASTER_SEED + a random nonce. The vault balance is that coin's pending donations. */
export function vaultKeypair(nonce: string): Keypair {
  if (!cfg.MASTER_SEED) throw new Error("MASTER_SEED is not set");
  return Keypair.fromSeed(createHmac("sha256", cfg.MASTER_SEED).update(`iyn-vault:${nonce}`).digest());
}

export function isWallet(s: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(s).toBytes());
  } catch {
    return false;
  }
}
