/**
 * Fee routing on Pump.fun, built on its native donation escrow (DonationFeePda),
 * the same rail Pump.fun's Charity Coins use with donate.gg.
 *
 * Each coin launched here has the authority as its creator. Right after launch the
 * authority turns on fee sharing (becoming its admin) and points it at:
 *   - DonationFeePda(mint, charity config id): CHARITY_BPS (90% by default)
 *   - the platform wallet:                    PLATFORM_BPS (5%)
 *   - the buyback wallet:                     BUYBACK_BPS (5%), spent buying and burning the platform coin
 * When the honoree picks a charity, only the escrow changes. Nothing in this file
 * can route fees anywhere else; `expectedShares` is the single source of truth and
 * `audit` re-checks the live on-chain config against it.
 */
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT, createBurnCheckedInstruction, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import BN from "bn.js";
import { CHARITY_BPS, cfg } from "./config.js";
import { authority, budget, buybackWallet, conn, platformWallet, send, treasury } from "./chain.js";
import { pumpSdk, pumpSwapSdk } from "./sdk.js";
import { activateIx, attestation, coinRecord, createEscrowIx, enableSharingIx, feeAdmin, routerOn, setCharityIx } from "./router.js";

const {
  OnlinePumpSdk, PUMP_SDK, PUMP_FEE_PROGRAM_ID, DONATION_RELAY_PROGRAM_ID_MAINNET,
  bondingCurvePda, canonicalPumpPoolPda, donationFeePda, feeSharingConfigPda,
  getBuyTokenAmountFromSolAmount,
} = pumpSdk;
const pump = new OnlinePumpSdk(conn);

export type Share = { address: PublicKey; shareBps: number };

/**
 * The split a coin should have. `configId` null means the honoree hasn't chosen yet: the
 * nonprofit share is held in the FeeFlow treasury until they do.
 */
export function expectedShares(mint: PublicKey, configId: PublicKey | null): Share[] {
  return [
    { address: configId ? donationFeePda(mint, configId) : treasury().publicKey, shareBps: CHARITY_BPS },
    { address: platformWallet, shareBps: cfg.PLATFORM_BPS },
    { address: buybackWallet.publicKey, shareBps: cfg.BUYBACK_BPS },
  ].filter((s) => s.shareBps > 0);
}

/** What each address in a split is, for the public audit. */
export function roleOf(address: PublicKey, escrow: PublicKey | null): "charity" | "held" | "platform" | "buyback" | "unknown" {
  if (escrow && address.equals(escrow)) return "charity";
  if (address.equals(treasury().publicKey)) return "held";
  if (address.equals(platformWallet)) return "platform";
  if (address.equals(buybackWallet.publicKey)) return "buyback";
  return "unknown";
}

export async function readCurve(mint: PublicKey) {
  const info = await conn.getAccountInfo(bondingCurvePda(mint));
  return info ? PUMP_SDK.decodeBondingCurveNullable(info) : null;
}

export async function readSharing(mint: PublicKey) {
  const info = await conn.getAccountInfo(feeSharingConfigPda(mint));
  return info ? PUMP_SDK.decodeSharingConfig(info) : null;
}

// ---------- launch ----------

/**
 * Builds the launch transaction for the deployer's wallet to sign: create_v2 with the
 * authority as creator, plus an optional dev buy. We sign as the new mint; the deployer
 * signs as payer. Returns the message so the server can check the signed copy matches.
 */
export async function buildLaunch(p: { deployer: PublicKey; name: string; symbol: string; uri: string; devBuyLamports: number; mint?: Keypair }) {
  const mint = p.mint ?? Keypair.generate();
  const common = { mint: mint.publicKey, name: p.name, symbol: p.symbol, uri: p.uri, creator: feeAdmin(), user: p.deployer, mayhemMode: false };
  let ixs;
  if (p.devBuyLamports > 0) {
    const [global, feeConfig] = await Promise.all([pump.fetchGlobal(), pump.fetchFeeConfig()]);
    const solAmount = new BN(p.devBuyLamports);
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: solAmount, quoteMint: NATIVE_MINT });
    ixs = await PUMP_SDK.createV2AndBuyInstructions({ global, ...common, amount, solAmount });
  } else {
    ixs = [await PUMP_SDK.createV2Instruction(common)];
  }
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: p.deployer, recentBlockhash: blockhash, instructions: [...budget(300_000), ...ixs] }).compileToV0Message();
  // Left unsigned: the wallet signs first (Phantom flags transactions another key has already signed),
  // then the server adds the new coin's own signature when the signed transaction comes back.
  const tx = new VersionedTransaction(message);
  return {
    mint: mint.publicKey.toBase58(),
    mintSecret: Buffer.from(mint.secretKey).toString("base64"),
    tx: Buffer.from(tx.serialize()).toString("base64"),
    message: Buffer.from(message.serialize()).toString("base64"),
  };
}

