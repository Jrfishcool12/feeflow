"use client";
import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useExportWallet, useSignMessage, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { VersionedTransaction } from "@solana/web3.js";
import { api } from "./api";
import type { Provider } from "./wallet";

/**
 * The user's Feeward wallet: a Privy embedded Solana wallet created when they log in with X.
 * `provider` has the same shape as Phantom's, so launch and payout code can use either.
 */
export function useFeewardWallet() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const { exportWallet } = useExportWallet();
  const { createWallet } = useCreateWallet();
  const wallet = wallets[0] ?? null;
  const [creating, setCreating] = useState(false);
  // If Privy hasn't loaded after 8 seconds (outage, blocked by an extension), say so instead of waiting forever.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (ready) return setTimedOut(false);
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, [ready]);

  // Safety net: Privy creates the wallet at login, but if a user ever has none, make one (once).
  useEffect(() => {
    if (!ready || !authenticated || !walletsReady || wallet || creating) return;
    setCreating(true);
    createWallet().catch(() => {});
  }, [ready, authenticated, walletsReady, wallet, creating, createWallet]);

  const provider = useMemo<Provider | null>(() => {
    if (!wallet) return null;
    return {
      connect: async () => ({ publicKey: { toString: () => wallet.address } }),
      publicKey: { toString: () => wallet.address },
      signTransaction: async (tx: VersionedTransaction) => {
        const { signedTransaction } = await signTransaction({ transaction: tx.serialize(), wallet });
        return VersionedTransaction.deserialize(signedTransaction);
      },
      signMessage: async (message: Uint8Array) => {
        const { signature } = await signMessage({ message, wallet });
        return { signature };
      },
    };
  }, [wallet, signTransaction, signMessage]);

  return {
    ready: ready && (!authenticated || walletsReady),
    unavailable: !ready && timedOut,
    authenticated,
    handle: user?.twitter?.username ?? null,
    address: wallet?.address ?? null,
    provider,
    login: () => login(),
    logout: () => logout(),
    exportKey: () => (wallet ? exportWallet({ address: wallet.address }) : Promise.resolve()),
  };
}

/** A wallet's SOL balance in lamports, refreshed every 15 seconds while shown. */
export function useBalance(address: string | null) {
  const [lamports, setLamports] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!address) return setLamports(null);
    let live = true;
    const load = () => api<{ lamports: number }>(`/api/wallet/${address}`).then((r) => live && setLamports(r.lamports), () => {});
    load();
    const t = setInterval(load, 15_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [address, tick]);
  return { lamports, refresh: () => setTick((x) => x + 1) };
}

export const sol = (lamports: number | null) => (lamports === null ? "…" : `${(lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`);
