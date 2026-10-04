"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi, type Stats } from "@/lib/api";
import { money } from "@/lib/format";
import { BarChart } from "@/components/BarChart";

const RANGES: [string, string][] = [["1d", "24 hours"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]];

export default function Analytics() {
  const [range, setRange] = useState("30d");
  const { data: s, error } = useApi<Stats>(`/api/stats?range=${range}`);
  const usd = s?.sol_usd ?? 0;
  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <div className="page-head">
        <h1>Analytics</h1>
        <p className="sub">What Feeward coins have sent to nonprofits, from the same ledger that powers every receipt.</p>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Period">
          {RANGES.map(([v, l]) => (
            <button key={v} aria-pressed={range === v} onClick={() => setRange(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="err">{error}</p>}
      <div className="stats">
        <div className="stat-tile dark"><small>Paid out</small><b>{money(s?.donated_lamports ?? 0, usd)}</b></div>
        <div className="stat-tile mint"><small>Payouts</small><b>{(s?.donations ?? 0).toLocaleString("en-US")}</b></div>
        <div className="stat-tile"><small>New coins</small><b>{(s?.coins_new ?? 0).toLocaleString("en-US")}</b></div>
        <div className="stat-tile"><small>Feeward coin bought back</small><b>{money(s?.buyback_lamports ?? 0, usd)}</b></div>
      </div>
      <section style={{ marginTop: 16 }}>
        {s ? <BarChart series={s.series} solUsd={usd} bucket={range === "1d" ? "hour" : "day"} /> : <div className="chart-empty">Loading…</div>}
      </section>
      <div className="cols" style={{ marginTop: 16 }}>
        <section className="panel">
          <h2>Nonprofits receiving the most</h2>
          <ol className="rank" style={{ marginTop: 12 }}>
            {(s?.top_nonprofits ?? []).map((n, i) => (
              <li key={n.config_id}>
                <span className="n">{i + 1}</span>
                <Link href={`/nonprofits/${n.config_id}`}>{n.name ?? "Nonprofit"}</Link>
                <b>{money(n.lamports, usd)}</b>
              </li>
            ))}
            {s && !s.top_nonprofits.length && <p className="muted">Nothing in this period.</p>}
          </ol>
        </section>
        <section className="panel">
          <h2>Across Feeward</h2>
          <dl className="facts" style={{ background: "transparent", padding: 0 }}>
            <dt>Coins giving</dt><dd>{s?.coins ?? 0}</dd>
            <dt>People named</dt><dd>{s?.honorees ?? 0}</dd>
            <dt>Donated to nonprofits</dt><dd>{money(s?.donation_lamports ?? 0, usd)}</dd>
            <dt>Sent as support to wallets</dt><dd>{money(s?.support_lamports ?? 0, usd)}</dd>
            <dt>Choosers who picked a recipient</dt><dd>{s?.honorees_chose ?? 0}</dd>
            <dt>Nonprofits that received donations</dt><dd>{s?.nonprofits ?? 0}</dd>
            <dt>Relayed coins: platform share</dt><dd>{money(s?.relay_platform_lamports ?? 0, usd)}</dd>
            <dt>Relayed coins: buyback share</dt><dd>{money(s?.relay_buyback_lamports ?? 0, usd)}</dd>
          </dl>
          <p className="muted small">Direct coins pay the platform and buyback shares straight from Pump.fun, so they don't pass through this ledger.</p>
        </section>
      </div>
    </div>
  );
}
