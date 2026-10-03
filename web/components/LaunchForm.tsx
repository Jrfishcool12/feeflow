"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { post, type Config } from "@/lib/api";
import Link from "next/link";
import { connectWallet, signBase64 } from "@/lib/wallet";
import { sol, useBalance, useFeeFlowWallet } from "@/lib/feeflowWallet";

/** Roughly what Pump.fun charges to create a coin (accounts and fees), before any dev buy. */
const LAUNCH_COST = 20_000_000;

const readAsDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(f);
  });

/** New coin: the server builds a Pump.fun launch, the deployer's wallet signs it. */
export function LaunchForm({ cfg }: { cfg: Config | null }) {
  const router = useRouter();
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Default: the user's FeeFlow wallet (log in with X). Phantom and other extensions stay available.
  const [external, setExternal] = useState(false);
  const ffw = useFeeFlowWallet();
  const { lamports, refresh } = useBalance(external ? null : ffw.address);
  // FeeFlow wallets unavailable (Privy didn't load): fall back to wallet extensions.
  useEffect(() => {
    if (ffw.unavailable) setExternal(true);
  }, [ffw.unavailable]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!external && !ffw.authenticated) return ffw.login();
    setErr(null);
    const f = new FormData(e.currentTarget);
    try {
      setStep(external ? "Connecting wallet…" : "Preparing…");
      const own = !external && ffw.provider && ffw.address ? { provider: ffw.provider, address: ffw.address } : null;
      if (!external && !own) throw new Error("Your FeeFlow wallet is still being set up. Try again in a moment.");
      if (own && lamports !== null) {
        const need = LAUNCH_COST + Math.round(Number(f.get("dev_buy_sol") || 0) * 1e9);
        if (lamports < need) throw new Error(`Your FeeFlow wallet has ${sol(lamports)}. Launching needs about ${sol(need)} (about 0.02 SOL plus your dev buy). Add SOL on your wallet page.`);
      }
      const { provider, address } = own ?? (await connectWallet());
      const body: Record<string, unknown> = {
        deployer: address,
        name: f.get("name"),
        symbol: f.get("symbol"),
        description: f.get("description"),
        honoree: f.get("honoree"),
        twitter: f.get("twitter") || undefined,
        website: f.get("website") || undefined,
        telegram: f.get("telegram") || undefined,
        dev_buy_sol: f.get("dev_buy_sol") || 0,
      };
      const image = f.get("image");
      if (cfg?.upload) {
        if (!(image instanceof File) || !image.size) throw new Error("Add an image for the coin.");
        if (image.size > 2e6) throw new Error("Keep the image under 2 MB.");
        body.image = await readAsDataUrl(image);
      } else body.uri = f.get("uri");

      setStep("Preparing your coin…");
      const built = await post<{ mint: string; tx: string }>("/api/launch/build", body);
      setStep(own ? "Signing with your FeeFlow wallet…" : "Approve in your wallet…");
      const tx = await signBase64(provider, built.tx);
      setStep("Launching…");
      await post("/api/launch/submit", { mint: built.mint, tx });
      router.push(`/c/${built.mint}`);
    } catch (e) {
      setErr((e as Error).message || String(e));
      setStep(null);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="two">
        <label>
          Coin name
          <input name="name" required maxLength={32} />
        </label>
        <label>
          Ticker
          <input name="symbol" required maxLength={11} placeholder="$BIGJ" />
        </label>
      </div>
      <label>
        Description <span className="hint">We add a line saying who it's for and that they haven't endorsed it.</span>
        <textarea name="description" rows={3} maxLength={400} />
      </label>
      {cfg?.upload ? (
        <label>
          Image
          <input name="image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required />
        </label>
      ) : (
        <label>
          Metadata URI <span className="hint">A Pump.fun-style metadata JSON link (IPFS or HTTPS)</span>
          <input name="uri" type="url" required />
        </label>
      )}
      <div className="three">
        <label>
          Coin's X page <span className="hint">Optional</span>
          <input name="twitter" placeholder="Default: our post about your coin" autoComplete="off" />
        </label>
        <label>
          Website <span className="hint">Optional</span>
          <input name="website" placeholder="yourcoin.com" autoComplete="off" />
        </label>
        <label>
          Telegram <span className="hint">Optional</span>
          <input name="telegram" placeholder="t.me/yourcoin" autoComplete="off" />
        </label>
      </div>
      <label>
        X account to tag <span className="hint">Any X account. They choose who receives the coin's creator fees: themselves or any account they want to support. Tagging them isn't an endorsement.</span>
        <input name="honoree" required placeholder="@elonmusk" />
      </label>
      <p className="muted small" style={{ margin: 0 }}>
        Fees are held until a recipient is chosen and sets a payout destination.
        {cfg?.hold_days ? ` If that hasn't happened within ${cfg.hold_days} days, or the recipient declines, they go to ${cfg.fallback?.name ?? "the fallback nonprofit"}.` : ""}
      </p>
      <label>
        Dev buy <span className="hint">Optional, in SOL</span>
        <input name="dev_buy_sol" type="number" min={0} max={50} step={0.01} defaultValue={0} />
      </label>
      <div>
        {!external && ffw.authenticated && ffw.address && (
          <p className="muted small" style={{ margin: "0 0 12px" }}>
            Launching from your FeeFlow wallet <span className="mono">{ffw.address.slice(0, 4)}…{ffw.address.slice(-4)}</span>, which holds {sol(lamports)}. Launching costs about 0.02
            SOL plus any dev buy. <Link href="/wallet">Add SOL</Link>{" "}
            <button type="button" className="btn-link" onClick={refresh}>
              Refresh
            </button>
          </p>
        )}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-green" type="submit" disabled={!!step || (!external && !ffw.ready)}>
            {step ?? (external ? "Connect wallet and launch" : ffw.authenticated ? "Launch" : "Log in with X to launch")}
          </button>
          <button type="button" className="btn-link" onClick={() => (setExternal(!external), setErr(null))}>
            {external ? "Use my FeeFlow wallet instead" : "Use Phantom or another wallet instead"}
          </button>
        </div>
        {!external && !ffw.authenticated && (
          <p className="muted small" style={{ marginTop: 10 }}>
            No wallet extension needed: logging in with X creates a FeeFlow wallet that only you can use.
          </p>
        )}
        {err && <p className="err" role="status">{err}</p>}
      </div>
    </form>
  );
}