// ---------- fee routing ----------

/**
 * Turns on fee sharing for a freshly launched coin and points it at the charity escrow.
 * Fees from trades before this runs land in the authority's own creator vault; we sweep
 * that into the new escrow first. (The authority creates every coin, so the vault is
 * shared, but setup runs seconds after launch and almost all of it belongs to this coin.)
 */
/**
 * Turns on fee sharing for a freshly launched coin and points it at the starting nonprofit.
 * Router mode: two router calls (enable_sharing, then activate). Key mode: the server key
 * does the same directly. Safe to retry: each step is skipped if already done.
 */
export async function setupRouting(mintStr: string, configIdStr: string, honoreeUserId: string, hold = true): Promise<string> {
  const mint = new PublicKey(mintStr);
  const configId = new PublicKey(configIdStr);
  // The deployed router program routes straight to an escrow; holding needs router v2.
  if (routerOn()) hold = false;
  const admin = feeAdmin();
  const curve = await readCurve(mint);
  if (!curve) throw new Error("Coin not found on-chain yet.");

  let sharing = await readSharing(mint);
  if (!sharing) {
    if (!curve.creator.equals(admin)) throw new Error("This coin wasn't launched on FeeFlow, so its fees can't be routed here.");
    const pool = curve.complete ? canonicalPumpPoolPda(mint) : null;
    const create = await PUMP_SDK.createFeeSharingConfig({ creator: admin, mint, pool });
    await send([routerOn() ? enableSharingIx(mint, create) : create]);
    sharing = await readSharing(mint);
    if (!sharing) throw new Error("Fee sharing config didn't appear after creation.");
  }

  const escrow = donationFeePda(mint, configId);
  const createEscrow = hold || (await conn.getAccountInfo(escrow))
    ? null
    : await PUMP_SDK.createDonationFeePda({ coinCreator: admin, mint, configId, quoteMint: NATIVE_MINT });
  const update = await PUMP_SDK.updateFeeShares({
    authority: admin,
    mint,
    currentShareholders: sharing.shareholders.map((s) => s.address),
    newShareholders: expectedShares(mint, hold ? null : configId),
  });

  if (routerOn()) {
    if (await conn.getAccountInfo(coinRecord(mint))) return "already-active";
    return send([activateIx(mint, configId, honoreeUserId, createEscrow, update)], 800_000);
  }
  const sig = await send([...(createEscrow ? [createEscrow] : []), update], 600_000);
  await sweepLaunchFees(escrow).catch((e) => console.error("sweep:", e.message));
  return sig;
}

/** Key mode only: moves fees sitting in the server key's own creator vault into an escrow. */
async function sweepLaunchFees(escrow: PublicKey) {
  const pending = (await pump.getCreatorVaultBalanceBothPrograms(authority.publicKey)).toNumber();
  if (pending < 1_000_000) return;
  const before = await conn.getBalance(authority.publicKey);
  await send(await pump.collectCoinCreatorFeeInstructions(authority.publicKey, authority.publicKey));
  const gained = (await conn.getBalance(authority.publicKey)) - before;
  if (gained > 10_000) await send([SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: escrow, lamports: gained })]);
}

/**
 * Points a live coin's fees at a different nonprofit. Pending fees are paid out to the
 * current split first. Router mode: the server signs an attestation for this exact coin,
 * honoree and nonprofit (valid 5 minutes), and the router program enforces the rest.
 */
