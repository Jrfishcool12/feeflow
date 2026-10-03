const LAMPORTS = 1e9;

/** Dollars when we have a SOL price, otherwise SOL. */
export function money(lamports: number, solUsd: number) {
  if (solUsd) return "$" + Math.round((lamports / LAMPORTS) * solUsd).toLocaleString("en-US");
  const sol = lamports / LAMPORTS;
  return sol.toLocaleString("en-US", { minimumFractionDigits: sol >= 100 ? 1 : 2, maximumFractionDigits: sol >= 100 ? 1 : 2 }) + " SOL";
}

export const pct = (bps: number) => (bps / 100).toFixed(bps % 100 ? 1 : 0) + "%";
export const short = (a?: string | null) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
export const day = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}`;
export const solscanAccount = (a: string) => `https://solscan.io/account/${a}`;
export const pumpCoin = (mint: string) => `https://pump.fun/coin/${mint}`;

/** Compact dollars for market caps: $412K, $1.2M. Falls back to SOL without a price. */
export function compact(lamports: number, solUsd: number) {
  const v = solUsd ? (lamports / LAMPORTS) * solUsd : lamports / LAMPORTS;
  const unit = solUsd ? "$" : "";
  const tail = solUsd ? "" : " SOL";
  if (v >= 1e9) return `${unit}${(v / 1e9).toFixed(1)}B${tail}`;
  if (v >= 1e6) return `${unit}${(v / 1e6).toFixed(1)}M${tail}`;
  if (v >= 1e3) return `${unit}${(v / 1e3).toFixed(1)}K${tail}`;
  return `${unit}${v.toFixed(v >= 10 ? 0 : 2)}${tail}`;
}

/** "3m", "2h", "5d" ago. */
export function ago(ts: number) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const xProfile = (handle: string) => `https://x.com/${handle}`;
export const shareOnX = (text: string, url: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
