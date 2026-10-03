"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Donation } from "@/lib/api";
import { ago, day, money, solscanTx } from "@/lib/format";
import { Avatar } from "./Avatar";

/** The public payout feed (donations to nonprofits and support to recipients' wallets), optionally filtered. Pages with "Load more". */
export function DonationFeed({ query = "", limit = 25, compactView = false, more = true }: { query?: string; limit?: number; compactView?: boolean; more?: boolean }) {
  const [rows, setRows] = useState<Donation[] | null>(null);
  const [usd, setUsd] = useState(0);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = async (before?: number) => {
    try {
      const r = await api<{ sol_usd: number; donations: Donation[] }>(`/api/donations?limit=${limit}${query ? "&" + query : ""}${before ? "&before=" + before : ""}`);
      setUsd(r.sol_usd);
      setRows((prev) => (before && prev ? [...prev, ...r.donations] : r.donations));
      if (r.donations.length < limit) setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    setRows(null);
    setDone(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (err) return <p className="err">{err}</p>;
  if (!rows) return <p className="muted">Loading payouts…</p>;
  if (!rows.length) return <p className="muted">No payouts yet. Each one appears here with its public transaction.</p>;
  return (
    <>
      <ul className={`feed${compactView ? " compact" : ""}`}>
        {rows.map((d) => (
          <li key={d.id}>
            <Link href={`/c/${d.mint}`} className="feed-art" aria-label={`$${d.symbol}`}>
              <Avatar src={d.image} label={d.symbol} size={40} square />
            </Link>
            <div className="feed-main">
              <div>
                {d.kind === "support" ? (
                  <>
                    <b className="tabular">{money(d.lamports, usd)}</b> sent to {d.recipient ? <>@{d.recipient}</> : "the recipient"} <span className="badge">support</span>
                  </>
                ) : (
                  <>
                    <b className="tabular">{money(d.lamports, usd)}</b> donated to{" "}
                    {d.nonprofit ? <Link href={`/nonprofits/${d.config_id}`}>{d.nonprofit}</Link> : "a nonprofit"}
                  </>
                )}
              </div>
              <div className="muted small">
                from <Link href={`/c/${d.mint}`}>${d.symbol}</Link> creator fees
                {d.kind === "donation" && d.recipient ? <>, chosen by @{d.recipient}</> : null}
                {d.honoree ? (
                  <>
                    {" "}· tags <Link href={`/u/${d.honoree}`}>@{d.honoree}</Link>
                  </>
                ) : null}
              </div>
            </div>
            <div className="feed-meta">
              <span className="muted small" title={day(d.created_at)}>{ago(d.created_at)}</span>
              {d.signature ? (
                <a className="small" href={solscanTx(d.signature)} target="_blank" rel="noopener">
                  Receipt
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {more && !done && (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => load(rows.at(-1)!.id)}>
          Load more
        </button>
      )}
    </>
  );
}
