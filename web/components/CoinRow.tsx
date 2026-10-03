import { statusLine } from "@/lib/roles";
import Link from "next/link";
import type { Coin } from "@/lib/api";
import { money } from "@/lib/format";

export function CoinRow({ coin, solUsd }: { coin: Coin; solUsd: number }) {
  return (
    <Link className="coin-row" href={`/c/${coin.mint}`}>
      <span className="ticker">${coin.symbol}</span>
      <span className="to">
        {coin.holding
          ? statusLine(coin)
          : statusLine(coin)}
      </span>
      <span className="amt">{money(coin.holding ? coin.waiting_lamports : coin.donated_lamports, solUsd)}</span>
      <span className={`badge${coin.mode === "launch" ? " green" : ""}`}>{coin.mode === "launch" ? "Direct" : "Relayed"}</span>
    </Link>
  );
}
