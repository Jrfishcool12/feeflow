/**
 * Creates the escrow host coin (HOUSE_MINT): a Pump.fun coin that exists only to hold one donation
 * escrow per nonprofit. Every coin's nonprofit share is forwarded into these escrows, which pass it to
 * donate.gg. Its fee sharing is created but never updated, so Pump.fun never locks it and escrows for
 * new nonprofits can be added at any time. Nobody needs to buy it.
 *
 *   npm run house          create it (once) and write HOUSE_MINT to .env
 */
import { Keypair } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cfg } from "./config.js";
import { authority, conn, send } from "./chain.js";
import { pinMetadata } from "./metadata.js";
import { houseEscrow } from "./pump.js";
import { pumpSdk } from "./sdk.js";

const { PUMP_SDK } = pumpSdk;

if (cfg.HOUSE_MINT) {
  console.log(`HOUSE_MINT is already set: ${cfg.HOUSE_MINT}`);
  process.exit(0);
}

const imagePath = "../web/public/feeward-og.png";
const image = existsSync(imagePath) ? `data:image/png;base64,${readFileSync(imagePath).toString("base64")}` : null;
if (!image) throw new Error(`Couldn't find ${imagePath} for the coin image.`);

const name = "Feeward Escrows";
const symbol = "GCESCROW";
console.log("Uploading metadata...");
const uri = await pinMetadata({
  name,
  symbol,
  description: "Holds Feeward's donation escrows. Not a coin to trade: it has no purpose besides routing donations.",
  imageDataUrl: image,
});

const mint = Keypair.generate();
console.log(`Creating ${mint.publicKey.toBase58()} (paid by the server key)...`);
const create = await PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name, symbol, uri, creator: authority.publicKey, user: authority.publicKey, mayhemMode: false });
const sig1 = await send([create], 300_000, [mint]);
console.log(`  created: ${sig1}`);
const sig2 = await send([await PUMP_SDK.createFeeSharingConfig({ creator: authority.publicKey, mint: mint.publicKey, pool: null })]);
console.log(`  fee sharing (left unlocked on purpose): ${sig2}`);

const env = readFileSync(".env", "utf8");
writeFileSync(".env", /^HOUSE_MINT=.*$/m.test(env) ? env.replace(/^HOUSE_MINT=.*$/m, `HOUSE_MINT=${mint.publicKey.toBase58()}`) : env.trimEnd() + `\nHOUSE_MINT=${mint.publicKey.toBase58()}\n`);
console.log(`Wrote HOUSE_MINT=${mint.publicKey.toBase58()} to .env`);

// Prove escrows can be created on it, starting with the default fallback nonprofit.
if (cfg.DEFAULT_CONFIG_ID) {
  (cfg as { HOUSE_MINT?: string }).HOUSE_MINT = mint.publicKey.toBase58();
  const escrow = await houseEscrow(cfg.DEFAULT_CONFIG_ID);
  console.log(`Escrow for the default nonprofit: ${escrow.toBase58()} (${(await conn.getAccountInfo(escrow)) ? "created" : "MISSING"})`);
}
console.log("Done. Restart the server so it picks up HOUSE_MINT.");
process.exit(0);
