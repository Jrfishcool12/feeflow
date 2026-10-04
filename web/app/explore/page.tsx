"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useApi, type Coin } from "@/lib/api";
import { CoinCard } from "@/components/CoinCard";
import { CoinRow } from "@/components/CoinRow";

type Mode = "all" | "launch" | "relay";
type Sort = "given" | "mcap" | "new";

export default function Explore() {
  const [sort, setSort] = useState<Sort>("given");
  const [mode, setMode] = useState<Mode>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const { data, error } = useApi<{ sol_usd: number; coins: Coin[] }>(`/api/coins?sort=${sort}${mode === "all" ? "" : `&mode=${mode}`}&limit=500`);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase().replace(/^[@$]/, "");
    return (data?.coins ?? []).filter((c) => !n || [c.symbol, c.name, c.honoree ?? "", c.honoree_name ?? "", c.charity?.name ?? "", c.mint].some((s) => s.toLowerCase().includes(n)));
  }, [data, q]);

  const seg = <T extends string>(value: T, set: (v: T) => void, opts: [T, string][], label: string) => (
    <div className="seg" role="group" aria-label={label}>
      {opts.map(([v, l]) => (
        <button key={v} aria-pressed={value === v} onClick={() => set(v)}>
          {l}
        </button>
      ))}
    </div>
  );

  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <div className="page-head">
        <h1>Explore coins</h1>
        <p className="sub">Every coin routing creator fees through Feeward. Direct coins were launched on Feeward; relayed coins were launched elsewhere and route through the Feeward treasury.</p>
      </div>
      <div className="toolbar">
        <input style={{ maxWidth: 340 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ticker, person, nonprofit or address" aria-label="Search coins" />
        {seg(sort, setSort, [["given", "Most paid out"], ["mcap", "Market cap"], ["new", "Newest"]], "Sort")}
        {seg(mode, setMode, [["all", "All"], ["launch", "Direct"], ["relay", "Relayed"]], "Type")}
        {seg(view, setView, [["grid", "Grid"], ["list", "List"]], "View")}
      </div>
      {error && <p className="err">{error}</p>}
      {!data && !error && <p className="muted">Loading coins…</p>}
      {data && shown.length === 0 && (
        <div className="coins empty">
          <p>{q || mode !== "all" ? "No coin matches that." : "No coins yet."}</p>
          <Link href="/launch" className="btn btn-green">
            Launch a coin
          </Link>
        </div>
      )}
      {data && shown.length > 0 && view === "grid" && (
        <div className="grid-cards">
          {shown.map((c) => (
            <CoinCard key={c.mint} coin={c} solUsd={data.sol_usd} />
          ))}
        </div>
      )}
      {data && shown.length > 0 && view === "list" && (
        <div className="coins">
          {shown.map((c) => (
            <CoinRow key={c.mint} coin={c} solUsd={data.sol_usd} />
          ))}
        </div>
      )}
      {data && <p className="muted small" style={{ marginTop: 16 }}>{shown.length} coin{shown.length === 1 ? "" : "s"}</p>}
    </div>
  );
}
