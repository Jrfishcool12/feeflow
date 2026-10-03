"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { post, type Config } from "@/lib/api";
import { connectWallet, signBase64 } from "@/lib/wallet";

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

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const f = new FormData(e.currentTarget);
    try {
      setStep("Connecting wallet…");
      const { provider, address } = await connectWallet();
      const body: Record<string, unknown> = {
        deployer: address,
        name: f.get("name"),
        symbol: f.get("symbol"),
        description: f.get("description"),
        honoree: f.get("honoree"),
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
      setStep("Approve in your wallet…");
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
        <button className="btn btn-green" type="submit" disabled={!!step}>
          {step ?? "Connect wallet and launch"}
        </button>
        {err && <p className="err" role="status">{err}</p>}
      </div>
    </form>
  );
}
