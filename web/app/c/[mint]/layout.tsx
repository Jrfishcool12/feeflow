import type { Metadata } from "next";

/** Share previews: posting a coin's link on X shows its receipt card. */
export async function generateMetadata({ params }: { params: Promise<{ mint: string }> }): Promise<Metadata> {
  const { mint } = await params;
  const site = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  let image = `${site}/api/cards/${mint}.png`;
  let title = "FeeFlow";
  try {
    const r = await fetch(`${process.env.BACKEND_URL ?? "http://localhost:8787"}/api/coins/${mint}`, { next: { revalidate: 300 } });
    if (r.ok) {
      const c = (await r.json()).coin;
      // X caches a link's preview by image URL: change the URL when the card's content changes.
      image += `?v=${c.state}-${c.image ? 1 : 0}-${Math.floor((c.holding ? c.waiting_lamports : c.donated_lamports) / 1e8)}`;
      title = c.holding
        ? `$${c.symbol}: creator fees waiting for ${c.recipient ? `@${c.recipient}` : "a recipient"}`
        : `$${c.symbol}: creator fees ${c.payout?.kind === "wallet" ? `sent to @${c.recipient}` : `donated to ${c.charity?.name ?? "a nonprofit"}`}`;
    }
  } catch {
    /* backend down: generic title */
  }
  return {
    title,
    openGraph: { title, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, images: [image] },
  };
}

export default function CoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
