import type { Config } from "@/lib/api";
import { pct } from "@/lib/format";

/** The creator-fee split as a bar and a legend. Every coin uses the same split. */
export function SplitBar({ cfg }: { cfg: Pick<Config, "charity_bps" | "platform_bps" | "buyback_bps"> }) {
  const parts = [
    { key: "charity", bps: cfg.charity_bps, label: "to the recipient's wallet or nonprofit", color: "var(--green)" },
    { key: "platform", bps: cfg.platform_bps, label: "to FeeFlow", color: "var(--split-platform)" },
    { key: "buyback", bps: cfg.buyback_bps, label: "FeeFlow coin buyback and burn", color: "var(--split-buyback)" },
  ].filter((p) => p.bps > 0);
  return (
    <>
      <div className="split-bar" role="img" aria-label={parts.map((p) => `${pct(p.bps)} ${p.label}`).join(", ")}>
        {parts.map((p) => (
          <i key={p.key} className={`s-${p.key}`} style={{ flexGrow: p.bps }} />
        ))}
      </div>
      <div className="split-legend">
        {parts.map((p) => (
          <span key={p.key}>
            <i style={{ background: p.color }} />
            <b className="tabular">{pct(p.bps)}</b> {p.label}
          </span>
        ))}
      </div>
    </>
  );
}
