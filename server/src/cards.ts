/**
 * Receipt-style card images (1200x630) for @FeeFlowApp posts and for share-link previews.
 *
 *   waiting: "$4,120  waiting for @elonmusk to give to any nonprofit"
 *   sent:    "$4,120  sent to Make-A-Wish America in @elonmusk's name"
 */
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { cfg } from "./config.js";
import { getCharity, routingState, type Coin } from "./db.js";
import { getHonoree } from "./market.js";

const require = createRequire(import.meta.url);
const font = (w: number) => readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff`));
const FONTS = [400, 600, 800].map((weight) => ({ name: "Inter", data: font(weight), weight: weight as 400 | 600 | 800, style: "normal" as const }));

// server/assets has a copy so the logo also works when only the server folder is deployed.
const WORDMARK_PATH = ["./assets/feeflow-logo.svg", "../web/public/feeflow-logo.svg"].find((p) => existsSync(p)) ?? "";
const wordmark = existsSync(WORDMARK_PATH)
  ? `data:image/svg+xml;base64,${Buffer.from(readFileSync(WORDMARK_PATH, "utf8").replace(/currentColor/g, "#FBF9F5")).toString("base64")}`
  : null;

const GREEN = "#FC6C50";
const MUTED = "#A39B8F";

/** Downloads an image for embedding. PNG and JPEG only (what the renderer decodes reliably). */
async function embed(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const type = (r.headers.get("content-type") ?? "").split(";")[0];
    if (!/^image\/(png|jpe?g)$/.test(type)) return null;
    return `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

type El = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown } };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): El => ({
  type,
  props: { style: { display: "flex", ...style }, children, ...extra },
});

function circle(src: string | null, letter: string, size: number, ring = "#2E2B28"): El {
  return src
    ? h("img", { width: size, height: size, borderRadius: size / 2, border: `4px solid ${ring}`, objectFit: "cover" }, undefined, { src, width: size, height: size })
    : h("div", { width: size, height: size, borderRadius: size / 2, background: "#2A2622", color: "#FC6C50", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 800 }, (letter.replace(/^[@$]/, "")[0] ?? "?").toUpperCase());
}

export type CardInput = {
  amount: string; // already formatted, e.g. "$4,120" or "12.40 SOL"
  line1: string; // e.g. "sent to @handle", "donated to St. Jude"
  line2: string; // e.g. "chosen by @chooser"
  symbol: string;
  coinImage: string | null;
  avatar: string | null;
  avatarLabel: string;
  bigSize?: number; // font size of the big line (smaller when it's a ticker, not an amount)
};

export async function renderCard(c: CardInput): Promise<Buffer> {
  const [coinImg, avatarImg] = await Promise.all([embed(c.coinImage), embed(c.avatar)]);
  const lines = [h("span", { color: "#FBF9F5" }, c.line1), h("span", { color: MUTED }, c.line2)];
  const host = cfg.PUBLIC_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const tree = h(
    "div",
    {
      width: 1200,
      height: 630,
      flexDirection: "column",
      justifyContent: "space-between",
      padding: 64,
      background: "#141312",
      backgroundImage: "radial-gradient(circle at 88% 30%, rgba(252,108,80,0.22), rgba(20,19,18,0) 55%)",
      fontFamily: "Inter",
      color: "#FBF9F5",
    },
    [
      h("div", { justifyContent: "space-between", alignItems: "center" }, [
        wordmark ? h("img", { height: 50 }, undefined, { src: wordmark, height: 50, width: 210 }) : h("span", { fontSize: 40, fontWeight: 800 }, "FeeFlow"),
        h("span", { fontSize: 28, color: MUTED }, date),
      ]),
      h("div", { justifyContent: "space-between", alignItems: "center" }, [
        h("div", { flexDirection: "column", maxWidth: 700 }, [
          h("span", { fontSize: c.bigSize ?? 128, fontWeight: 800, letterSpacing: -5, lineHeight: 1, color: GREEN }, c.amount),
          h("div", { flexDirection: "column", fontSize: 40, fontWeight: 600, marginTop: 22, lineHeight: 1.2 }, lines),
        ]),
        h("div", { alignItems: "center" }, [
          circle(coinImg, c.symbol, 150),
          h("span", { fontSize: 64, fontWeight: 800, color: GREEN, margin: "0 22px" }, "$"),
          circle(avatarImg, c.avatarLabel || "?", 150, GREEN),
        ]),
      ]),
      h("div", { justifyContent: "space-between", alignItems: "center", fontSize: 28, color: MUTED }, [
        h("span", {}, `from $${c.symbol} creator fees`),
        h("span", { color: GREEN, fontWeight: 600 }, host),
      ]),
    ]
  );

  const svg = await satori(tree as any, { width: 1200, height: 630, fonts: FONTS });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng());
}

/** The card for one coin, worded for where it is in the chooser → recipient → payout flow. Returns null instead of failing a post. */
export async function cardFor(c: Coin, kind: "waiting" | "sent", amount: string): Promise<Buffer | null> {
  try {
    const state = routingState(c);
    const chooser = c.opted_out ? null : c.honoree_handle;
    const recipient = c.recipient_handle;
    const profile = (id: string | null) => (id ? getHonoree(id) : undefined);
    const fallback = getCharity(c.fallback_config_id ?? c.config_id)?.name ?? "the fallback nonprofit";
    let line1: string, line2: string, avatarOf: string | null;
    // Nothing earned yet: lead with the coin and who's tagged rather than a "$0".
    if (/^\$0$|^0(\.0+)? SOL$/.test(amount)) {
      const p = profile(c.opted_out ? null : c.honoree_user_id);
      return await renderCard({
        amount: `$${c.symbol}`,
        bigSize: c.symbol.length > 6 ? 84 : 112,
        line1: chooser ? `tags @${chooser}` : "a new FeeFlow coin",
        line2: recipient ? `fees go to @${recipient}` : "who picks where its fees go",
        symbol: c.symbol,
        coinImage: c.image,
        avatar: p?.avatar ?? null,
        avatarLabel: p?.handle ?? c.symbol,
      });
    }
    if (kind === "waiting") {
      if (state === "awaiting_routing" && recipient) [line1, line2, avatarOf] = [`waiting for @${recipient}`, "to accept and choose where it goes", c.recipient_user_id];
      else [line1, line2, avatarOf] = ["waiting for a recipient", chooser ? `to be chosen by @${chooser}` : "to be chosen", c.opted_out ? null : c.honoree_user_id];
    } else if (state === "fallback" || state === "declined") {
      [line1, line2, avatarOf] = [`donated to ${fallback}`, state === "declined" ? "the recipient declined" : "no payout set in time", null];
    } else if (c.payout_kind === "wallet") {
      [line1, line2, avatarOf] = [`sent to @${recipient}`, "as support, to their verified wallet", c.recipient_user_id];
    } else {
      [line1, line2, avatarOf] = [`donated to ${getCharity(c.payout_config_id ?? "")?.name ?? "a nonprofit"}`, recipient ? `chosen by @${recipient}` : "", c.recipient_user_id];
    }
    const p = profile(avatarOf);
    return await renderCard({ amount, line1, line2, symbol: c.symbol, coinImage: c.image, avatar: p?.avatar ?? null, avatarLabel: p?.handle ?? c.symbol });
  } catch (e) {
    console.error("card:", (e as Error).message);
    return null;
  }
}
