"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi, type NonprofitStats } from "@/lib/api";
import { money } from "@/lib/format";

export default function Nonprofits() {
  const { data, error } = useApi<{ sol_usd: number; nonprofits: NonprofitStats[] }>("/api/nonprofits");
  const [q, setQ] = useState("");
  const shown = useMemo(() => (data?.nonprofits ?? []).filter((n) => !q || `${n.name} ${n.x_handle ?? ""}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <div className="page-head">
        <h1>Nonprofits</h1>
        <p className="sub">Nonprofits a recipient can route to, from donate.gg's list of onboarded organizations. donate.gg delivers donations and charges a processing fee; Feeward doesn't separately verify them.</p>
      </div>
      <div className="toolbar">
        <input style={{ maxWidth: 360 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search nonprofits" aria-label="Search nonprofits" />
      </div>
      {error && <p className="err">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      <div className="coins">
        {shown.map((n) => (
          <Link key={n.config_id} href={`/nonprofits/${n.config_id}`} className="coin-row" style={{ gridTemplateColumns: "1fr auto auto" }}>
            <span>
              <b>{n.name}</b>
              {n.x_handle ? <span className="muted small"> @{n.x_handle}</span> : null}
            </span>
            <span className="muted small">{n.coins} coin{n.coins === 1 ? "" : "s"}</span>
            <span className="amt">{money(n.received_lamports, data!.sol_usd)}</span>
          </Link>
        ))}
        {data && !shown.length && <div className="empty">No nonprofit matches that.</div>}
      </div>
    </div>
  );
}
