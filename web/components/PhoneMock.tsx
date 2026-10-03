import { statusLine } from "@/lib/roles";
import type { Coin } from "@/lib/api";
import { money } from "@/lib/format";
import { Wordmark } from "./Wordmark";

const SAMPLE_BARS = [22, 30, 26, 41, 38, 52, 49, 66, 61, 78, 92];

/** The hero phone: the coin that has given the most, or an example while the wall is empty. */
export function PhoneMock({ coin, solUsd }: { coin?: Coin; solUsd: number }) {
  const symbol = coin?.symbol ?? "BIGJ";
  const honoree = coin?.honoree ?? "elonmusk";
  const nonprofit = coin?.charity?.name ?? "Best Friends Animal Society";
  const total = coin ? money(coin.holding ? coin.waiting_lamports : coin.donated_lamports, solUsd) : "$38,900";
  return (
    <div className="phone-stage" aria-hidden="true">
      <div className="phone">
        <div className="screen">
          <div className="top">
            <Wordmark />
            <span style={{ fontSize: 12, color: "var(--muted-dark)" }}>{coin ? "Live" : "Example"}</span>
          </div>
          <div className="coinhead">
            <div className="avatar">{honoree[0]}</div>
            <div>
              <b>${symbol}</b>
              <span>Tags @{honoree}</span>
            </div>
          </div>
          <div className="given">
            <p>
              {coin ? `${coin.holding ? "Held" : "Paid out"}: ${statusLine(coin)}.` : `Donated to ${nonprofit}, chosen by @${honoree}.`}
            </p>
            <strong>{total}</strong>
            <small>{coin?.holding ? "held" : "paid out so far"}</small>
          </div>
          <div className="bars">
            {SAMPLE_BARS.map((h, i) => (
              <i key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="toast">
            <span className="dot" />
            <span>Every trade gives a little more</span>
          </div>
        </div>
      </div>
    </div>
  );
}
