"use client";
import { useEffect, useState } from "react";
import { api, post, type CoinDetail, type Config } from "@/lib/api";
import { connectWallet, signText } from "@/lib/wallet";
import { dateLong } from "@/lib/roles";
import { useFeeFlowWallet } from "@/lib/feeflowWallet";
import { NonprofitPicker } from "./NonprofitPicker";
import { Avatar } from "./Avatar";

type Msg = { ok: boolean; text: string } | null;
type Lookup = { found: boolean; handle: string; name: string | null; avatar: string | null };

const login = (mint: string) => `/auth/x/start?mint=${encodeURIComponent(mint)}`;
const onX = (id: string) => `https://x.com/FeeFlowApp/status/${id}`;

/** What the chooser and the recipient do on a coin's page. Shows nothing to everyone else once routing is set. */
export function ActionPanel({ d, cfg, onChanged }: { d: CoinDetail; cfg: Config | null; onChanged: () => void }) {
  const c = d.coin;
  const fallback = c.fallback?.name ?? "the fallback nonprofit";
  const deadline = c.release_at ? dateLong(c.release_at) : null;

  if (c.state === "awaiting_selection") {
    if (d.is_chooser) return <ChooseRecipient d={d} fallback={fallback} deadline={deadline} onChanged={onChanged} />;
    return (
      <section className="panel dark" id="act">
        <h2>{c.honoree ? `Are you @${c.honoree}?` : "Were you tagged on this coin?"}</h2>
        <p className="muted">
          This coin tags {c.honoree ? `@${c.honoree}` : "an X account"}, who chooses who receives its creator fees: themselves, a creator, a project, a cause or a
          nonprofit. @FeeFlowApp tagged them on X: they can reply to that post with one @handle (or "me"), or log in here to choose. Being tagged doesn't mean they endorsed the
          coin.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {c.announce_tweet && (
            <a className="btn btn-white" href={onX(c.announce_tweet)} target="_blank" rel="noopener">
              Reply on X
            </a>
          )}
          <a className={c.announce_tweet ? "btn btn-ghost" : "btn btn-white"} href={login(c.mint)}>
            Log in with X
          </a>
        </div>
        {d.me && <p className="muted small" style={{ marginTop: 12 }}>You're logged in as @{d.me.x_handle}, which isn't this account.</p>}
      </section>
    );
  }

  if (c.state === "awaiting_routing") {
    if (d.is_recipient) return <SetPayout d={d} cfg={cfg} fallback={fallback} deadline={deadline} onChanged={onChanged} />;
    return (
      <section className="panel dark" id="act">
        <h2>Are you @{c.recipient}?</h2>
        <p className="muted">
          {d.is_chooser ? "You chose @" + c.recipient + ". " : ""}@{c.recipient} was chosen to receive this coin's creator fees. Log in with X to accept and choose where they
          go: your wallet, or a nonprofit on donate.gg. You can also pass it on to another account, or decline.
          {deadline ? ` If nothing is set by ${deadline}, funds go to ${fallback}.` : ""}
        </p>
        <a className="btn btn-white" href={login(c.mint)}>
          Log in with X
        </a>
        {d.me && !d.is_chooser && <p className="muted small" style={{ marginTop: 12 }}>You're logged in as @{d.me.x_handle}, which isn't this account.</p>}
        {d.is_chooser && <NameToggle d={d} onChanged={onChanged} />}
      </section>
    );
  }

  if (d.is_chooser)
    return (
      <section className="panel" id="act">
        <h2>Your name on this coin</h2>
        <NameToggle d={d} onChanged={onChanged} />
      </section>
    );
  return null;
}

