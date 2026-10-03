"use client";
import Link from "next/link";
import { useApi, type Config } from "@/lib/api";
import { day, money, pct, pumpCoin, short, solscanAccount, solscanTx } from "@/lib/format";

type Buybacks = { sol_usd: number; platform_coin: string | null; totals: { lamports: number; n: number }; recent: { lamports: number; tokens_raw: string; buy_sig: string; burn_sig: string | null; created_at: number }[] };

export default function Buyback() {
  const cfg = useApi<Config>("/api/config").data;
  const { data } = useApi<Buybacks>("/api/buybacks");
  const usd = data?.sol_usd ?? 0;
  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <div className="page-head">
        <h1>The FeeFlow coin buyback</h1>
        <p className="sub">
          {cfg ? pct(cfg.buyback_bps) : "5%"} of every FeeFlow coin's creator fees buys the FeeFlow coin on the open market and burns it. The buys happen at random times, so they can't be traded around.
        </p>
      </div>
      <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat-tile dark"><small>Bought and burned</small><b>{money(data?.totals.lamports ?? 0, usd)}</b></div>
        <div className="stat-tile mint"><small>Buybacks</small><b>{data?.totals.n ?? 0}</b></div>
        <div className="stat-tile"><small>Buyback wallet</small><b style={{ fontSize: 20 }}>{cfg ? <a href={solscanAccount(cfg.buyback_wallet)} target="_blank" rel="noopener">{short(cfg.buyback_wallet)}</a> : "—"}</b></div>
      </div>
      <div className="cols" style={{ marginTop: 16 }}>
        <section className="panel">
          <h2>How it works</h2>
          <ol className="steps-num">
            <li><span><b>A share of every coin's fees</b>{cfg ? pct(cfg.buyback_bps) : "5%"} of creator fees, direct or relayed, goes to the buyback wallet.</span></li>
            <li><span><b>A random moment</b>Between 5 minutes and an hour after the last attempt, drawn fresh each time with cryptographic randomness.</span></li>
            <li><span><b>Buy and burn</b>Once the wallet can spend at least 0.05 SOL (it holds about 0.058 SOL, leaving room for slippage and fees), it buys the FeeFlow coin and burns every token it bought.</span></li>
          </ol>
          <p className="muted small">
            The coin gates nothing: holding it doesn't change any split or give any rights. {data?.platform_coin ? <a href={pumpCoin(data.platform_coin)} target="_blank" rel="noopener">See it on Pump.fun</a> : null}
          </p>
        </section>
        <section className="panel">
          <h2>Recent buybacks</h2>
          {data && !data.recent.length && <p className="muted">No buybacks yet.</p>}
          <table className="history">
            <tbody>
              {(data?.recent ?? []).map((b) => (
                <tr key={b.buy_sig}>
                  <td>{day(b.created_at)}</td>
                  <td>{money(b.lamports, usd)}</td>
                  <td>
                    <a href={solscanTx(b.buy_sig)} target="_blank" rel="noopener">buy</a>
                    {b.burn_sig ? <> / <a href={solscanTx(b.burn_sig)} target="_blank" rel="noopener">burn</a></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <p className="muted small" style={{ marginTop: 18 }}>See <Link href="/legal/disclosures">disclosures</Link> for what the FeeFlow coin is not.</p>
    </div>
  );
}
