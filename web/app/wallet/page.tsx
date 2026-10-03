"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { post } from "@/lib/api";
import { signBase64 } from "@/lib/wallet";
import { sol, useBalance, useFeeFlowWallet } from "@/lib/feeflowWallet";
import { solscanAccount, solscanTx } from "@/lib/format";

export default function WalletPage() {
  const w = useFeeFlowWallet();
  const { lamports, refresh } = useBalance(w.address);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!w.address) return setQr(null);
    QRCode.toDataURL(w.address, { margin: 1, width: 360, color: { dark: "#141312", light: "#fffdf8" } }).then(setQr, () => setQr(null));
  }, [w.address]);

  const copy = () => w.address && navigator.clipboard.writeText(w.address).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)));

  if (w.unavailable)
    return (
      <div className="wrap" style={{ paddingTop: 48, paddingBottom: 96, maxWidth: 720 }}>
        <h1>Your FeeFlow wallet</h1>
        <p className="sub">FeeFlow wallets couldn't load right now. Check that a browser extension isn't blocking privy.io, then reload. You can still launch with Phantom or another wallet.</p>
      </div>
    );

  if (!w.ready)
    return (
      <div className="wrap" style={{ paddingTop: 48, paddingBottom: 96 }}>
        <p className="muted">Loading your wallet…</p>
      </div>
    );

  if (!w.authenticated)
    return (
      <div className="wrap" style={{ paddingTop: 48, paddingBottom: 96, maxWidth: 720 }}>
        <h1>Your FeeFlow wallet</h1>
        <p className="sub">
          Log in with X and a Solana wallet is created for you. Use it to launch coins and receive payouts without connecting Phantom or any other wallet extension.
        </p>
        <section className="panel" style={{ marginTop: 24 }}>
          <h2>Only you can use it</h2>
          <p className="muted">
            FeeFlow never sees your wallet's key. Wallets are provided by Privy, and you can export the key to Phantom or any Solana wallet at any time.
          </p>
          <button className="btn btn-green" onClick={w.login}>
            Log in with X
          </button>
        </section>
      </div>
    );

  return (
    <div className="wrap" style={{ paddingTop: 48, paddingBottom: 96, maxWidth: 880 }}>
      <h1>{w.handle ? `@${w.handle}'s wallet` : "Your FeeFlow wallet"}</h1>
      <p className="sub">Use it to launch coins and receive payouts. Only you can use it: FeeFlow never sees its key.</p>

      <div className="wallet-grid" style={{ marginTop: 24 }}>
        <section className="panel dark">
          <p className="kicker">Balance</p>
          <p className="big">{sol(lamports)}</p>
          {w.address ? (
            <>
              <p className="kicker" style={{ marginTop: 18 }}>
                Address
              </p>
              <div className="mono wallet-addr">{w.address}</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <button className="btn btn-white btn-sm" onClick={copy}>
                  {copied ? "Copied" : "Copy address"}
                </button>
                <a className="btn btn-ghost btn-sm" href={solscanAccount(w.address)} target="_blank" rel="noopener">
                  View on Solscan
                </a>
                <button className="btn btn-ghost btn-sm" onClick={refresh}>
                  Refresh
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Creating your wallet…</p>
          )}
        </section>

        <section className="panel" style={{ textAlign: "center" }}>
          <h2>Add SOL</h2>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code of your wallet address" width={180} height={180} style={{ borderRadius: 12 }} />
          ) : null}
          <p className="muted small" style={{ marginTop: 12, textAlign: "left" }}>
            Send SOL on the <b>Solana</b> network to this address, from an exchange (Coinbase, Kraken, Binance…) or another wallet. Launching a coin costs about 0.02 SOL, plus any
            dev buy.
          </p>
        </section>
      </div>

      {w.address && w.provider ? <Withdraw from={w.address} provider={w.provider} balance={lamports} onDone={refresh} /> : null}

      <section className="panel" style={{ marginTop: 20 }}>
        <h2>Your key</h2>
        <p className="muted">
          Export your wallet's private key to use the same wallet in Phantom, Solflare or any Solana wallet. The key is shown in a secure window that FeeFlow can't read. Never share
          it with anyone.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={() => w.exportKey().catch(() => {})}>
            Export key
          </button>
          <button className="btn btn-ghost" onClick={w.logout}>
            Log out
          </button>
        </div>
      </section>
    </div>
  );
}

function Withdraw({ from, provider, balance, onDone }: { from: string; provider: NonNullable<ReturnType<typeof useFeeFlowWallet>["provider"]>; balance: number | null; onDone: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);

  async function send(max: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const lamports = max ? undefined : Math.round(Number(amount) * 1e9);
      if (!max && (!lamports || lamports <= 0)) throw new Error("Enter an amount of SOL.");
      const built = await post<{ tx: string; lamports: number }>("/api/wallet/withdraw", { from, to: to.trim(), lamports, max });
      const signed = await signBase64(provider, built.tx);
      const r = await post<{ signature: string }>("/api/wallet/send", { tx: signed });
      setMsg({ ok: true, text: `Sent ${(built.lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 6 })} SOL.`, sig: r.signature });
      setAmount("");
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <h2>Withdraw</h2>
      <p className="muted small">Send SOL from this wallet to any Solana address. The network fee is about 0.000005 SOL.</p>
      <div className="form" style={{ gap: 12 }}>
        <label>
          To address
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Solana address" autoComplete="off" spellCheck={false} />
        </label>
        <label>
          Amount <span className="hint">SOL</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" />
        </label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-green" disabled={busy || !to.trim()} onClick={() => send(false)}>
            {busy ? "Sending…" : "Withdraw"}
          </button>
          <button className="btn btn-ghost" disabled={busy || !to.trim() || !balance} onClick={() => send(true)}>
            Withdraw everything
          </button>
        </div>
      </div>
      {msg && (
        <p className={msg.ok ? "ok" : "err"} role="status" style={{ marginTop: 12 }}>
          {msg.text}{" "}
          {msg.sig ? (
            <a href={solscanTx(msg.sig)} target="_blank" rel="noopener">
              Receipt
            </a>
          ) : null}
        </p>
      )}
    </section>
  );
}
