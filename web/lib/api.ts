"use client";
import { useCallback, useEffect, useState } from "react";

export type Nonprofit = { config_id: string; name: string; x_handle: string | null; url: string | null };

export type Coin = {
  mint: string;
  name: string;
  symbol: string;
  image: string | null;
  mcap_lamports: number;
  honoree: string | null;
  honoree_name: string | null;
  honoree_avatar: string | null;
  registered_via: "site" | "indexer";
  /** Recipient: the X account currently chosen to receive the fees (the chooser's pick, or whoever it was passed to). */
  recipient: string | null;
  recipient_name: string | null;
  recipient_avatar: string | null;
  recipient_is_chooser: boolean;
  recipient_selected_at: number | null;
  recipient_selected_via: "site" | "x_reply" | "migrated" | null;
  selection_tweet: string | null;
  /** @FeeFlowApp's post about this coin; the chooser can reply to it with the recipient's @handle. */
  announce_tweet: string | null;
  recipient_declined_at: number | null;
  state: RoutingState;
  payout: { kind: "wallet" | "nonprofit"; wallet: string | null; nonprofit: Nonprofit | null; set_at: number | null } | null;
  fallback: Nonprofit | null;
  fallback_at: number | null;
  holding: boolean;
  waiting_lamports: number;
  release_at: number | null;
  released_by_fallback: boolean;
  opted_out: boolean;
  /** The nonprofit funds go to right now, if any (the recipient's pick, or the fallback once active). */
  charity: Nonprofit | null;
  mode: "launch" | "relay";
  vault: string | null;
  status: "built" | "launched" | "pending" | "live" | "failed";
  donated_lamports: number;
  created_at: number;
};

export type RoutingState = "awaiting_selection" | "awaiting_routing" | "active" | "declined" | "fallback";

export type Honoree = { handle: string; name: string | null; avatar: string | null; donated_lamports: number; coins: number };

export type Donation = {
  id: number; mint: string; config_id: string; lamports: number; source: "direct" | "relay"; signature: string | null; created_at: number;
  kind: "donation" | "support"; wallet: string | null; recipient: string | null;
  symbol: string; name: string; image: string | null; honoree: string | null; honoree_avatar: string | null; nonprofit: string | null; nonprofit_handle: string | null;
};

export type NonprofitStats = Nonprofit & { received_lamports: number; coins: number };

export type Stats = {
  sol_usd: number; range: string; donated_lamports: number; donation_lamports: number; support_lamports: number; donations: number; coins: number; coins_new: number;
  honorees: number; honorees_chose: number; recipients: number; nonprofits: number; buyback_lamports: number; held_lamports: number;
  relay_platform_lamports: number; relay_buyback_lamports: number;
  series: { t: number; lamports: number }[];
  top_nonprofits: { config_id: string; name: string | null; lamports: number }[];
};

export type CheckResult = { mint: string; registered: boolean; live: boolean; handle: string | null; steps: { key: string; ok: boolean; label: string; detail?: string }[] };

export type Config = {
  relay: boolean;
  hold_days: number;
  treasury: string;
  router: string | null;
  fee_admin: string;
  charity_bps: number;
  platform_bps: number;
  buyback_bps: number;
  platform_coin: string | null;
  platform_coin_symbol?: string | null;
  featured_coin?: string | null;
  buyback_wallet: string;
  buybacks: { lamports: number; n: number };
  fallback: Nonprofit | null;
  upload: boolean;
  sol_usd: number;
};

export type Shareholder = { address: string; shareBps: number; role: "charity" | "held" | "platform" | "buyback" | "unknown" };
export type Audit = { ok: boolean; unchecked?: boolean; problems: string[]; admin?: string; shareholders?: Shareholder[] } | null;
export type Change = { from_config: string | null; to_config: string; reason: "setup" | "honoree" | "fallback"; signature: string | null; created_at: number; to_name: string; from_name: string | null };
export type Forward = { config_id: string; wallet: string | null; kind: "donation" | "support"; lamports: number; platform_lamports: number; buyback_lamports: number; signature: string; created_at: number; charity: string | null };
export type CoinEvent = { kind: string; actor_handle: string | null; detail: string | null; tweet_id: string | null; created_at: number };

export type CoinDetail = {
  sol_usd: number;
  coin: Coin & { description: string | null; pending_lamports: number | null; accrued_lamports?: number | null; accrue_min_lamports?: number | null };
  changes: Change[];
  forwards: Forward[];
  events: CoinEvent[];
  audit: Audit;
  me: { x_user_id: string; x_handle: string } | null;
  honoree_id_match: boolean;
  is_chooser: boolean;
  is_recipient: boolean;
};

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { "content-type": "application/json" }, ...init });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Request failed (${res.status})`);
  return json as T;
}

export const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

/** Fetches `path` on mount (and when it changes). `reload()` fetches again. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path).then(
      (d) => live && (setData(d), setError(null)),
      (e: Error) => live && setError(e.message)
    );
    return () => {
      live = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading: !data && !error, reload };
}
