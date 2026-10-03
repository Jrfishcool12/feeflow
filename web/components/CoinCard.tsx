import { statusLine } from "@/lib/roles";
import Link from "next/link";
import type { Coin } from "@/lib/api";
import { compact, money } from "@/lib/format";
import { Avatar } from "./Avatar";

/** Explore-grid card: token art, ticker, who it's for, market cap and amount waiting or sent. */
export function CoinCard({ coin, solUsd }: { coin: Coin; solUsd: number }) {
  return (
    <Link href={`/c/${coin.mint}`} className="coin-card">
      <div className="art">
        <Avatar src={coin.image} label={coin.symbol} size={64} square />
        <span className={`badge${coin.mode === "launch" ? " green" : ""}`}>{coin.mode === "launch" ? "Direct" : "Relayed"}</span>
      </div>
      <div className="name">
        <b>{coin.name}</b>
        <span>${coin.symbol}</span>
      </div>
      <div className="for">
        {coin.honoree ? (
          <>
            <Avatar src={coin.honoree_avatar} label={coin.honoree} size={22} />
            <span>tags @{coin.honoree}</span>
          </>
        ) : (
          <span>name hidden by request</span>
        )}
      </div>
      <div className="nums">
        {coin.holding ? (
          <div>
            <small>Held</small>
            <b>{money(coin.waiting_lamports, solUsd)}</b>
          </div>
        ) : (
          <div>
            <small>Paid out</small>
            <b>{money(coin.donated_lamports, solUsd)}</b>
          </div>
        )}
        <div>
          <small>Market cap</small>
          <b>{coin.mcap_lamports ? compact(coin.mcap_lamports, solUsd) : "—"}</b>
        </div>
      </div>
      <div className="to">{statusLine(coin)}</div>
    </Link>
  );
}
