/**
 * Router admin.
 *   npm run router -- status          show the router's on-chain config and authority balance
 *   npm run router -- init            one-time setup from .env (wallets and split become permanent)
 *   npm run router -- fund 0.5        send SOL to the authority PDA (it pays rent for fee-sharing accounts)
 */
import { LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { CHARITY_BPS, cfg } from "./config.js";
import { authority, buybackWallet, conn, platformWallet, send } from "./chain.js";
import { ROUTER_ID, decodeRouterConfig, initializeIx, routerAuthority, routerConfig } from "./router.js";

if (!ROUTER_ID) throw new Error("Set ROUTER_PROGRAM_ID in .env first.");
const [cmd, arg] = process.argv.slice(2);

if (cmd === "init") {
  if (await conn.getAccountInfo(routerConfig())) throw new Error("Router is already initialized.");
  const sig = await send([
    initializeIx({
      attester: authority.publicKey,
      platform: platformWallet,
      buyback: buybackWallet.publicKey,
      charityBps: CHARITY_BPS,
      platformBps: cfg.PLATFORM_BPS,
      buybackBps: cfg.BUYBACK_BPS,
      cooldownSecs: cfg.CHANGE_COOLDOWN_DAYS * 86400,
    }),
  ]).catch(async (e) => {
    // A slow confirmation can throw even though the transaction landed; trust the chain.
    if (await conn.getAccountInfo(routerConfig())) return "(confirmed by reading the config account)";
    throw e;
  });
  console.log(`initialized: ${sig}`);
} else if (cmd === "fund") {
  const sol = Number(arg);
  if (!(sol > 0)) throw new Error("Usage: fund <SOL>");
  const sig = await send([SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: routerAuthority(), lamports: Math.round(sol * LAMPORTS_PER_SOL) })]);
  console.log(`funded: ${sig}`);
} else {
  const info = await conn.getAccountInfo(routerConfig());
  console.log(`program    ${ROUTER_ID.toBase58()}`);
  console.log(`authority  ${routerAuthority().toBase58()}  ${(await conn.getBalance(routerAuthority())) / LAMPORTS_PER_SOL} SOL`);
  if (!info) console.log("not initialized");
  else {
    const c = decodeRouterConfig(info.data);
    console.log(`split      ${c.charityBps / 100}% nonprofit, ${c.platformBps / 100}% platform, ${c.buybackBps / 100}% buyback`);
    console.log(`platform   ${c.platformWallet.toBase58()}${c.platformWallet.equals(platformWallet) ? "" : "  (≠ PLATFORM_WALLET in .env!)"}`);
    console.log(`buyback    ${c.buybackWallet.toBase58()}${c.buybackWallet.equals(buybackWallet.publicKey) ? "" : "  (≠ server buyback wallet!)"}`);
    console.log(`attester   ${c.attester.toBase58()}${c.attester.equals(authority.publicKey) ? "" : "  (≠ server key!)"}`);
    console.log(`cooldown   ${c.cooldownSecs / 86400} days`);
  }
}
