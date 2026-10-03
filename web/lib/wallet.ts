"use client";
import { VersionedTransaction } from "@solana/web3.js";

type Provider = {
  connect: () => Promise<{ publicKey?: { toString(): string } } | void>;
  publicKey?: { toString(): string } | null;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  signMessage?: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
};

/** The first injected Solana wallet: Phantom, Solflare, Backpack, or anything on window.solana. */
export function findWallet(): Provider | null {
  const w = window as unknown as Record<string, any>;
  return w.phantom?.solana ?? w.solflare ?? w.backpack ?? w.solana ?? null;
}

export async function connectWallet(): Promise<{ provider: Provider; address: string }> {
  const provider = findWallet();
  if (!provider) throw new Error("No Solana wallet found. Install Phantom, Solflare or Backpack, then try again.");
  const res = await provider.connect();
  const key = (res && "publicKey" in res ? res.publicKey : null) ?? provider.publicKey;
  if (!key) throw new Error("The wallet didn't share an address.");
  return { provider, address: key.toString() };
}

const fromB64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const toB64 = (u: Uint8Array) => btoa(Array.from(u, (x) => String.fromCharCode(x)).join(""));

/** Has the wallet sign a base64 transaction built by the server, and returns it base64-encoded. */
export async function signBase64(provider: Provider, txB64: string): Promise<string> {
  const signed = await provider.signTransaction(VersionedTransaction.deserialize(fromB64(txB64)));
  return toB64(signed.serialize());
}

/** Has the wallet sign a plain-text message (proof of ownership; no transaction, no fee). Returns the signature base64-encoded. */
export async function signText(provider: Provider, text: string): Promise<string> {
  if (!provider.signMessage) throw new Error("This wallet can't sign messages. Try Phantom, Solflare or Backpack.");
  const res = await provider.signMessage(new TextEncoder().encode(text), "utf8");
  const sig = res instanceof Uint8Array ? res : res.signature;
  return toB64(sig);
}
