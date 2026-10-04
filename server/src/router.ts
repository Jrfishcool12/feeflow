/**
 * Client for the Feeward router program (../program).
 *
 * With the router on, every coin launched on Feeward has the router's `authority` PDA as
 * its creator and fee-sharing admin. The program only ever writes the split
 * "nonprofit escrow / platform / buyback" with percentages fixed on-chain, and changing the
 * nonprofit needs a fresh attestation signed by this server after the honoree logs in.
 *
 * Pump.fun instructions are built with the official SDK (with the PDA as authority) and
 * their account lists are passed to the router as remaining accounts. The router checks the
 * accounts that matter, writes the instruction data itself and signs as the PDA.
 */
import { createHash } from "node:crypto";
import { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { cfg } from "./config.js";
import { authority } from "./chain.js";

export const ROUTER_ID = cfg.ROUTER_PROGRAM_ID ? new PublicKey(cfg.ROUTER_PROGRAM_ID) : null;
export const routerOn = () => ROUTER_ID !== null;

const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, ROUTER_ID!)[0];
export const routerAuthority = () => pda(Buffer.from("authority"));
export const routerConfig = () => pda(Buffer.from("config"));
export const coinRecord = (mint: PublicKey) => pda(Buffer.from("coin"), mint.toBuffer());

/** The key that creates coins and administers their fee sharing: the router PDA, or the server key. */
export const feeAdmin = () => (routerOn() ? routerAuthority() : authority.publicKey);

const disc = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
export const honoreeHash = (xUserId: string) => createHash("sha256").update(xUserId).digest();

/** Pump.fun accounts as router remaining accounts. The PDA can't sign the outer transaction; the router signs for it. */
function remaining(...ixs: (TransactionInstruction | null)[]): AccountMeta[] {
  const pdaKey = routerAuthority();
  return ixs.flatMap((ix) => (ix ? ix.keys.map((k) => ({ ...k, isSigner: k.pubkey.equals(pdaKey) ? false : k.isSigner })) : []));
}

const ix = (keys: AccountMeta[], data: Buffer) => new TransactionInstruction({ programId: ROUTER_ID!, keys, data });
const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const i64 = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };

export function initializeIx(p: { attester: PublicKey; platform: PublicKey; buyback: PublicKey; charityBps: number; platformBps: number; buybackBps: number; cooldownSecs: number }) {
  return ix(
    [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: routerConfig(), isSigner: false, isWritable: true },
      ro(routerAuthority()),
      ro(SystemProgram.programId),
    ],
    Buffer.concat([disc("initialize"), p.attester.toBuffer(), p.platform.toBuffer(), p.buyback.toBuffer(), u16(p.charityBps), u16(p.platformBps), u16(p.buybackBps), i64(p.cooldownSecs)])
  );
}

export function enableSharingIx(mint: PublicKey, createSharing: TransactionInstruction) {
  return ix([{ pubkey: authority.publicKey, isSigner: true, isWritable: false }, ro(routerConfig()), ro(mint), ...remaining(createSharing)], disc("enable_sharing"));
}

export function createEscrowIx(mint: PublicKey, charity: PublicKey, createEscrow: TransactionInstruction) {
  return ix([{ pubkey: authority.publicKey, isSigner: true, isWritable: false }, ro(routerConfig()), ro(mint), ro(charity), ...remaining(createEscrow)], disc("create_escrow"));
}

export function activateIx(mint: PublicKey, charity: PublicKey, xUserId: string, createEscrow: TransactionInstruction | null, updateShares: TransactionInstruction) {
  return ix(
    [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      ro(routerConfig()),
      { pubkey: coinRecord(mint), isSigner: false, isWritable: true },
      ro(mint),
      ro(charity),
      ro(SystemProgram.programId),
      ...remaining(createEscrow, updateShares),
    ],
    Buffer.concat([disc("activate"), honoreeHash(xUserId), Buffer.from([createEscrow ? createEscrow.keys.length : 0])])
  );
}

/** The attestation the router checks before letting a coin's nonprofit change. */
export function attestation(mint: PublicKey, xUserId: string, charity: PublicKey, expiresAt: number) {
  // The router checks a signature over the sha256 of these fields (keeps the transaction small).
  const message = createHash("sha256").update(Buffer.concat([Buffer.from("goodcall:set_charity:v1"), mint.toBuffer(), honoreeHash(xUserId), charity.toBuffer(), i64(expiresAt)])).digest();
  return Ed25519Program.createInstructionWithPrivateKey({ privateKey: authority.secretKey, message });
}

export function setCharityIx(mint: PublicKey, charity: PublicKey, expiresAt: number, createEscrow: TransactionInstruction | null, updateShares: TransactionInstruction) {
  return ix(
    [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      ro(routerConfig()),
      { pubkey: coinRecord(mint), isSigner: false, isWritable: true },
      ro(mint),
      ro(charity),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
      ...remaining(createEscrow, updateShares),
    ],
    Buffer.concat([disc("set_charity"), i64(expiresAt), Buffer.from([createEscrow ? createEscrow.keys.length : 0])])
  );
}

/** Decodes the router's on-chain config account. */
export function decodeRouterConfig(data: Buffer) {
  let o = 8;
  const key = () => { const k = new PublicKey(data.subarray(o, o + 32)); o += 32; return k; };
  const admin = key(), attester = key(), platformWallet = key(), buybackWallet = key();
  const charityBps = data.readUInt16LE(o), platformBps = data.readUInt16LE(o + 2), buybackBps = data.readUInt16LE(o + 4);
  const cooldownSecs = Number(data.readBigInt64LE(o + 6));
  return { admin, attester, platformWallet, buybackWallet, charityBps, platformBps, buybackBps, cooldownSecs };
}
