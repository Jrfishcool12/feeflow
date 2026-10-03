/**
 * The Pump SDKs' ESM builds import named exports from @coral-xyz/anchor that its
 * ESM entry doesn't provide, so load their CommonJS builds instead.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const pumpSdk = require("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");
export const pumpSwapSdk = require("@pump-fun/pump-swap-sdk") as typeof import("@pump-fun/pump-swap-sdk");
