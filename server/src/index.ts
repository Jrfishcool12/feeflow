import { cfg } from "./config.js";
import { buildServer } from "./server.js";
import { startWorker } from "./worker.js";
import { authority } from "./chain.js";

const app = await buildServer();
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
console.log(`FeeFlow on ${cfg.PUBLIC_URL} — routing authority ${authority.publicKey.toBase58()}`);
startWorker();