function NameToggle({ d, onChanged }: { d: CoinDetail; onChanged: () => void }) {
  const [msg, setMsg] = useState<Msg>(null);
  async function toggle() {
    try {
      const r = await post<{ message: string }>(`/api/coins/${d.coin.mint}/optout`, { out: !d.coin.opted_out });
      setMsg({ ok: true, text: r.message });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  return (
    <div style={{ marginTop: 14 }}>
      <button className="btn btn-ghost btn-sm" onClick={toggle}>
        {d.coin.opted_out ? "Show my name again" : "Remove my name from this page"}
      </button>
      {msg && <p className={msg.ok ? "ok" : "err"} role="status" style={{ marginTop: 8 }}>{msg.text}</p>}
    </div>
  );
}

// ---------- the chooser picks the recipient ----------

function ChooseRecipient({ d, fallback, deadline, onChanged }: { d: CoinDetail; fallback: string; deadline: string | null; onChanged: () => void }) {
  const c = d.coin;
  const [handle, setHandle] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const clean = handle.trim().replace(/^@/, "");

  useEffect(() => {
    setFound(null);
    setSure(false);
    if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) return;
    setLooking(true);
    const t = setTimeout(() => {
      api<Lookup>(`/api/x/lookup?handle=${encodeURIComponent(clean)}`)
        .then(setFound, (e: Error) => setMsg({ ok: false, text: e.message }))
        .finally(() => setLooking(false));
    }, 350);
    return () => clearTimeout(t);
  }, [clean]);

  async function lock() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post<{ message: string }>(`/api/coins/${c.mint}/recipient`, { handle: found!.handle, confirm: true });
      setMsg({ ok: true, text: r.message });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const self = found?.found && d.me && found.handle.toLowerCase() === d.me.x_handle.toLowerCase();
  return (
    <section className="panel dark" id="act">
      <h2>Choose who receives this coin's fees, @{d.me?.x_handle}</h2>
      <p className="muted">
        Pick any X account: yourself, a creator, a project, a cause or a nonprofit. They'll log in to accept and choose where funds go, their wallet or a nonprofit on
        donate.gg. Choosing an account doesn't mean it endorsed this coin.
        {deadline ? ` If no payout destination is set by ${deadline}, funds go to ${fallback}.` : ""}
      </p>
      <p className="muted small">
        Or do it on X: reply to @FeeFlowApp's post about this coin with the account's @handle, or "me".
        {c.announce_tweet ? (
          <>
            {" "}
            <a href={onX(c.announce_tweet)} target="_blank" rel="noopener" style={{ color: "inherit" }}>
              Open the post
            </a>
          </>
        ) : null}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" aria-label="Recipient's X handle" autoComplete="off" style={{ flex: "1 1 220px" }} />
        {d.me && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHandle(d.me!.x_handle)}>
            Choose myself
          </button>
        )}
      </div>
      {looking && <p className="muted small" style={{ marginTop: 10 }}>Looking up @{clean}…</p>}
      {found && !found.found && <p className="err" style={{ marginTop: 10 }}>@{clean} wasn't found on X.</p>}
      {found?.found && (
        <div className="confirm-box" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Avatar src={found.avatar} label={found.handle} size={44} />
            <div>
              <b>{found.name ?? `@${found.handle}`}</b>
              <div className="muted small">@{found.handle}{self ? " (you)" : ""}</div>
            </div>
          </div>
          <label className="check" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            <span>
              Select @{found.handle} as the recipient for ${c.symbol}. You can't change this later; @{found.handle} can accept it or pass it on.
            </span>
          </label>
          <button className="btn btn-green" style={{ marginTop: 14 }} disabled={!sure || busy} onClick={lock}>
            {busy ? "Selecting…" : `Select @${found.handle} as recipient`}
          </button>
        </div>
      )}
      {msg && <p className={msg.ok ? "ok" : "err"} role="status" style={{ marginTop: 12 }}>{msg.text}</p>}
      <NameToggle d={d} onChanged={onChanged} />
    </section>
  );
}

// ---------- the recipient accepts and sets the payout destination ----------