export async function switchCharity(mintStr: string, fromConfig: string | null, toConfig: string, honoreeUserId: string): Promise<string> {
  const mint = new PublicKey(mintStr);
  const admin = feeAdmin();
  const sharing = await readSharing(mint);
  if (!sharing) throw new Error("Fee sharing isn't set up for this coin.");
  const ok = audit(mint, fromConfig ? new PublicKey(fromConfig) : null, sharing);
  if (!ok.ok) throw new Error(`Refusing to change routing that doesn't match our records: ${ok.problems.join("; ")}`);

  try {
    const min = await pump.getMinimumDistributableFee(mint, authority.publicKey);
    if (min.canDistribute) await send((await pump.buildDistributeCreatorFeesInstructions(mint, { payer: authority.publicKey })).instructions, 600_000);
  } catch {
    /* nothing to distribute */
  }

  const configId = new PublicKey(toConfig);
  let createEscrow = (await conn.getAccountInfo(donationFeePda(mint, configId)))
    ? null
    : await PUMP_SDK.createDonationFeePda({ coinCreator: admin, mint, configId, quoteMint: NATIVE_MINT });
  if (createEscrow && routerOn()) {
    // Escrow first, in its own transaction: with the attestation, both won't fit in one.
    await send([createEscrowIx(mint, configId, createEscrow)], 400_000);
    createEscrow = null;
  }
  const fresh = (await readSharing(mint)) ?? sharing;
  const update = await PUMP_SDK.updateFeeShares({
    authority: admin,
    mint,
    currentShareholders: fresh.shareholders.map((s) => s.address),
    newShareholders: expectedShares(mint, configId),
  });

  if (routerOn()) {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    // ~1,195 bytes of the 1,232 allowed, so no compute-budget instructions on this one.
    return send([attestation(mint, honoreeUserId, configId, expiresAt), setCharityIx(mint, configId, expiresAt, createEscrow, update)], null);
  }
  return send([...(createEscrow ? [createEscrow] : []), update], 800_000);
}

/** Pays out accrued fees to the split, then forwards each escrow to the donation relay. Both are permissionless. */
export async function crank(mintStr: string, configIds: string[]): Promise<string | null> {
  let last: string | null = null;
  const mint = new PublicKey(mintStr);
  try {
    const min = await pump.getMinimumDistributableFee(mint, authority.publicKey);
    if (min.canDistribute) await send((await pump.buildDistributeCreatorFeesInstructions(mint, { payer: authority.publicKey })).instructions, 600_000);
  } catch (e) {
    console.error(`distribute ${mintStr}:`, (e as Error).message);
  }
  for (const c of configIds) {
    const configId = new PublicKey(c);
    const escrow = donationFeePda(mint, configId);
    const info = await conn.getAccountInfo(escrow);
    if (!info) continue;
    const rent = await conn.getMinimumBalanceForRentExemption(info.data.length);
    const wsol = await conn.getTokenAccountsByOwner(escrow, { mint: NATIVE_MINT }).catch(() => ({ value: [] as any[] }));
    const wrapped = wsol.value.length ? Number((await conn.getTokenAccountBalance(wsol.value[0].pubkey)).value.amount) : 0;
    if (info.lamports - rent + wrapped < 5_000_000) continue; // not worth a transaction yet
    try {
      last = await send([await PUMP_SDK.crankDonationFeePda({ payer: authority.publicKey, mint, configId, donationRelayProgramId: DONATION_RELAY_PROGRAM_ID_MAINNET, quoteMint: NATIVE_MINT })], 400_000);
    } catch (e) {
      console.error(`crank escrow ${escrow.toBase58()}:`, (e as Error).message);
    }
  }
  return last;
}

/** Total donated through every escrow this coin has used, read from the escrows themselves. */
export async function donatedTotal(mintStr: string, configIds: string[]): Promise<number> {
  const mint = new PublicKey(mintStr);
  const infos = await conn.getMultipleAccountsInfo(configIds.map((c) => donationFeePda(mint, new PublicKey(c))));
  return infos.reduce((sum, info) => (info ? sum + PUMP_SDK.decodeDonationFeePda(info).totalDonated.toNumber() : sum), 0);
}

