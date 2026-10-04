import Link from "next/link";
import { Wordmark } from "./Wordmark";

const cols = [
  { title: "Product", links: [["/explore", "Explore"], ["/donations", "Payouts"], ["/analytics", "Analytics"], ["/launch", "Launch"]] },
  { title: "Protocol", links: [["/nonprofits", "Nonprofits"], ["/buyback", "Buyback"], ["/docs", "Docs"], ["/launch?tab=existing", "Check a coin"], ["https://github.com/Jrfishcool12/feeflow", "Source code"]] },
  { title: "Legal", links: [["/legal/terms", "Terms"], ["/legal/privacy", "Privacy"], ["/legal/disclosures", "Disclosures"]] },
];

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div>
          <Wordmark tone="light" />
          <p>Creator fees, paid forward. The account tagged on a coin chooses who receives them, and every payout has a public receipt.</p>
        </div>
        <div className="footer-cols">
          {cols.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <b>{c.title}</b>
              {c.links.map(([href, label]) => (
                <Link key={href} href={href}>
                  {label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
        <div className="fine">
          <span>
            © {new Date().getFullYear()} Feeward. Not affiliated with X Corp., Pump.fun, donate.gg or the nonprofits listed. Being tagged on a coin or chosen as its recipient isn't an
            endorsement. Coins are speculative.
          </span>
          <span className="social">
            <a href="https://x.com/feewardx" target="_blank" rel="noopener">
              X
            </a>
            <a href="https://github.com/Jrfishcool12/feeflow" target="_blank" rel="noopener">
              GitHub
            </a>
            <Link href="/legal/disclosures#affiliation">Disclosures</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
