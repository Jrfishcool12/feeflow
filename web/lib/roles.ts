import type { Coin, RoutingState } from "./api";

/**
 * One vocabulary for every page, card and receipt:
 *  - Chooser: the X account a coin is named for. Picks the recipient, once.
 *  - Recipient: any X account, including the chooser. Can accept, decline, or pass it on to another account.
 *  - Payout destination: the recipient's verified wallet, or a nonprofit on donate.gg.
 * Wallet payouts are "support"; donate.gg payouts are "donations".
 */
export const STATE_LABEL: Record<RoutingState, string> = {
  awaiting_selection: "Awaiting recipient selection",
  awaiting_routing: "Awaiting recipient routing selection",
  active: "Routing active",
  declined: "Recipient declined",
  fallback: "Fallback activated",
};

/** Short badge text for lists and cards. */
export const STATE_SHORT: Record<RoutingState, string> = {
  awaiting_selection: "Choosing recipient",
  awaiting_routing: "Awaiting recipient",
  active: "Routing active",
  declined: "Declined",
  fallback: "Fallback",
};

export const at = (h: string | null | undefined) => (h ? `@${h}` : "the chooser");
export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Where the recipient share goes right now, in words. */
export function destination(c: Coin): string {
  if (c.state === "fallback" || c.state === "declined") return `${c.fallback?.name ?? "the fallback nonprofit"} (fallback)`;
  if (c.payout?.kind === "wallet" && c.payout.wallet) return `${at(c.recipient)}'s wallet ${shortAddr(c.payout.wallet)}`;
  if (c.payout?.kind === "nonprofit") return `${c.payout.nonprofit?.name ?? "a nonprofit"} via donate.gg`;
  return "Not set yet";
}

/** One line under the big number: what's happening with this coin's funds. */
export function statusLine(c: Coin): string {
  switch (c.state) {
    case "awaiting_selection":
      return `held until ${c.honoree ? `@${c.honoree}` : "the chooser"} chooses a recipient`;
    case "awaiting_routing":
      return `held for @${c.recipient}, who hasn't accepted yet`;
    case "active":
      return c.payout?.kind === "wallet" ? `sent to @${c.recipient} as support` : `donated to ${c.payout?.nonprofit?.name ?? "a nonprofit"}, chosen by @${c.recipient}`;
    case "declined":
      return `donated to ${c.fallback?.name ?? "the fallback nonprofit"}: @${c.recipient} declined`;
    case "fallback":
      return `donated to ${c.fallback?.name ?? "the fallback nonprofit"} (fallback)`;
  }
}

/** Whose move it is, if anyone's. */
export function actionNeeded(c: Coin): string | null {
  if (c.state === "awaiting_selection") return `${c.honoree ? `@${c.honoree}` : "The chooser"} chooses the recipient`;
  if (c.state === "awaiting_routing") return `@${c.recipient} accepts and chooses where funds go`;
  return null;
}

export const dateLong = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