function SetPayout({ d, cfg, fallback, deadline, onChanged }: { d: CoinDetail; cfg: Config | null; fallback: string; deadline: string | null; onChanged: () => void }) {
  const c = d.coin;
  const [sure, setSure] = useState(false);
  const [tab, setTab] = useState<"wallet" | "nonprofit" | "someone">("wallet");
  const [wallet, setWallet] = useState<{ provider: Awaited<ReturnType<typeof connectWallet>>["provider"]; address: string } | null>(null);
  const [nonprofit, setNonprofit] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const ffw = useFeeFlowWallet();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const run = async (fn: () => Promise<{ message: string }>) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: r.message });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const useWallet = () =>
    run(async () => {
      const ch = await post<{ nonce: string; message: string }>(`/api/coins/${c.mint}/wallet-challenge`, { wallet: wallet!.address });
      const signature = await signText(wallet!.provider, ch.message);
      return post<{ message: string }>(`/api/coins/${c.mint}/payout`, { kind: "wallet", nonce: ch.nonce, signature, confirm: true });
    });
  const useNonprofit = () => run(() => post<{ message: string }>(`/api/coins/${c.mint}/payout`, { kind: "nonprofit", config_id: nonprofit, confirm: true }));
  const decline = () => run(() => post<{ message: string }>(`/api/coins/${c.mint}/decline`, { confirm: true }));

  return (
    <section className="panel dark" id="act">
      <h2>You were chosen to receive ${c.symbol}'s fees, @{d.me?.x_handle}</h2>
      <p className="muted">
        {c.recipient_is_chooser ? "You chose yourself." : `@${c.honoree ?? "The chooser"} chose you.`} Choose where the funds go, or pass them on.{" "}
        {cfg ? `This is the ${Math.round(cfg.charity_bps / 100)}% recipient share of the coin's creator fees, ` : "This is the recipient share of the coin's creator fees, "}
        paid in public transactions.
        {deadline ? ` If nothing is set by ${deadline}, funds go to ${fallback}.` : ""}
      </p>
      <div className="seg" role="tablist" style={{ marginBottom: 14 }}>
        <button role="tab" aria-selected={tab === "wallet"} onClick={() => setTab("wallet")}>
          My wallet
        </button>
        <button role="tab" aria-selected={tab === "nonprofit"} onClick={() => setTab("nonprofit")}>
          A nonprofit
        </button>
        <button role="tab" aria-selected={tab === "someone"} onClick={() => setTab("someone")}>
          Someone else
        </button>
      </div>
      {tab !== "someone" && (
        <label className="check" style={{ margin: "0 0 14px" }}>
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          <span>
            <b>This is permanent.</b> Once set, the destination for ${c.symbol}'s fees can't be changed.
          </span>
        </label>
      )}

      {tab === "someone" ? (
        <PassOn d={d} onChanged={onChanged} />
      ) : tab === "wallet" ? (
        <div>
          <p className="muted small">
            Funds are sent to your wallet as support. You'll sign a message to prove you own it: no transaction, no fee.
          </p>
          {!wallet ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {ffw.authenticated && ffw.address && ffw.provider ? (
                <button className="btn btn-white" disabled={busy} onClick={() => setWallet({ provider: ffw.provider!, address: ffw.address! })}>
                  Use my FeeFlow wallet
                </button>
              ) : (
                <button className="btn btn-white" disabled={busy || !ffw.ready} onClick={ffw.login}>
                  Create a FeeFlow wallet
                </button>
              )}
              <button className="btn btn-ghost" disabled={busy} onClick={() => connectWallet().then(setWallet, (e: Error) => setMsg({ ok: false, text: e.message }))}>
                Connect another wallet
              </button>
            </div>
          ) : (
            <div className="confirm-box">
              <div className="muted small">Funds will be sent to</div>
              <div className="mono" style={{ wordBreak: "break-all", fontSize: 15, margin: "4px 0 12px" }}>{wallet.address}</div>
              <button className="btn btn-green" disabled={busy || !sure} onClick={useWallet}>
                {busy ? "Waiting for your wallet…" : "Sign and send funds here"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div>
          <p className="muted small">
            Funds are donated through donate.gg to the nonprofit you pick. donate.gg delivers the donation and charges its own processing fee, so the nonprofit receives a bit
            less than the recipient share. The list is donate.gg's; FeeFlow doesn't separately verify these organizations.
          </p>
          <NonprofitPicker value={nonprofit} onChange={setNonprofit} />
          <button className="btn btn-green" style={{ marginTop: 14 }} disabled={busy || !nonprofit || !sure} onClick={useNonprofit}>
            {busy ? "Saving…" : "Donate funds to this nonprofit"}
          </button>
        </div>
      )}

      {(
        <div style={{ marginTop: 20, borderTop: "1px solid var(--ink-line, #2e2b28)", paddingTop: 14 }}>
          {!declining ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setDeclining(true)}>
              Decline
            </button>
          ) : (
            <div>
              <p className="muted small">Declining sends this coin's recipient share to {fallback}, now and from then on. This can't be undone.</p>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={decline}>
                Yes, decline
              </button>{" "}
              <button className="btn btn-ghost btn-sm" onClick={() => setDeclining(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
      {msg && <p className={msg.ok ? "ok" : "err"} role="status" style={{ marginTop: 12 }}>{msg.text}</p>}
    </section>
  );
}

// ---------- the recipient passes it on ----------

function PassOn({ d, onChanged }: { d: CoinDetail; onChanged: () => void }) {
  const c = d.coin;
  const [handle, setHandle] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const clean = handle.trim().replace(/^@/, "");

  useEffect(() => {
    setFound(null);
    if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) return;
    setLooking(true);
    const t = setTimeout(() => {
      api<Lookup>(`/api/x/lookup?handle=${encodeURIComponent(clean)}`)
        .then(setFound, (e: Error) => setMsg({ ok: false, text: e.message }))
        .finally(() => setLooking(false));
    }, 350);
    return () => clearTimeout(t);
  }, [clean]);

  async function pass() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post<{ message: string }>(`/api/coins/${c.mint}/redirect`, { handle: found!.handle });
      setMsg({ ok: true, text: r.message });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const self = found?.found && d.me && found.handle.toLowerCase() === d.me.x_handle.toLowerCase();
  return (
    <div>
      <p className="muted small">
        Pass ${c.symbol}'s fees to another X account instead: a friend, a project, a cause or a charity's account. @FeeFlowApp tags them, and they can accept, choose where
        funds go, or pass it on again. You can also do this by replying to @FeeFlowApp with their @handle.
      </p>
      <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" aria-label="X handle to pass it to" autoComplete="off" />
      {looking && <p className="muted small" style={{ marginTop: 10 }}>Looking up @{clean}…</p>}
      {found && !found.found && <p className="err" style={{ marginTop: 10 }}>@{clean} wasn't found on X.</p>}
      {self && <p className="muted small" style={{ marginTop: 10 }}>That's you. To keep the fees, choose your wallet or a nonprofit above.</p>}
      {found?.found && !self && (
        <div className="confirm-box" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Avatar src={found.avatar} label={found.handle} size={44} />
            <div>
              <b>{found.name ?? `@${found.handle}`}</b>
              <div className="muted small">@{found.handle}</div>
            </div>
          </div>
          <button className="btn btn-green" style={{ marginTop: 14 }} disabled={busy} onClick={pass}>
            {busy ? "Passing on…" : `Pass to @${found.handle}`}
          </button>
        </div>
      )}
      {msg && <p className={msg.ok ? "ok" : "err"} role="status" style={{ marginTop: 12 }}>{msg.text}</p>}
    </div>
  );
}
