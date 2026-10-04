"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useApi, type Coin, type CoinDetail, type Config, type Donation, type Honoree, type NonprofitStats, type Stats } from "@/lib/api";
import { ago, compact, money, pct } from "@/lib/format";
import { SplitBar } from "@/components/SplitBar";
import { DonationFeed } from "@/components/DonationFeed";
import { Avatar } from "@/components/Avatar";
import { HeroFlow } from "@/components/HeroFlow";
import { XThread } from "@/components/XThread";

function LoginNotice() {
  const failed = useSearchParams().get("login") === "failed";
  return failed ? (
    <div className="wrap" style={{ paddingTop: 16 }}>
      <p className="notice bad">The X login didn't finish. Open the coin's page and try again.</p>
    </div>
  ) : null;
}

/** Counts up to a value when it changes. */
function CountUp({ to, format }: { to: number; format: (n: number) => string }) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 900);
      const e = 1 - Math.pow(1 - k, 3);
      setV(a + (to - a) * e);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{format(v)}</>;
}

function Chip({ c, usd }: { c: Coin; usd: number }) {
  return (
    <div className="chip">
      <Avatar src={c.honoree_avatar ?? c.image} label={c.honoree ?? c.symbol} size={34} />
      <div className="who">
        <b>{c.honoree_name ?? (c.honoree ? `@${c.honoree}` : c.name)}</b>
        <span>
          {c.name} <span className="mono">${c.symbol}</span>
        </span>
      </div>
      <div className="num">
        <b>{money(c.holding ? c.waiting_lamports : c.donated_lamports, usd)}</b>
        <span>{c.holding ? "Held" : "Paid out"}</span>
      </div>
    </div>
  );
}

function ProfileCard({ c, usd }: { c: Coin; usd: number }) {
  return (
    <Link href={`/c/${c.mint}`} className="pcard">
      <div className="art">
        <Avatar src={c.image} label={c.symbol} size={200} square />
        <span className="pump">pump.fun</span>
      </div>
      <div className="who">
        <Avatar src={c.honoree_avatar} label={c.honoree ?? "?"} size={22} />
        <b>{c.honoree_name ?? (c.honoree ? `@${c.honoree}` : "Name hidden")}</b>
        <span className="age">{ago(c.created_at)}</span>
      </div>
      <div className="coin">
        <b>{c.name}</b>
        <span>${c.symbol}</span>
      </div>
      <div className="money">
        <span>{c.mcap_lamports ? `${compact(c.mcap_lamports, usd)} MC` : "New"}</span>
        <span>
          <b>{money(c.holding ? c.waiting_lamports : c.donated_lamports, usd)}</b> {c.holding ? "held" : "paid out"}
        </span>
      </div>
    </Link>
  );
}

