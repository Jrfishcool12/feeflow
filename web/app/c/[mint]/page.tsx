"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useApi, type CoinDetail, type Config } from "@/lib/api";
import { compact, money, pumpCoin, shareOnX, short, solscanAccount } from "@/lib/format";
import { ActionPanel } from "@/components/ActionPanel";
import { RolesCard } from "@/components/RolesCard";
import { STATE_SHORT, statusLine } from "@/lib/roles";
import { WhereFeesGo } from "@/components/WhereFeesGo";
import { DonationFeed } from "@/components/DonationFeed";
import { Avatar } from "@/components/Avatar";

export default function CoinPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = use(params);
  const { data: d, error, reload } = useApi<CoinDetail>(`/api/coins/${encodeURIComponent(mint)}`);
  const cfg = useApi<Config>("/api/config").data;
  const [copied, setCopied] = useState(false);

  // Links from posts and the X login return to #act: scroll there once the page has its data.
  const loaded = !!d;
  useEffect(() => {
    if (loaded && window.location.hash === "#act") setTimeout(() => document.getElementById("act")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [loaded]);

  useEffect(() => {
    if (d && (d.coin.status === "launched" || d.coin.status === "built")) {
      const t = setTimeout(reload, 5000);
      return () => clearTimeout(t);
    }
  }, [d, reload]);

  if (error)
    return (
      <div className="wrap page-head">
        <h1>Coin not found</h1>
        <p className="sub">{error} If you launched it elsewhere, check what it still needs.</p>
        <div className="actions" style={{ display: "flex", gap: 10 }}>
          <Link href={`/launch?tab=existing&mint=${encodeURIComponent(mint)}`} className="btn btn-green">
            Check this coin
          </Link>
          <Link href="/explore" className="btn btn-ghost">
            Explore coins
          </Link>
        </div>
      </div>
    );
  if (!d) return <div className="wrap page-head"><p className="muted">Loading…</p></div>;

  const c = d.coin;
  if (c.status !== "live")
    return (
      <div className="wrap page-head">
        <h1>${c.symbol} is launching</h1>
        <p className="sub">The coin exists. Its fee routing is being set up now; this page updates by itself.</p>
      </div>
    );

  const url = typeof window !== "undefined" ? window.location.href : "";
  const shareText = c.holding
    ? `${money(c.waiting_lamports, d.sol_usd)} from $${c.symbol} creator fees is ${statusLine(c)}.`
    : `${money(c.donated_lamports, d.sol_usd)} from $${c.symbol} creator fees: ${statusLine(c)}.`;
  const amount = c.holding ? c.waiting_lamports : c.donated_lamports;

  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <section className="coin-hero">
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 22 }}>
          <Avatar src={c.image} label={c.symbol} size={56} square />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>{c.name}</div>
            <div className="muted" style={{ color: "var(--muted-dark)" }}>
              ${c.symbol}
              {c.mcap_lamports ? `, ${compact(c.mcap_lamports, d.sol_usd)} market cap` : ""}
            </div>
          </div>
        </div>
        <p className="kicker">{c.holding ? "Held from" : "Paid out from"} ${c.symbol} creator fees</p>
        <p className="big">{money(amount, d.sol_usd)}</p>
        <p className="to">{statusLine(c)}</p>
        {c.holding && c.release_at ? (
          <p className="kicker" style={{ marginTop: 12 }}>
            If no payout destination is set by {new Date(c.release_at * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}, funds go to{" "}
            {c.fallback?.name ?? "the fallback nonprofit"}.
          </p>
        ) : null}
        <div className="chips">
          <span className={`badge${c.mode === "launch" ? " green" : ""}`}>{c.mode === "launch" ? "Direct" : "Relayed"}</span>
          <span className={`badge${c.state === "active" ? " green" : ""}`}>{STATE_SHORT[c.state]}</span>
          {c.payout?.kind === "wallet" && <span className="badge">Support to wallet</span>}
          {c.payout?.kind === "nonprofit" && <span className="badge">Nonprofit via donate.gg</span>}
          {!c.holding && c.pending_lamports ? <span className="badge">{money(c.pending_lamports, d.sol_usd)} waiting to be paid out</span> : null}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 26 }}>
          <a className="btn btn-green btn-sm" href={pumpCoin(c.mint)} target="_blank" rel="noopener">
            Trade on Pump.fun
          </a>
          <a className="btn btn-white btn-sm" href={shareOnX(shareText, url)} target="_blank" rel="noopener">
            Share on X
          </a>
          <button className="btn btn-ghost btn-sm" style={{ color: "var(--white)" }} onClick={() => navigator.clipboard.writeText(c.mint).then(() => setCopied(true))}>
            {copied ? "Copied" : `Copy address ${short(c.mint)}`}
          </button>
        </div>
      </section>
      <p className="disclaimer">
        {c.honoree ? `@${c.honoree} hasn't endorsed this coin. ` : ""}
        {c.recipient && c.recipient !== c.honoree ? `Neither has @${c.recipient}. ` : ""}
        Mint <a href={solscanAccount(c.mint)} target="_blank" rel="noopener">{short(c.mint)}</a>.
      </p>
      {c.description && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>About ${c.symbol}</h2>
          <p className="muted" style={{ whiteSpace: "pre-line", margin: 0 }}>{c.description}</p>
        </section>
      )}
      <div className="cols">
        <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
          <ActionPanel d={d} cfg={cfg} onChanged={reload} />
          <RolesCard d={d} />
        </div>
        <WhereFeesGo d={d} cfg={cfg} />
      </div>
      <section style={{ marginTop: 32 }}>
        <h2 className="h2" style={{ fontSize: 30 }}>Payouts from ${c.symbol}</h2>
        <DonationFeed query={`mint=${encodeURIComponent(c.mint)}`} limit={15} />
      </section>
    </div>
  );
}
