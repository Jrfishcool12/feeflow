import { NextResponse } from "next/server";

/**
 * A coin's X link (set in its metadata at launch): @FeeFlowApp's post about the coin. The post is made a
 * few seconds after launch, so until it exists this goes to @FeeFlowApp.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  let tweet: string | null = null;
  try {
    const r = await fetch(`${process.env.BACKEND_URL ?? "http://localhost:8787"}/api/coins/${encodeURIComponent(mint)}/post`, { cache: "no-store" });
    if (r.ok) tweet = ((await r.json()) as { tweet: string | null }).tweet;
  } catch {
    /* backend down: fall back to the profile */
  }
  return NextResponse.redirect(tweet ? `https://x.com/FeeFlowApp/status/${tweet}` : "https://x.com/FeeFlowApp", 302);
}