export default function Home() {
  const cfg = useApi<Config>("/api/config").data;
  const coins = useApi<{ sol_usd: number; coins: Coin[] }>("/api/coins?sort=given&limit=24").data;
  const newest = useApi<{ sol_usd: number; coins: Coin[] }>("/api/coins?sort=new&limit=12").data;
  const honorees = useApi<{ sol_usd: number; honorees: Honoree[] }>("/api/honorees").data;
  const nonprofits = useApi<{ sol_usd: number; nonprofits: NonprofitStats[] }>("/api/nonprofits").data;
  const stats = useApi<Stats>("/api/stats?range=all").data;
  const recent = useApi<{ sol_usd: number; donations: Donation[] }>("/api/donations?limit=6").data;
  const usd = stats?.sol_usd ?? coins?.sol_usd ?? 0;
  const list = coins?.coins ?? [];
  const chips = (newest?.coins.length ? newest.coins : list).slice(0, 12);
  const rowA = chips.filter((_, i) => i % 2 === 0);
  const rowB = chips.filter((_, i) => i % 2 === 1);
  const fmt = (n: number) => money(Math.round(n), usd);
  const series = stats?.series ?? [];
  const maxS = Math.max(1, ...series.map((p) => p.lamports));
  // Hero card: the featured coin when one is set on the server, otherwise the top coin. Waits for the
  // settings first, so the card doesn't flash one coin and then switch to another.
  const featuredMint = cfg?.featured_coin ?? null;
  const featuredRes = useApi<CoinDetail>(featuredMint ? `/api/coins/${featuredMint}` : null);
  const featuredPay = useApi<{ donations: Donation[] }>(featuredMint ? `/api/donations?mint=${featuredMint}&limit=1` : null).data;
  const featured = featuredRes.data?.coin.status === "live" ? featuredRes.data.coin : undefined;
  const autoTop = list.find((c) => c.honoree) ?? list[0];
  const top = !cfg ? undefined : featuredMint && !featuredRes.error ? featured : autoTop;
  const topDonation = !top ? undefined : top === featured ? featuredPay?.donations[0] : recent?.donations.find((d) => d.mint === top.mint);

  return (
    <>
      <section className="hero">
        <Suspense fallback={null}>
          <LoginNotice />
        </Suspense>
        <div className="wrap">
          <div>
            <span className="eyebrow">
              <span className="live" /> Live on Solana
            </span>
            <h1>
              Creator fees, <em>paid forward.</em>
            </h1>
            <p className="lead">
              Launch a coin and tag any X account: @feewardx lets them know on X. They reply with who should receive its creator fees (themselves, a creator, a project, a cause or a nonprofit), the bot tags that account to claim it, and every payout is posted with a public receipt.
            </p>
            <div className="actions">
              <Link href="/launch" className="btn btn-white">
                Launch a coin
              </Link>
              <Link href="/explore" className="btn btn-ghost">
                Find your tag
              </Link>
            </div>
          </div>
          <HeroFlow coin={top} donation={topDonation} solUsd={usd} />
        </div>
      </section>

      <section className="strip">
        <div className="wrap stats">
          <div className="stat-tile dark">
            <small>Paid out</small>
            <b>
              <CountUp to={stats?.donated_lamports ?? 0} format={fmt} />
            </b>
          </div>
          <div className="stat-tile">
            <small>Held for recipients</small>
            <b>
              <CountUp to={stats?.held_lamports ?? 0} format={fmt} />
            </b>
          </div>
          <div className="stat-tile">
            <small>Coins</small>
            <b>
              <CountUp to={stats?.coins ?? 0} format={(n) => Math.round(n).toLocaleString("en-US")} />
            </b>
          </div>
          <div className="stat-tile">
            <small>Accounts tagged</small>
            <b>
              <CountUp to={stats?.honorees ?? 0} format={(n) => Math.round(n).toLocaleString("en-US")} />
            </b>
          </div>
        </div>
      </section>

      <section className="block onx">
        <div className="wrap onx-grid">
          <div>
            <span className="eyebrow">Runs on X</span>
            <h2 className="h2">@feewardx does the telling. A reply does the choosing.</h2>
            <ol className="steps-num">
              <li>
                <span>
                  <b>Launch a coin and tag any X account</b>@feewardx tags them right away, so they know fees are waiting and that being tagged isn't an endorsement.
                </span>
              </li>
              <li>
                <span>
                  <b>They reply with one @handle, or "me"</b>That account becomes the recipient. They can also choose on the coin's page if they'd rather not reply in
                  public.
                </span>
              </li>
              <li>
                <span>
                  <b>The recipient accepts or passes it on</b>They log in with X and choose their own wallet or a nonprofit on donate.gg, or reply with another @handle to pass the
                  fees on.
                </span>
              </li>
              <li>
                <span>
                  <b>Every payout is posted</b>@feewardx tags the recipient with a receipt card linking to the public transaction.
                </span>
              </li>
            </ol>
          </div>
          <XThread />
        </div>
      </section>

      <section className="block">
        <div className="wrap">
          <div className="bento">
            <Link href="/explore" className="tile w4">
              <div className="tile-body">
                {chips.length ? (
                  <div className="marquee">
                    <div className="row">{[...rowA, ...rowA].map((c, i) => <Chip key={`a${i}`} c={c} usd={usd} />)}</div>
                    {rowB.length > 0 && <div className="row rev">{[...rowB, ...rowB].map((c, i) => <Chip key={`b${i}`} c={c} usd={usd} />)}</div>}
                  </div>
                ) : (
                  <p className="muted">No coins yet. Launch the first one.</p>
                )}
              </div>
              <div className="tile-foot">
                <b>Explore</b>
                <span>Open →</span>
              </div>
            </Link>

            <Link href="/donations" className="tile w2">
              <div className="tile-body">
                <div className="mini-rows">
                  {(recent?.donations ?? []).slice(0, 4).map((d) => (
                    <div key={d.id}>
                      <Avatar src={d.honoree_avatar ?? d.image} label={d.honoree ?? d.symbol} size={24} />
                      <span className="dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.kind === "support" ? `@${d.recipient ?? "recipient"} (support)` : d.nonprofit ?? "Nonprofit"}
                      </span>
                      <span className="amt">{money(d.lamports, recent!.sol_usd)}</span>
                    </div>
                  ))}
                  {recent && !recent.donations.length && <p className="muted small">Receipts appear here as money is sent.</p>}
                </div>
              </div>
              <div className="tile-foot">
                <b>Payouts</b>
                <span>Open →</span>
              </div>
            </Link>

            <Link href="/analytics" className="tile w2">
              <div className="tile-body">
                <div className="seg" style={{ alignSelf: "flex-start", pointerEvents: "none" }}>
                  <button aria-pressed="false">1D</button>
                  <button aria-pressed="false">30D</button>
                  <button aria-pressed="true">All time</button>
                </div>
                <div className="bars-big" aria-hidden="true">
                  {(series.length ? series.slice(-16) : [{ t: 0, lamports: 1 }]).map((p, i) => (
                    <i key={i} style={{ height: `${Math.max(4, (p.lamports / maxS) * 100)}%`, opacity: series.length ? 0.9 : 0.15 }} />
                  ))}
                </div>
              </div>
              <div className="tile-foot">
                <b>Analytics</b>
                <span>Open →</span>
              </div>
            </Link>

            <Link href="/launch" className="tile w2">
              <div className="tile-body">
                <div className="fake-label">Tag an X account</div>
                <div className="fake-field">
                  <Avatar src={null} label="elonmusk" size={22} />
                  <b>@elonmusk</b>
                </div>
                <div className="fake-label">They choose who gets the fees</div>
                <div className="chip-row">
                  {["A friend", "A project", "A cause", "Themselves", "A charity"].map((x) => (
                    <span key={x} className="mini-chip">
                      {x}
                    </span>
                  ))}
                </div>
                <div className="fake-label">Paid to</div>
                <div className="fake-field">
                  <b>Their wallet</b>
                  <span>or one of {nonprofits?.nonprofits.length ?? "the"} nonprofits</span>
                </div>
              </div>
              <div className="tile-foot">
                <b>Launch</b>
                <span>Open →</span>
              </div>
            </Link>

            <Link href="/docs" className="tile w2">
              <div className="tile-body">
                <div className="term">
                  <div className="bar">
                    <i />
                    <i />
                    <i />
                    <span>fee split, locked at launch</span>
                  </div>
                  <pre>
                    <i>share  bps   to</i>
                    {"\n"}
                    <em>{pct(cfg?.charity_bps ?? 9000).padEnd(6)}</em> {String(cfg?.charity_bps ?? 9000).padEnd(5)} <b>recipient</b> <i>(wallet or nonprofit)</i>
                    {"\n"}
                    <em>{pct(cfg?.platform_bps ?? 500).padEnd(6)}</em> {String(cfg?.platform_bps ?? 500).padEnd(5)} <b>Feeward</b>
                    {"\n"}
                    <em>{pct(cfg?.buyback_bps ?? 500).padEnd(6)}</em> {String(cfg?.buyback_bps ?? 500).padEnd(5)} <b>buyback + burn</b>
                    {"\n\n"}
                    <i>hold   {cfg?.hold_days ?? 90}d → fallback nonprofit</i>
                  </pre>
                </div>
              </div>
              <div className="tile-foot">
                <b>Docs</b>
                <span>Open →</span>
              </div>
            </Link>

            <Link href="/nonprofits" className="tile w3">
              <div className="tile-body">
                <div className="mini-rows">
                  {(nonprofits?.nonprofits ?? []).slice(0, 4).map((n) => (
                    <div key={n.config_id}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
                      <span className="amt">{money(n.received_lamports, nonprofits!.sol_usd)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="tile-foot">
                <b>Nonprofits</b>
                <span>Open →</span>
              </div>
            </Link>

            <Link href="/explore" className="tile w3" style={{ borderColor: "var(--green-line)" }}>
              <div className="tile-body" style={{ justifyContent: "center" }}>
                <div className="avatars" style={{ marginTop: 0, marginBottom: 14 }}>
                  {(honorees?.honorees ?? []).slice(0, 6).map((h) => (
                    <Avatar key={h.handle} src={h.avatar} label={h.handle} size={36} />
                  ))}
                </div>
                <h3 style={{ margin: "0 0 6px", fontSize: 22, letterSpacing: "-0.02em" }}>Were you tagged on a coin?</h3>
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                  Find it, log in with X, and choose who receives its fees: yourself, or any account you want to support.
                </p>
              </div>
              <div className="tile-foot">
                <b>Find yours</b>
                <span>Open →</span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="wrap">
          <div className="section-head">
            <h2 className="h2">Top coins</h2>
            <Link href="/explore" className="more">
              Explore all →
            </Link>
          </div>
          {coins && !list.length ? (
            <div className="coins empty">
              <p>No coins yet.</p>
              <Link href="/launch" className="btn btn-white btn-sm">
                Launch the first one
              </Link>
            </div>
          ) : (
            <div className="carousel">
              {list.slice(0, 12).map((c) => (
                <ProfileCard key={c.mint} c={c} usd={usd} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="block">
        <div className="wrap" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.25fr) minmax(0,.75fr)", gap: 24 }}>
          <div>
            <div className="section-head">
              <h2 className="h2">Recent donations</h2>
              <Link href="/donations" className="more">
                All →
              </Link>
            </div>
            <DonationFeed limit={8} more={false} />
          </div>
          <div>
            <div className="section-head">
              <h2 className="h2">Most sent</h2>
            </div>
            <ul className="pairs" style={{ gridTemplateColumns: "1fr" }}>
              {list
                .filter((c) => c.donated_lamports > 0 || c.waiting_lamports > 0)
                .slice(0, 6)
                .map((c) => (
                  <li key={c.mint}>
                    <Link href={`/c/${c.mint}`} className="duo" aria-label={`$${c.symbol}`}>
                      <Avatar src={c.image} label={c.symbol} size={34} square />
                      <Avatar src={c.honoree_avatar} label={c.honoree ?? "?"} size={34} />
                    </Link>
                    <span className="lbl">
                      <b>{c.honoree_name ?? (c.honoree ? `@${c.honoree}` : c.name)}</b>
                      <span>
                        ${c.symbol} {c.holding ? "held" : c.payout?.kind === "wallet" ? `to @${c.recipient}` : `to ${c.charity?.name ?? "a nonprofit"}`}
                      </span>
                    </span>
                    <b className="amt">{money(c.holding ? c.waiting_lamports : c.donated_lamports, usd)}</b>
                  </li>
                ))}
              {coins && !list.some((c) => c.donated_lamports > 0 || c.waiting_lamports > 0) && <p className="muted small">Nothing paid out yet.</p>}
            </ul>
            <div className="split">
              <p style={{ margin: 0, fontWeight: 600, color: "var(--strong)" }}>Every coin splits its fees the same way</p>
              {cfg && <SplitBar cfg={cfg} />}
              <p className="muted small" style={{ margin: 0 }}>
                Locked on-chain at launch. <Link href="/docs#split">How the split works</Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
