"use client";
import { use } from "react";
import Link from "next/link";
import { useApi, type Coin } from "@/lib/api";
import { money, xProfile } from "@/lib/format";
import { CoinCard } from "@/components/CoinCard";
import { DonationFeed } from "@/components/DonationFeed";

type Detail = { sol_usd: number; nonprofit: { config_id: string; name: string; x_handle: string | null; url: string | null; received_lamports: number }; coins: Coin[] };

export default function NonprofitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useApi<Detail>(`/api/nonprofits/${encodeURIComponent(id)}`);
  if (error) return <div className="wrap page-head"><h1>Not found</h1><p className="sub">{error}</p></div>;
  if (!data) return <div className="wrap page-head"><p className="muted">Loading…</p></div>;
  const n = data.nonprofit;
  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <div className="page-head">
        <h1>{n.name}</h1>
        <p className="sub">
          {n.x_handle ? <a href={xProfile(n.x_handle)} target="_blank" rel="noopener">@{n.x_handle}</a> : null}
          {n.x_handle && n.url ? " and " : ""}
          {n.url ? <a href={n.url} target="_blank" rel="noopener">{n.url.replace(/^https?:\/\//, "")}</a> : null}
        </p>
      </div>
      <div className="stats" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <div className="stat-tile dark">
          <small>Received through FeeFlow</small>
          <b>{money(n.received_lamports, data.sol_usd)}</b>
        </div>
        <div className="stat-tile mint">
          <small>Coins giving to it now</small>
          <b>{data.coins.length}</b>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <Link href="/launch" className="btn btn-green btn-sm">Launch a coin for {n.name}</Link>
      </div>
      {data.coins.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h2 className="h2" style={{ fontSize: 30 }}>Coins giving to {n.name}</h2>
          <div className="grid-cards">
            {data.coins.map((c) => (
              <CoinCard key={c.mint} coin={c} solUsd={data.sol_usd} />
            ))}
          </div>
        </section>
      )}
      <section style={{ marginTop: 40 }}>
        <h2 className="h2" style={{ fontSize: 30 }}>Donations received</h2>
        <DonationFeed query={`config=${encodeURIComponent(n.config_id)}`} limit={15} />
      </section>
    </div>
  );
}
