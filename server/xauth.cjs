// Gets X access tokens for the bot account (@FeeFlowApp) using your existing developer app.
//   node xauth.cjs start          -> prints a link; open it, log in as @FeeFlowApp, approve, note the PIN
//   node xauth.cjs finish <PIN>   -> exchanges the PIN, checks the account, saves tokens to .env and Railway
// Run from C:\dev\goodcall\server. No token values are printed.
const fs = require("fs");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const KEY = env.X_BOT_APP_KEY, SECRET = env.X_BOT_APP_SECRET;
if (!KEY || !SECRET) { console.log("X_BOT_APP_KEY / X_BOT_APP_SECRET missing from .env"); process.exit(1); }
const TMP = ".xauth-pending.json";

const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function sign(method, url, params, tokenSecret = "") {
  const base = [method, pct(url), pct(Object.keys(params).sort().map((k) => `${pct(k)}=${pct(params[k])}`).join("&"))].join("&");
  return crypto.createHmac("sha1", `${pct(SECRET)}&${pct(tokenSecret)}`).update(base).digest("base64");
}
function header(method, url, extra, token, tokenSecret, query = {}) {
  const o = { oauth_consumer_key: KEY, oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_version: "1.0", ...extra };
  if (token) o.oauth_token = token;
  o.oauth_signature = sign(method, url, { ...o, ...query }, tokenSecret);
  return "OAuth " + Object.keys(o).sort().map((k) => `${pct(k)}="${pct(o[k])}"`).join(", ");
}

async function start() {
  const url = "https://api.x.com/oauth/request_token";
  const r = await fetch(url, { method: "POST", headers: { Authorization: header("POST", url, { oauth_callback: "oob" }) } });
  const t = await r.text();
  if (!r.ok) { console.log(`X refused (${r.status}): ${t.slice(0, 300)}`); process.exit(1); }
  const p = new URLSearchParams(t);
  fs.writeFileSync(TMP, JSON.stringify({ token: p.get("oauth_token"), secret: p.get("oauth_token_secret") }));
  console.log("OPEN THIS LINK (logged in as @FeeFlowApp):");
  console.log(`https://api.x.com/oauth/authorize?oauth_token=${p.get("oauth_token")}`);
}

async function finish(pin) {
  if (!fs.existsSync(TMP)) { console.log("Run `node xauth.cjs start` first."); process.exit(1); }
  const pend = JSON.parse(fs.readFileSync(TMP, "utf8"));
  const url = "https://api.x.com/oauth/access_token";
  const r = await fetch(url, { method: "POST", headers: { Authorization: header("POST", url, { oauth_verifier: pin }, pend.token, pend.secret) } });
  const t = await r.text();
  if (!r.ok) { console.log(`X refused the PIN (${r.status}): ${t.slice(0, 200)}. Run start again for a new link.`); process.exit(1); }
  fs.unlinkSync(TMP);
  const p = new URLSearchParams(t);
  const token = p.get("oauth_token"), secret = p.get("oauth_token_secret"), who = p.get("screen_name");
  console.log(`authorized account: @${who}`);
  if (!who || who.toLowerCase() !== "feeflowapp") {
    console.log("That isn't @FeeFlowApp, so nothing was saved. Log out of X, log in as @FeeFlowApp, and run start again.");
    process.exit(1);
  }
  // Check the app's permission level: posting needs "read-write".
  const vurl = "https://api.x.com/1.1/account/verify_credentials.json";
  const v = await fetch(vurl, { headers: { Authorization: header("GET", vurl, {}, token, secret) } });
  const access = v.headers.get("x-access-level");
  console.log(`token check: HTTP ${v.status}, access level: ${access ?? "unknown"}`);
  if (access && !access.includes("write")) {
    console.log("The token is read-only. In the developer portal set App permissions to \"Read and write\", save, then run start again.");
    process.exit(1);
  }
  let text = fs.readFileSync(".env", "utf8");
  for (const [k, val] of [["X_BOT_ACCESS_TOKEN", token], ["X_BOT_ACCESS_SECRET", secret]]) {
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${val}`) : text.replace(/\s*$/, `\n${k}=${val}\n`);
  }
  fs.writeFileSync(".env", text);
  console.log("saved to .env");
  execFileSync("railway", ["variable", "set", `X_BOT_ACCESS_TOKEN=${token}`, `X_BOT_ACCESS_SECRET=${secret}`], { stdio: "ignore", shell: true });
  console.log("saved to Railway (server redeploying)");
}

const [cmd, arg] = process.argv.slice(2);
(cmd === "finish" ? finish(String(arg || "").trim()) : start()).catch((e) => { console.log("error: " + e.message); process.exit(1); });
