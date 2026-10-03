import { money } from "@/lib/format";

/** A small dependency-free bar chart for donation series. */
export function BarChart({ series, solUsd, bucket }: { series: { t: number; lamports: number }[]; solUsd: number; bucket: "hour" | "day" }) {
  if (!series.length) return <div className="chart-empty">No donations in this period yet.</div>;
  const max = Math.max(...series.map((p) => p.lamports), 1);
  const label = (t: number) => new Date(t * 1000).toLocaleString("en-US", bucket === "hour" ? { hour: "numeric" } : { month: "short", day: "numeric" });
  return (
    <div className="chart" role="img" aria-label={`Payouts over time, peak ${money(max, solUsd)}`}>
      <div className="bars">
        {series.map((p) => (
          <div key={p.t} className="bar" style={{ height: `${Math.max(3, (p.lamports / max) * 100)}%` }} title={`${label(p.t)}: ${money(p.lamports, solUsd)}`} />
        ))}
      </div>
      <div className="axis">
        <span>{label(series[0].t)}</span>
        <span>{label(series[series.length - 1].t)}</span>
      </div>
    </div>
  );
}
