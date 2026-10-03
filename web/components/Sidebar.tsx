"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "./Wordmark";
import { useApi, type Config } from "@/lib/api";

const P: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  explore: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  donations: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />,
  nonprofits: <path d="M12 20s-7-4.4-9-9.2C1.6 7.4 4 4 7.3 4c2 0 3.3 1.1 4.7 2.8C13.4 5.1 14.7 4 16.7 4 20 4 22.4 7.4 21 10.8 19 15.6 12 20 12 20z" />,
  analytics: <path d="M5 20v-8M12 20V4M19 20v-5" />,
  buyback: <path d="M12 21c4 0 7-2.7 7-6.6 0-3.1-2-5.4-3.6-7 .1 2.3-1.1 3.6-2.4 3.6C13 8 13.6 5.2 11 3c.4 3-2.7 5-4.3 7.5C5.6 12.2 5 13.5 5 14.6 5 18.3 8 21 12 21z" />,
  docs: <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />,
  launch: <path d="M12 5v14M5 12h14" />,
  collapse: <path d="M15 6l-6 6 6 6" />,
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

function Icon({ name }: { name: string }) {
  if (name === "x")
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/explore", label: "Explore", icon: "explore" },
  { href: "/donations", label: "Payouts", icon: "donations" },
  { href: "/nonprofits", label: "Nonprofits", icon: "nonprofits" },
  { href: "/analytics", label: "Analytics", icon: "analytics" },
  { href: "/buyback", label: "Buyback", icon: "buyback" },
  { href: "/docs", label: "Docs", icon: "docs" },
];

/** Collapsible left sidebar (icons only when collapsed); a drawer on phones. */
export function Sidebar() {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const cfg = useApi<Config>("/api/config").data;
  const [copied, setCopied] = useState(false);
  const ca = cfg?.platform_coin ?? null;
  const ticker = cfg?.platform_coin_symbol ? `$${cfg.platform_coin_symbol}` : "FeeFlow coin";
  const copyCa = () => ca && navigator.clipboard.writeText(ca).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)));
  const [open, setOpen] = useState(false);

  useEffect(() => setCollapsed(document.documentElement.dataset.sb === "collapsed"), []);
  useEffect(() => setOpen(false), [path]);
  // Ctrl+B / Cmd+B collapses and expands the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function toggle() {
    const next = document.documentElement.dataset.sb !== "collapsed";
    setCollapsed(next);
    if (next) document.documentElement.dataset.sb = "collapsed";
    else delete document.documentElement.dataset.sb;
    try {
      localStorage.setItem("gc-sb", next ? "collapsed" : "open");
    } catch {
      /* private mode */
    }
  }

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <>
      <div className="mbar">
        <button className="sb-icon-btn" onClick={() => setOpen(true)} aria-label="Open menu">
          <Icon name="menu" />
        </button>
        <Link href="/" className="mbar-brand" aria-label="FeeFlow home">
          <Wordmark />
        </Link>
        <Link href="/launch" className="btn btn-sm btn-white">
          Launch
        </Link>
      </div>
      {open && <div className="sb-scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar${open ? " open" : ""}`} aria-label="Main">
        <div className="sb-top">
          <Link href="/" className="sb-brand" aria-label="FeeFlow home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="ic" width={28} height={28} />
            <span className="wm">
              <Wordmark />
            </span>
          </Link>
          <button className="sb-collapse" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl+B)`}>
            <Icon name="panel" />
          </button>
        </div>
        <nav>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="sb-link" aria-current={active(n.href) ? "page" : undefined} title={collapsed ? n.label : undefined}>
              <Icon name={n.icon} />
              <span className="sb-label">{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="spacer" />
        {ca && (
          <div className="sb-ca">
            <button className="sb-link sb-ca-btn" onClick={copyCa} title={collapsed ? `Copy official ${ticker} address` : `Copy ${ca}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M14.5 9.5c-.6-.9-1.5-1.3-2.6-1.3-1.5 0-2.6.8-2.6 1.9 0 2.6 5.6 1.3 5.6 4 0 1.2-1.2 2-2.8 2-1.2 0-2.2-.5-2.8-1.4M12 6.5v1.7M12 15.8v1.7" />
              </svg>
              <span className="sb-label">
                <small>Official {ticker}</small>
                <span className="mono">{copied ? "Copied" : `${ca.slice(0, 4)}…${ca.slice(-4)}`}</span>
              </span>
            </button>
            <a className="sb-label sb-ca-trade" href={`https://pump.fun/coin/${ca}`} target="_blank" rel="noopener">
              Trade
            </a>
          </div>
        )}
        <Link href="/launch" className="sb-link sb-launch" aria-current={active("/launch") ? "page" : undefined} title={collapsed ? "Launch a coin" : undefined}>
          <Icon name="launch" />
          <span className="sb-label">Launch a coin</span>
        </Link>
        <a href="https://x.com/FeeFlowApp" target="_blank" rel="noopener" className="sb-link" title={collapsed ? "@FeeFlowApp on X" : undefined}>
          <Icon name="x" />
          <span className="sb-label mono">@FeeFlowApp</span>
        </a>
      </aside>
    </>
  );
}
