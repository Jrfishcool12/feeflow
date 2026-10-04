import type { CoinDetail, Config } from "@/lib/api";
import { day, money, pct, short, solscanAccount, solscanTx } from "@/lib/format";
import { shortAddr } from "@/lib/roles";
import { SplitBar } from "./SplitBar";

const ROLE: Record<string, string> = {
  charity: "Nonprofit donation escrow",
  held: "Recipient share, through the Feeward treasury",
  platform: "Feeward",
  buyback: "Feeward coin buyback",
  unknown: "Unknown address",
};

const EVENT: Record<string, string> = {
  recipient_locked: "Recipient selected",
  recipient_redirected: "Passed on",
  payout_set: "Payout destination set",
  payout_changed: "Payout destination changed",
  recipient_declined: "Recipient declined",
  fallback: "Fallback activated",
};

/** The public receipt: the split, the on-chain check, completed payouts and the record of every role change. */
export function WhereFeesGo({ d, cfg }: { d: CoinDetail; cfg: Config | null }) {
  const c = d.coin;
  const a = d.audit;
  const usd = d.sol_usd;
  const check = !a ? null : a.unchecked ? (
    <p className="muted small">Couldn't reach the chain to check just now. Reload in a minute.</p>
  ) : a.ok ? (
    <p className="ok">
      {c.mode === "relay" ? "Checked on-chain: 100% of this coin's creator fees go to the Feeward treasury, locked." : "Checked on-chain: the split matches."}
    </p>
  ) : (
    <p className="err">Doesn't match: {a.problems.join("; ")}</p>
  );

  return (
    <section className="panel">
      <h2>Where the fees go</h2>
      {cfg && <SplitBar cfg={cfg} />}
      <p className="muted small" style={{ marginTop: 12 }}>
        These percentages are of the coin's <b>creator fees</b>, the small fee Pump.fun pays the coin's creator on each trade. They aren't a share of trading volume or of
        what anyone spends buying the coin.
        {cfg ? ` The ${pct(cfg.charity_bps)} recipient share is before any donate.gg processing fee, so a nonprofit receives a little less than that.` : ""}
      </p>
      <div style={{ marginTop: 12 }}>{check}</div>
      {c.accrued_lamports ? (
        <p className="muted small">
          Earned on Pump.fun, not yet collected: <b>{money(c.accrued_lamports, usd)}</b>.
          {c.accrue_min_lamports && c.accrued_lamports < c.accrue_min_lamports
            ? ` Pump.fun releases a coin's creator fees once they reach ${money(c.accrue_min_lamports, usd)}; Feeward collects them automatically after that.`
            : " Feeward collects these automatically within a few minutes."}
        </p>
      ) : null}
      {c.pending_lamports ? (
        <p className="muted small">
          Collected and waiting to be paid out: <b>{money(c.pending_lamports, usd)}</b>. Payouts go out once at least 0.005 SOL has been collected.
        </p>
      ) : null}

      {c.mode === "launch" ? (
        <ul className="shares">
          {(a?.shareholders ?? []).map((s) => (
            <li key={s.address}>
              <b>{pct(s.shareBps)}</b>
              <span>
                {ROLE[s.role]} <a href={solscanAccount(s.address)} target="_blank" rel="noopener">{short(s.address)}</a>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">
          This coin was launched elsewhere, so its fees are relayed: Pump.fun sends them to the Feeward treasury{" "}
          <a href={solscanAccount(c.vault!)} target="_blank" rel="noopener">
            {short(c.vault)}
          </a>
          , and Feeward attributes each payout to this coin from the transaction itself.
        </p>
      )}
      <p className="muted small">
        The recipient share waits in the Feeward treasury, recorded against this coin, until the recipient sets a payout destination. Then it's sent there in public
        transactions: to their verified wallet (support), or to a nonprofit's donate.gg escrow (a donation).{" "}
        {c.mode === "launch" ? "Pump.fun locked this split when the coin launched, so nobody can change it." : ""}
      </p>

      <h2 style={{ fontSize: 17, marginTop: 22 }}>Payouts</h2>
      {d.forwards.length > 0 ? (
        <div className="scroll">
          <table className="history">
            <tbody>
              {d.forwards.map((f) => (
                <tr key={f.signature}>
                  <td>{day(f.created_at)}</td>
                  <td>
                    {f.kind === "support" ? (
                      <>
                        {money(f.lamports, usd)} support to {c.recipient ? `@${c.recipient}` : "the recipient"}'s wallet {f.wallet ? shortAddr(f.wallet) : ""}
                      </>
                    ) : (
                      <>
                        {money(f.lamports, usd)} donated to {f.charity}
                      </>
                    )}
                    <span className="muted">
                      {" "}
                      + {money(f.platform_lamports, usd)} Feeward, {money(f.buyback_lamports, usd)} buyback
                    </span>
                  </td>
                  <td>
                    <a href={solscanTx(f.signature)} target="_blank" rel="noopener">
                      receipt
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">No payouts yet. Each payout appears here with its public transaction.</p>
      )}

      {d.events.length > 0 && (
        <>
          <h2 style={{ fontSize: 17, marginTop: 22 }}>Record</h2>
          <div className="scroll">
            <table className="history">
              <tbody>
                {d.events.map((e, i) => (
                  <tr key={i}>
                    <td>{day(e.created_at)}</td>
                    <td>
                      {EVENT[e.kind] ?? e.kind}
                      {e.actor_handle ? <span className="muted"> by @{e.actor_handle}</span> : null}
                      {e.detail ? <span className="muted">: {e.detail}</span> : null}
                    </td>
                    <td>
                      {e.tweet_id ? (
                        <a href={`https://x.com/i/web/status/${e.tweet_id}`} target="_blank" rel="noopener">
                          X reply
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