/** Checks the live on-chain split is exactly what we promise: our escrow for this charity + fixed platform cut. */
export function audit(mint: PublicKey, configId: PublicKey | null, sharing: { admin: PublicKey; shareholders: Share[] }) {
  const problems: string[] = [];
  if (!sharing.admin.equals(feeAdmin())) problems.push(`admin is ${sharing.admin.toBase58()}, not ${routerOn() ? "the FeeFlow router" : "our authority"}`);
  const want = expectedShares(mint, configId);
  const have = sharing.shareholders;
  const same = want.length === have.length && want.every((w) => have.some((h) => h.address.equals(w.address) && h.shareBps === w.shareBps));
  if (!same) problems.push(`split is ${have.map((h) => `${h.address.toBase58()}:${h.shareBps}`).join(", ")}`);
  return { ok: problems.length === 0, problems };
}

export async function auditLive(mintStr: string, configIdStr: string | null) {
  const mint = new PublicKey(mintStr);
  const sharing = await readSharing(mint);
  if (!sharing) return { ok: false, problems: ["fee sharing not set up yet"], shareholders: [] as { address: string; shareBps: number }[] };
  const configId = configIdStr ? new PublicKey(configIdStr) : null;
  const res = audit(mint, configId, sharing);
  const escrow = configId ? donationFeePda(mint, configId) : null;
  return {
    ...res,
    admin: sharing.admin.toBase58(),
    shareholders: sharing.shareholders.map((s) => ({ address: s.address.toBase58(), shareBps: s.shareBps, role: roleOf(s.address, escrow) })),
  };
}

/** Every donation escrow on Pump.fun, grouped by donate.gg config id. Used to discover charity ids. */
export async function discoverConfigs() {
  const disc = (await import("node:crypto")).createHash("sha256").update("account:DonationFeePda").digest().subarray(0, 8);
  const accts = await conn.getProgramAccounts(PUMP_FEE_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: (await import("bs58")).default.encode(disc) } }],
  });
  const by = new Map<string, { coins: number; donated: number }>();
  for (const a of accts) {
    const d = PUMP_SDK.decodeDonationFeePda(a.account);
    const k = d.configId.toBase58();
    const cur = by.get(k) ?? { coins: 0, donated: 0 };
    by.set(k, { coins: cur.coins + 1, donated: cur.donated + d.totalDonated.toNumber() });
  }
  return [...by.entries()].map(([configId, v]) => ({ configId, ...v })).sort((a, b) => b.donated - a.donated);
}

// =====================================================================
// Relay mode: existing coins route 100% of creator fees to a per-coin vault
// we hold. We forward the vault to the honoree's charity, through donation
// escrows on the house coin (HOUSE_MINT, a coin our authority administers),
// because only a coin's own admin can create escrows for that coin.
// =====================================================================

const { hasCoinCreatorMigratedToSharingConfig, isSharingConfigEditable, isSolLikeQuoteMint } = pumpSdk;

export class RoutingError extends Error {
  statusCode = 422;
}

const isSolQuote = (q: PublicKey) => q.equals(PublicKey.default) || q.equals(NATIVE_MINT) || isSolLikeQuoteMint(q);

/** Confirms 100% of the coin's creator fees permanently go to `vault`. */
export async function verifyRelayRouting(mintStr: string, vaultStr: string): Promise<"direct" | "sharing"> {
  const mint = new PublicKey(mintStr);
  const vault = new PublicKey(vaultStr);
  const curve = await readCurve(mint);
  if (!curve) throw new RoutingError("No Pump.fun coin found at that mint address.");
  if (curve.isHolderReward) throw new RoutingError("This is a holder rewards coin. Its creator fees go to holders, so they can't be donated.");
  if (curve.isCashbackCoin) throw new RoutingError("Cashback coins don't pay creator fees.");
  if (!isSolQuote(curve.quoteMint)) throw new RoutingError("Only SOL-paired coins are supported right now.");
  if (curve.creator.equals(vault)) return "direct";

  if (hasCoinCreatorMigratedToSharingConfig({ mint, creator: curve.creator })) {
    const sharing = await readSharing(mint);
    if (!sharing) throw new RoutingError("Fee sharing config not found.");
    const h = sharing.shareholders;
    if (!(h.length === 1 && h[0].address.equals(vault) && h[0].shareBps === 10_000))
      throw new RoutingError(`Fee sharing must send 100% to ${vaultStr}, with no other recipients.`);
    if (isSharingConfigEditable({ sharingConfig: sharing }))
      throw new RoutingError("Fee sharing points at the relay vault but isn't locked yet. Lock it so fees can't be redirected later.");
    return "sharing";
  }
  throw new RoutingError(`Creator fees still go to ${curve.creator.toBase58()}. Set fee sharing to 100% to the relay vault and lock it.`);
}

