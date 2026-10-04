import { db, now } from "./db.js";
import { botPost } from "./x.js";

/**
 * Posts from @feewardx about a coin and remembers the post, so a reply to any of the coin's
 * posts can be matched back to the coin. Returns the post id (null when posting is off or failed).
 */
export async function coinPost(mint: string, kind: string, text: string, replyTo?: string | null, image?: Buffer | null): Promise<string | null> {
  const id = await botPost(text, replyTo, image);
  if (id) {
    const mentions = [...text.matchAll(/@([A-Za-z0-9_]{1,15})/g)].map((m) => m[1].toLowerCase());
    db.prepare("INSERT OR IGNORE INTO bot_posts (tweet_id, mint, kind, mentions, created_at) VALUES (?, ?, ?, ?, ?)").run(id, mint, kind, mentions.join(","), now());
  }
  return id;
}

/** Length as X counts it: every link is 23 characters. */
export const xLength = (text: string) => text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;

/** Fills `{0}`, `{1}`… in a template with optional pieces, dropping the last ones until the post fits 280. */
export function fit(template: string, ...optional: string[]): string {
  for (let n = optional.length; n >= 0; n--) {
    const text = optional.reduce((t, piece, i) => t.replace(`{${i}}`, i < n ? piece : ""), template);
    if (xLength(text) <= 280 || n === 0) return text;
  }
  return template;
}
