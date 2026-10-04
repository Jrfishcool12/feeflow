"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, post, useApi, type CheckResult, type Nonprofit } from "@/lib/api";
import { Avatar } from "./Avatar";

type Info = { enabled: boolean; treasury: string | null; line: string };
type XPreview = { found: boolean; handle: string; name: string | null; avatar: string | null };

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="copy-row">
      <span>{text}</span>
      <button type="button" className="btn btn-dark btn-sm" onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true))}>
        {done ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

/** For coins launched elsewhere: build the description line, show the treasury, and check a coin. */
export function RelayGuide({ initialMint = "" }: { initialMint?: string }) {
  const info = useApi<Info>("/api/relay/info").data;
  const [handle, setHandle] = useState("");
  const [person, setPerson] = useState<XPreview | null>(null);
  const [mint, setMint] = useState(initialMint);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const h = handle.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) return setPerson(null);
    const t = setTimeout(() => api<XPreview>(`/api/x/lookup?handle=${h}`).then(setPerson, () => setPerson(null)), 350);
    return () => clearTimeout(t);
  }, [handle]);

  async function runCheck(e?: React.FormEvent) {
    e?.preventDefault();
    setErr(null);
    setCheck(null);
    setChecking(true);
    try {
      setCheck(await post<CheckResult>("/api/check", { mint: mint.trim() }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    if (initialMint) runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (info && !info.enabled) return <p className="notice">Coins launched elsewhere aren't supported on this server yet. Launch a new coin instead.</p>;

  const h = handle.trim().replace(/^@/, "") || "handle";
  const line = `Fees to @${h} via Feeward`;

  return (
    <div className="guide">
      <section className="panel">
        <h2>Set up a coin you launched on Pump.fun</h2>
        <p className="muted">No sign-up. Do these three things and the coin registers on its own within a few minutes.</p>
        <ol className="steps-num">
          <li>
            <span>
              <b>Send 100% of creator fees to the Feeward treasury</b>
              On the coin's Pump.fun page, open fee sharing and add this address at 100%, with no other recipients.
            </span>
          </li>
        </ol>
        {info?.treasury ? <Copy text={info.treasury} /> : <p className="muted">Loading…</p>}
        <ol className="steps-num" style={{ counterReset: "s 1", marginTop: 14 }}>
          <li>
            <span>
              <b>Lock fee sharing</b>Revoke its authority on Pump.fun so the fees can't be redirected later.
            </span>
          </li>
          <li>
            <span>
              <b>Tag the account in the description</b>Add this line anywhere in the coin's description. That account chooses who receives the fees.
            </span>
          </li>
        </ol>
        <div className="form" style={{ marginTop: 12 }}>
          <label>
            Account to tag
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" />
          </label>
          {person && (
            <div className="preview-person">
              <Avatar src={person.avatar} label={person.handle} size={44} />
              <div>
                {person.found ? (
                  <>
                    <b>{person.name ?? `@${person.handle}`}</b>
                    <div className="muted small">@{person.handle} on X. They choose who receives the fees, which can be themselves. Tagging them isn't an endorsement.</div>
                  </>
                ) : (
                  <b className="err" style={{ margin: 0 }}>@{person.handle} wasn't found on X.</b>
                )}
              </div>
            </div>
          )}
          <Copy text={line} />
        </div>
      </section>

      <section className="panel">
        <h2>Check a coin</h2>
        <p className="muted">See what a coin still needs, and register it right away once it's ready.</p>
        <form className="form" onSubmit={runCheck}>
          <label>
            Coin mint address
            <input value={mint} onChange={(e) => setMint(e.target.value)} required spellCheck={false} autoComplete="off" />
          </label>
          <div>
            <button className="btn btn-green" disabled={checking || mint.trim().length < 32}>
              {checking ? "Checking…" : "Check"}
            </button>
          </div>
        </form>
        {err && <p className="err">{err}</p>}
        {check && (
          <>
            <ul className="checklist">
              {check.steps.map((s) => (
                <li key={s.key}>
                  <span className={`mark ${s.ok ? "yes" : "no"}`}>{s.ok ? "✓" : "✕"}</span>
                  <span>
                    {s.label}
                    {s.detail ? <small>{s.detail}</small> : null}
                  </span>
                </li>
              ))}
            </ul>
            {check.live ? (
              <p className="ok" style={{ marginTop: 14 }}>
                Registered and giving. <Link href={`/c/${check.mint}`}>Open the coin page</Link>.
              </p>
            ) : (
              <p className="muted small" style={{ marginTop: 14 }}>Fix the items marked ✕, then check again.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
