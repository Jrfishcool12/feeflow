import { TwitterApi } from "twitter-api-v2";
import { cfg } from "./config.js";

const reader = new TwitterApi(cfg.X_BEARER_TOKEN).readOnly.v2;

const bot =
  cfg.X_BOT_APP_KEY && cfg.X_BOT_APP_SECRET && cfg.X_BOT_ACCESS_TOKEN && cfg.X_BOT_ACCESS_SECRET
    ? new TwitterApi({
        appKey: cfg.X_BOT_APP_KEY,
        appSecret: cfg.X_BOT_APP_SECRET,
        accessToken: cfg.X_BOT_ACCESS_TOKEN,
        accessSecret: cfg.X_BOT_ACCESS_SECRET,
      }).readWrite.v2
    : null;

export const normalizeHandle = (h: string) => h.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#]/)[0];

export type XUser = { id: string; username: string; name: string | null; avatar: string | null };
const FIELDS = { "user.fields": ["profile_image_url", "name"] as any };
const toUser = (d: any): XUser => ({ id: d.id, username: d.username, name: d.name ?? null, avatar: d.profile_image_url ? String(d.profile_image_url).replace("_normal.", "_400x400.") : null });

export async function lookupUser(handle: string): Promise<XUser | null> {
  const username = normalizeHandle(handle);
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) return null;
  const res = await reader.userByUsername(username, FIELDS);
  return res.data ? toUser(res.data) : null;
}

export async function lookupUserById(id: string): Promise<XUser | null> {
  const res = await reader.user(id, FIELDS);
  return res.data ? toUser(res.data) : null;
}

/** Posts from the brand account. Logs instead when no bot credentials are configured. */
export async function botPost(text: string, replyTo?: string | null, image?: Buffer | null): Promise<string | null> {
  if (!bot) {
    console.log(`[bot post${replyTo ? ` → ${replyTo}` : ""}${image ? " + card" : ""}] ${text}`);
    return null;
  }
  try {
    let mediaId: string | null = null;
    if (image) mediaId = await bot.uploadMedia(image, { media_type: "image/png" }).catch((e) => (console.error("card upload failed:", e.message), null));
    const res = await bot.tweet(text, {
      ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}),
      ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
    } as any);
    return res.data.id;
  } catch (e) {
    console.error("bot post failed:", (e as Error).message);
    return null;
  }
}

export const botEnabled = () => !!bot;

/** The bot account's X id (cached). */
let botId: { id: string; username: string } | null = null;
export async function botAccount() {
  if (!bot) return null;
  if (!botId) {
    const me = await bot.me();
    botId = { id: me.data.id, username: me.data.username };
  }
  return botId;
}

export type Mention = {
  id: string; text: string; author_id: string; conversation_id: string | null; replied_to: string | null;
  mentions: { username: string; start: number; end: number }[];
};

/** Posts that mention the bot, oldest first, newer than sinceId. */
export async function fetchMentions(sinceId: string | null): Promise<Mention[]> {
  const acct = await botAccount();
  if (!bot || !acct) return [];
  const res = await bot.userMentionTimeline(acct.id, {
    max_results: 100,
    ...(sinceId ? { since_id: sinceId } : {}),
    "tweet.fields": ["author_id", "conversation_id", "referenced_tweets", "entities", "created_at"],
  } as any);
  const out: Mention[] = [];
  for (const t of (res.tweets ?? []) as any[]) {
    out.push({
      id: t.id,
      text: t.text ?? "",
      author_id: t.author_id,
      conversation_id: t.conversation_id ?? null,
      replied_to: (t.referenced_tweets ?? []).find((r: any) => r.type === "replied_to")?.id ?? null,
      mentions: (t.entities?.mentions ?? []).map((m: any) => ({ username: m.username, start: m.start, end: m.end })),
    });
  }
  return out.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

/** OAuth 2.0 (PKCE) login, used only to prove a claimant owns the target handle. */
const oauthClient = () => new TwitterApi({ clientId: cfg.X_CLIENT_ID, clientSecret: cfg.X_CLIENT_SECRET });
const callbackUrl = () => `${cfg.PUBLIC_URL}/auth/x/callback`;

export function startLogin() {
  return oauthClient().generateOAuth2AuthLink(callbackUrl(), { scope: ["users.read", "tweet.read"] });
}

export async function finishLogin(code: string, codeVerifier: string) {
  const { client } = await oauthClient().loginWithOAuth2({ code, codeVerifier, redirectUri: callbackUrl() });
  const me = await client.v2.me();
  return { id: me.data.id, username: me.data.username };
}
