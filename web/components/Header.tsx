"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./Wordmark";

const links = [
  { href: "/explore", label: "Explore" },
  { href: "/donations", label: "Payouts" },
  { href: "/nonprofits", label: "Nonprofits" },
  { href: "/analytics", label: "Analytics" },
  { href: "/docs", label: "Docs" },
];

export function Header() {
  const path = usePathname();
  return (
    <header className="site-header">
      <div className="wrap">
        <Link href="/" className="brand" aria-label="FeeFlow home">
          <Wordmark />
        </Link>
        <nav aria-label="Main">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={path.startsWith(l.href) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <a className="xlink" href="https://x.com/FeeFlowApp" target="_blank" rel="noopener">
          @FeeFlowApp
        </a>
        <Link href="/launch" className="btn btn-sm btn-white">
          Launch
        </Link>
      </div>
    </header>
  );
}
