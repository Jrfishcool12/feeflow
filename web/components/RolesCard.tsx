import Link from "next/link";
import type { CoinDetail } from "@/lib/api";
import { money, solscanAccount } from "@/lib/format";
import { STATE_LABEL, actionNeeded, dateLong, destination } from "@/lib/roles";
import { Avatar } from "./Avatar";

/** The public facts about a coin's roles: who chose, who receives, where funds go, and what happens if nobody acts. */
export function RolesCard({ d }: { d: CoinDetail }) {
  const c = d.coin;
  const action = actionNeeded(c);
  const fallbackName = c.fallback?.name ?? "the fallback nonprofit";
  const via = c.recipient_selected_via === "x_reply" ? "by replying on X" : c.recipient_selected_via === "migrated" ? "before roles were split" : "on FeeFlow";
  return (
    <section className="panel roles">
      <h2>Who's who</h2>
      <dl>
        <dt>Chooser</dt>
        <dd>
          {c.honoree ? (
            <Link href={`/u/${c.honoree}`} className="who">
              <Avatar src={c.honoree_avatar} label={c.honoree} size={28} />
              <span>@{c.honoree}</span>
            </Link>
          ) : (
            <span className="muted">Name hidden at their request</span>
          )}
          <small>Tagged on this coin. Chooses the recipient, once.</small>
        </dd>

        <dt>Recipient</dt>
        <dd>
          {c.recipient ? (
            <>
              <span className="who">
                <Avatar src={c.recipient_avatar} label={c.recipient} size={28} />
                <span>@{c.recipient}</span>
                {c.recipient_is_chooser && <span className="badge">same as chooser</span>}
              </span>
              <small>
                Selected{c.recipient_selected_at ? ` on ${dateLong(c.recipient_selected_at)}` : ""} {via}.
                {c.state === "awaiting_routing" ? " They can accept or pass it on to another account." : ""}
                {c.selection_tweet ? (
                  <>
                    {" "}
                    <a href={`https://x.com/i/web/status/${c.selection_tweet}`} target="_blank" rel="noopener">
                      See the reply
                    </a>
                    . Deleting that reply doesn't undo the choice or reverse payouts.
                  </>
                ) : null}
              </small>
            </>
          ) : (
            <span className="muted">Not chosen yet</span>
          )}
        </dd>

        <dt>Payout destination</dt>
        <dd>
          {c.payout?.kind === "wallet" && c.payout.wallet ? (
            <a href={solscanAccount(c.payout.wallet)} target="_blank" rel="noopener" className="mono">
              {destination(c)}
            </a>
          ) : (
            <span className={c.state === "active" || c.state === "fallback" || c.state === "declined" ? "" : "muted"}>{destination(c)}</span>
          )}
          <small>
            {c.payout?.kind === "wallet"
              ? "Wallet ownership was proven with a signature. Payments are support, not donations. Permanent."
              : c.payout?.kind === "nonprofit"
                ? "Delivered by donate.gg, which charges a processing fee. Permanent."
                : "The recipient's own wallet or a nonprofit on donate.gg, chosen once by the recipient."}
          </small>
        </dd>

        <dt>Status</dt>
        <dd>
          <span className={`badge${c.state === "active" ? " green" : ""}`}>{STATE_LABEL[c.state]}</span>
          {c.holding && c.waiting_lamports > 0 ? <small>{money(c.waiting_lamports, d.sol_usd)} held in the FeeFlow treasury for this coin.</small> : null}
          {action ? <small>Waiting on: {action}.</small> : null}
        </dd>

        <dt>Fallback</dt>
        <dd>
          <span>{fallbackName}</span>
          <small>
            {c.state === "declined"
              ? `Active since ${c.fallback_at ? dateLong(c.fallback_at) : "the recipient declined"}: the recipient declined, so funds go here.`
              : c.state === "fallback"
                ? `Active since ${c.fallback_at ? dateLong(c.fallback_at) : "the deadline"}: no payout destination was set in time.`
                : c.state === "active"
                  ? "Not needed: the recipient set a destination."
                  : `Gets the funds if the recipient declines${c.release_at ? `, or if no payout destination is set by ${dateLong(c.release_at)}` : ""}.`}
          </small>
        </dd>
      </dl>
      <p className="muted small" style={{ marginTop: 14 }}>
        Being tagged on a coin or chosen as its recipient doesn't mean an account endorsed the coin. FeeFlow confirms who controls each X account by X login; it doesn't
        verify nonprofit status. Labels like "cause" or "foundation" don't mean a registered nonprofit.
      </p>
    </section>
  );
}
