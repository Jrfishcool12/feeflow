"use client";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useApi, type Config } from "@/lib/api";
import { pct } from "@/lib/format";
import { LaunchForm } from "@/components/LaunchForm";
import { RelayGuide } from "@/components/RelayGuide";

function Launch() {
  const cfg = useApi<Config>("/api/config").data;
  const params = useSearchParams();
  const tab = params.get("tab") === "existing" ? "existing" : "new";
  const router = useRouter();
  const path = usePathname();
  const split = cfg ? `${pct(cfg.charity_bps)} to the recipient, ${pct(cfg.platform_bps)} to Feeward and ${pct(cfg.buyback_bps)} to buying back the Feeward coin` : "";

  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <div className="page-head">
        <h1>Launch a coin for anyone on X</h1>
        <p className="sub">Tag any X account. They choose who receives your coin's creator fees, and @feewardx tags them along the way{split ? `. The creator-fee split: ${split}` : ""}. You don't earn creator fees from it.</p>
      </div>
      <div className="seg" role="tablist" aria-label="Coin type" style={{ marginBottom: 28 }}>
        <button role="tab" aria-selected={tab === "new"} onClick={() => router.replace(path)}>
          Launch a new coin
        </button>
        <button role="tab" aria-selected={tab === "existing"} onClick={() => router.replace(`${path}?tab=existing`)}>
          Use a coin I already launched
        </button>
      </div>
      {tab === "existing" ? (
        <RelayGuide initialMint={params.get("mint") ?? ""} />
      ) : (
        <>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            The split is set on-chain at launch and Pump.fun locks it. The recipient share is held until the account you tag chooses a recipient and the recipient chooses their wallet or a nonprofit; then it's sent there in public transactions.{cfg?.router ? " The split is enforced by the Feeward router program on Solana." : ""}
          </p>
          <LaunchForm cfg={cfg} />
        </>
      )}
    </div>
  );
}

export default function LaunchPage() {
  return (
    <Suspense fallback={null}>
      <Launch />
    </Suspense>
  );
}
