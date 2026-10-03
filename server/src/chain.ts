import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createHmac } from "node:crypto";
import bs58 from "bs58";
import { cfg } from "./config.js";

export const conn = new Connection(cfg.RPC_URL, "confirmed");

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
// The "iyn-" salts below predate the FeeFlow name. Never change them: they derive live keys.
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

export async function submit(tx: VersionedTransaction, blockhash?: string, lastValidBlockHeight?: number) {
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const bh = blockhash && lastValidBlockHeight ? { blockhash, lastValidBlockHeight } : await conn.getLatestBlockhash("confirmed");
  const res = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (res.value.err) throw new Error(`Transaction ${sig} failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

/** The FeeFlow treasury: holds donations until honorees choose, and receives relayed coins' fees. */
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
