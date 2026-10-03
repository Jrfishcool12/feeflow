"use client";
import { use } from "react";
import Link from "next/link";
import { useApi, type Coin } from "@/lib/api";
import { money, xProfile } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { CoinCard } from "@/components/CoinCard";
import { DonationFeed } from "@/components/DonationFeed";

type Profile = {
  sol_usd: number;
  profile: { handle: string; name: string | null; avatar: string | null; total_lamports: number; coins: number };
  coins: Coin[];
  nonprofits: { config_id: string; name: string | null; x_handle: string | null; lamports: number }[];
};

export default function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const { data, error } = useApi<Profile>(`/api/profile/${encodeURIComponent(handle)}`);
  if (error)
    return (
      <div className="wrap page-head">
        <h1>@{handle}</h1>
        <p className="sub">{error}</p>
        <Link href="/launch" className="btn btn-green">
          Launch a coin for them
        </Link>
      </div>
    );
  if (!data) return <div className="wrap page-head"><p className="muted">Loading…</p></div>;
  const p = data.profile;
  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <div className="profile-head">
        <Avatar src={p.avatar} label={p.handle} size={96} />
        <div>
          <h1>{p.name ?? `@${p.handle}`}</h1>
          <p>
            <a href={xProfile(p.handle)} target="_blank" rel="noopener">@{p.handle}</a> on X. Coins this account is tagged on; being tagged isn't an endorsement. They choose each coin's recipient, which can be themselves.
          </p>
        </div>
      </div>
      <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat-tile dark">
          <small>Paid out from their coins</small>
          <b>{money(p.total_lamports, data.sol_usd)}</b>
        </div>
        <div className="stat-tile mint">
          <small>Coins</small>
          <b>{p.coins}</b>
        </div>
        <div className="stat-tile">
          <small>Nonprofits supported</small>
          <b>{data.nonprofits.length}</b>
        </div>
      </div>
      <section className="panel dark" style={{ marginTop: 16 }}>
        <h2>Is this you?</h2>
        <p className="muted">Open any of these coins and log in with X to pick the nonprofit its fees are sent to, or to take your name off it.</p>
      </section>
      {data.nonprofits.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h2 className="h2" style={{ fontSize: 30 }}>Where it went</h2>
          <ol className="rank">
            {data.nonprofits.map((n, i) => (
              <li key={n.config_id}>
                <span className="n">{i + 1}</span>
                <Link href={`/nonprofits/${n.config_id}`}>{n.name ?? "Nonprofit"}</Link>
                <b>{money(n.lamports, data.sol_usd)}</b>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section style={{ marginTop: 40 }}>
        <h2 className="h2" style={{ fontSize: 30 }}>Coins they're tagged on</h2>
        <div className="grid-cards">
          {data.coins.map((c) => (
            <CoinCard key={c.mint} coin={c} solUsd={data.sol_usd} />
          ))}
        </div>
      </section>
      <section style={{ marginTop: 40 }}>
        <h2 className="h2" style={{ fontSize: 30 }}>Payouts</h2>
        <DonationFeed query={`handle=${encodeURIComponent(p.handle)}`} limit={15} />
      </section>
    </div>
  );
}