/** Creator fees earned by a relay coin but not yet in its vault. */
export async function relayPending(mintStr: string, vaultStr: string, routing: "direct" | "sharing") {
  const creator = routing === "direct" ? new PublicKey(vaultStr) : feeSharingConfigPda(new PublicKey(mintStr));
  return (await pump.getCreatorVaultBalanceBothPrograms(creator)).toNumber();
}

/** Pulls a relay coin's accrued fees into its vault. */
export async function harvestRelay(mintStr: string, vault: Keypair, routing: "direct" | "sharing") {
  if (routing === "direct") return send(await pump.collectCoinCreatorFeeInstructions(vault.publicKey, authority.publicKey), 400_000, [vault]);
  const { instructions } = await pump.buildDistributeCreatorFeesInstructions(new PublicKey(mintStr), { payer: authority.publicKey });
  return send(instructions, 600_000);
}

const house = () => {
  if (!cfg.HOUSE_MINT) throw new Error("Relay mode is off (HOUSE_MINT not set).");
  return new PublicKey(cfg.HOUSE_MINT);
};

/** The house coin's donation escrow for a charity, created on first use. */
export async function houseEscrow(configIdStr: string): Promise<PublicKey> {
  const mint = house();
  const configId = new PublicKey(configIdStr);
  const escrow = donationFeePda(mint, configId);
  if (!(await conn.getAccountInfo(escrow))) {
    const sharing = await readSharing(mint);
    const admin = sharing?.admin ?? authority.publicKey;
    const create = await PUMP_SDK.createDonationFeePda({ coinCreator: admin, mint, configId, quoteMint: NATIVE_MINT });
    await send([routerOn() && admin.equals(feeAdmin()) ? createEscrowIx(mint, configId, create) : create]);
  }
  return escrow;
}

/**
 * Forwards a relay vault's balance: the platform cut and the charity share in one
 * transaction, so both happen or neither does. Bare SOL sent to an escrow is wrapped
 * and passed to the donation relay when the escrow is cranked.
 */
export async function forwardRelay(vault: Keypair, configIdStr: string, spendable: number) {
  const escrow = await houseEscrow(configIdStr);
  const platform = Math.floor((spendable * cfg.PLATFORM_BPS) / 10_000);
  const buyback = Math.floor((spendable * cfg.BUYBACK_BPS) / 10_000);
  const donation = spendable - platform - buyback;
  const ixs = [SystemProgram.transfer({ fromPubkey: vault.publicKey, toPubkey: escrow, lamports: donation })];
  if (platform > 0) ixs.push(SystemProgram.transfer({ fromPubkey: vault.publicKey, toPubkey: platformWallet, lamports: platform }));
  if (buyback > 0) ixs.push(SystemProgram.transfer({ fromPubkey: vault.publicKey, toPubkey: buybackWallet.publicKey, lamports: buyback }));
  const signature = await send(ixs, 200_000, [vault]);
  return { signature, donation, platform, buyback };
}

/**
 * Sends a split from `from` in one transaction: `donation` to `dest`, plus the platform and
 * buyback shares. Any part can be zero. Returns null if there was nothing to send.
 */
export async function sendSplit(from: Keypair, dest: PublicKey | null, donation: number, platform: number, buyback: number) {
  const ixs = [];
  if (donation > 0) {
    if (!dest) throw new Error("No destination for the donation.");
    ixs.push(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: dest, lamports: donation }));
  }
  if (platform > 0) ixs.push(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: platformWallet, lamports: platform }));
  if (buyback > 0) ixs.push(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: buybackWallet.publicKey, lamports: buyback }));
  return ixs.length ? send(ixs, 200_000, [from]) : null;
}

