import { cfg } from "./config.js";
import { buildServer } from "./server.js";
import { startWorker } from "./worker.js";
import { authority } from "./chain.js";
import { db } from "./db.js";

const app = await buildServer();
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
console.log(`FeeFlow on ${cfg.PUBLIC_URL} — routing authority ${authority.publicKey.toBase58()}`);
startWorker();

// Redeploys stop the old instance with SIGTERM: close cleanly so it doesn't count as a crash.
let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  await app.close().catch(() => {});
  try {
    db.close();
  } catch {
    /* already closed */
  }
  process.exit(0);
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
