"use client";
import Link from "next/link";
import type { Coin, Donation } from "@/lib/api";
import { day, money, short } from "@/lib/format";
import { STATE_SHORT, shortAddr } from "@/lib/roles";
import { Avatar } from "./Avatar";

type Props = { coin?: Coin; donation?: Donation; solUsd: number };

const X = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);
const HEART = <path d="M12 20s-7-4.4-9-9.2C1.6 7.4 4 4 7.3 4c2 0 3.3 1.1 4.7 2.8C13.4 5.1 14.7 4 16.7 4 20 4 22.4 7.4 21 10.8 19 15.6 12 20 12 20z" />;
const WALLET = <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2h.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-14A2.5 2.5 0 0 1 3 16.5v-9Zm13.5 6.75a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" />;

/** The product in one picture: coin → creator fees → the recipient the chooser picked → their wallet or a nonprofit → receipt. */
export function HeroFlow({ coin, donation, solUsd }: Props) {
  // Live data when there is some; a worked example otherwise.
  const ex = !coin;
  const symbol = coin?.symbol ?? "COIN";
  const chooser = coin?.honoree ?? (ex ? "anyone" : null);
  const recipient = coin?.recipient ?? (ex ? "theirpick" : null);
  const wallet = coin?.payout?.kind === "wallet";
  const nonprofit = donation?.nonprofit ?? coin?.charity?.name ?? (ex ? "a nonprofit" : null);
  const paid = !!donation || (coin ? !coin.holding : true);
  const amount = donation ? money(donation.lamports, solUsd) : coin ? money(coin.holding ? coin.waiting_lamports : coin.donated_lamports, solUsd) : "$4,120.00";
  const when = donation ? day(donation.created_at) : coin ? day(coin.created_at) : "Example";
  const href = coin ? `/c/${coin.mint}` : "/launch";
  const destName = coin?.state === "awaiting_selection" || coin?.state === "awaiting_routing" ? "Not set yet" : wallet ? "Their wallet" : nonprofit ?? "A nonprofit";
  const destSub = coin?.state === "awaiting_selection" || coin?.state === "awaiting_routing" ? "wallet or nonprofit" : wallet ? (coin?.payout?.wallet ? shortAddr(coin.payout.wallet) : "support") : coin?.state === "fallback" || coin?.state === "declined" ? "fallback" : "via donate.gg";

  return (
    <Link href={href} className="flow" aria-label={`${amount} from $${symbol} creator fees`}>
      <div className="flow-head">
        <span className="flow-dot" /> {ex ? "How it works" : coin ? STATE_SHORT[coin.state] : "Live"}
        <span className="flow-tag mono">${symbol}</span>
      </div>

      <div className="flow-row">
        <div className="flow-node">
          <div className="flow-ring">
            <Avatar src={coin?.image} label={symbol} size={60} square />
            <span className="flow-badge mono">pump</span>
          </div>
          <b>${symbol}</b>
          <span>{chooser ? `tags @${chooser}` : "tags someone"}</span>
        </div>

        <div className="flow-link" aria-hidden="true">
          <span className="flow-label mono">creator fees</span>
          <span className="flow-line">
            <i />
            <i />
            <i />
          </span>
        </div>

        <div className="flow-node">
          <div className="flow-ring person">
            <Avatar src={coin?.recipient_avatar ?? null} label={recipient ?? "?"} size={60} />
            <span className="flow-x" aria-hidden="true">{X}</span>
          </div>
          <b className="clip">{recipient ? `@${recipient}` : "Recipient"}</b>
          <span>{recipient ? (coin?.recipient_is_chooser ? "chose themselves" : `chosen by @${chooser ?? "the chooser"}`) : `@${chooser ?? "the chooser"} chooses`}</span>
        </div>

        <div className="flow-link" aria-hidden="true">
          <span className="flow-label mono">{wallet ? "support" : "routes to"}</span>
          <span className="flow-line slow">
            <i />
            <i />
            <i />
          </span>
        </div>

        <div className="flow-node">
          <div className="flow-ring np">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              {wallet ? WALLET : HEART}
            </svg>
          </div>
          <b className="clip">{destName}</b>
          <span>{destSub}</span>
        </div>
      </div>

      <div className="receipt">
        <div className="receipt-top mono">
          <span>RECEIPT</span>
          <span>{when}</span>
        </div>
        <div className="receipt-amt mono">{amount}</div>
        <div className="receipt-what">
          {!paid ? (
            <>held for {recipient ? <b>@{recipient}</b> : "a recipient"}</>
          ) : wallet ? (
            <>
              sent to <b>@{recipient}</b> as support
            </>
          ) : (
            <>
              donated to <b>{nonprofit}</b>
              {recipient ? (
                <>
                  , chosen by <b>@{recipient}</b>
                </>
              ) : null}
            </>
          )}
        </div>
        <dl className="receipt-rows mono">
          <dt>from</dt>
          <dd>${symbol} creator fees</dd>
          <dt>split</dt>
          <dd>90% recipient · 5% Feeward · 5% buyback</dd>
          <dt>tx</dt>
          <dd>{donation?.signature ? short(donation.signature) : paid ? (ex ? "public on Solscan" : "on Solscan") : "pending"}</dd>
        </dl>
      </div>
    </Link>
  );
}