/** A launched coin's own donation escrow for a nonprofit, created if needed (we administer launched coins). */
export async function coinEscrow(mintStr: string, configIdStr: string): Promise<PublicKey> {
  const mint = new PublicKey(mintStr);
  const configId = new PublicKey(configIdStr);
  const escrow = donationFeePda(mint, configId);
  if (!(await conn.getAccountInfo(escrow))) {
    const admin = feeAdmin();
    const create = await PUMP_SDK.createDonationFeePda({ coinCreator: admin, mint, configId, quoteMint: NATIVE_MINT });
    await send([routerOn() ? createEscrowIx(mint, configId, create) : create]);
  }
  return escrow;
}

/** Is the house coin set up so our authority can create escrows on it? */
export async function checkHouse(): Promise<string | null> {
  if (!cfg.HOUSE_MINT) return null;
  const mint = house();
  const curve = await readCurve(mint);
  if (!curve) return `HOUSE_MINT ${cfg.HOUSE_MINT} isn't a Pump.fun coin.`;
  const sharing = await readSharing(mint);
  const ours = (k: PublicKey) => k.equals(authority.publicKey) || k.equals(feeAdmin());
  if (sharing && ours(sharing.admin)) return null;
  if (!sharing && ours(curve.creator)) return null;
  return `HOUSE_MINT must be a coin launched through this site (our authority must be its creator or fee-sharing admin).`;
}

export const coinExists = async (mintStr: string) => !!(await conn.getAccountInfo(bondingCurvePda(new PublicKey(mintStr))));


// ---------- platform coin buy-and-burn ----------

const { OnlinePumpAmmSdk, PUMP_AMM_SDK } = pumpSwapSdk;
const amm = new OnlinePumpAmmSdk(conn);

/**
 * Spends `lamports` from `buyer` on `mintStr` and burns every token bought.
 * Bonding-curve coins buy on the curve; graduated coins buy on PumpSwap through the SDK,
 * which prices against effective quote reserves (including negative virtual reserves).
 */
export async function buyAndBurn(mintStr: string, buyer: Keypair, lamports: number, slippagePct = 5) {
  const mint = new PublicKey(mintStr);
  const quote = new BN(lamports);
  const mintInfo = await conn.getAccountInfo(mint);
  if (!mintInfo) throw new Error(`Mint ${mintStr} not found`);
  const tokenProgram = mintInfo.owner;
  const curve = await readCurve(mint);
  if (!curve) throw new Error(`${mintStr} isn't a Pump.fun coin`);

  let buySig: string;
  if (!curve.complete) {
    const [global, feeConfig, state] = await Promise.all([pump.fetchGlobal(), pump.fetchFeeConfig(), pump.fetchBuyState(mint, buyer.publicKey, tokenProgram)]);
    const supply = (await getMint(conn, mint, "confirmed", tokenProgram)).supply;
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: new BN(supply.toString()), bondingCurve: state.bondingCurve, amount: quote, quoteMint: state.quoteMint });
    const ixs = await PUMP_SDK.buyV2Instructions({
      global, bondingCurveAccountInfo: state.bondingCurveAccountInfo, bondingCurve: state.bondingCurve,
      associatedUserAccountInfo: state.associatedUserAccountInfo, mint, user: buyer.publicKey,
      amount, quoteAmount: quote, slippage: slippagePct, tokenProgram, quoteTokenProgram: state.quoteTokenProgram,
    });
    buySig = await send(ixs, 400_000, [buyer]);
  } else {
    const state = await amm.swapSolanaState(canonicalPumpPoolPda(mint), buyer.publicKey);
    buySig = await send(await PUMP_AMM_SDK.buyQuoteInput(state, quote, slippagePct), 400_000, [buyer]);
  }

  const ata = getAssociatedTokenAddressSync(mint, buyer.publicKey, false, tokenProgram);
  const bal = await conn.getTokenAccountBalance(ata, "confirmed");
  const raw = BigInt(bal.value.amount);
  if (raw === 0n) return { buySig, burnSig: null as string | null, burned: 0n };
  const burnSig = await send([createBurnCheckedInstruction(ata, mint, buyer.publicKey, raw, bal.value.decimals, [], tokenProgram)], 200_000, [buyer]);
  return { buySig, burnSig, burned: raw };
}
