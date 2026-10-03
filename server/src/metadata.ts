import { cfg } from "./config.js";

const PINATA = "https://api.pinata.cloud/pinning";

function readImage(imageDataUrl: string) {
  const m = imageDataUrl.match(/^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/);
  if (!m) throw Object.assign(new Error("Use a PNG, JPG, GIF or WebP image."), { statusCode: 400 });
  const bytes = Buffer.from(m[3], "base64");
  if (bytes.length > 2_000_000) throw Object.assign(new Error("Keep the image under 2 MB."), { statusCode: 400 });
  return { bytes, type: m[1], ext: m[2] };
}

/**
 * Uploads the coin image and its Pump.fun-style metadata JSON to IPFS. Returns the metadata URI.
 * Uses Pinata when PINATA_JWT is set; otherwise Pump.fun's own upload endpoint (no account needed).
 */
export async function pinMetadata(p: { name: string; symbol: string; description: string; imageDataUrl: string }) {
  const { bytes, type, ext } = readImage(p.imageDataUrl);
  return cfg.PINATA_JWT ? viaPinata(p, bytes, type, ext) : viaPump(p, bytes, type, ext);
}

async function viaPump(p: { name: string; symbol: string; description: string }, bytes: Buffer, type: string, ext: string) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), `${p.symbol}.${ext}`);
  form.append("name", p.name);
  form.append("symbol", p.symbol);
  form.append("description", p.description);
  form.append("website", cfg.PUBLIC_URL);
  form.append("showName", "true");
  const r = await fetch("https://pump.fun/api/ipfs", { method: "POST", body: form });
  if (!r.ok) throw new Error(`Image upload failed (${r.status}). Try again, or set PINATA_JWT in .env.`);
  const j = (await r.json()) as { metadataUri?: string };
  if (!j.metadataUri) throw new Error("Image upload didn't return a metadata link. Try again, or set PINATA_JWT in .env.");
  return j.metadataUri;
}

async function viaPinata(p: { name: string; symbol: string; description: string }, bytes: Buffer, type: string, ext: string) {
  const auth = { Authorization: `Bearer ${cfg.PINATA_JWT}` };
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), `${p.symbol}.${ext}`);
  const img = await fetch(`${PINATA}/pinFileToIPFS`, { method: "POST", headers: auth, body: form });
  if (!img.ok) throw new Error(`Image upload failed (${img.status})`);
  const imageHash = ((await img.json()) as { IpfsHash: string }).IpfsHash;

  const meta = await fetch(`${PINATA}/pinJSONToIPFS`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      pinataContent: {
        name: p.name,
        symbol: p.symbol,
        description: p.description,
        image: `https://ipfs.io/ipfs/${imageHash}`,
        showName: true,
        website: cfg.PUBLIC_URL,
      },
    }),
  });
  if (!meta.ok) throw new Error(`Metadata upload failed (${meta.status})`);
  return `https://ipfs.io/ipfs/${((await meta.json()) as { IpfsHash: string }).IpfsHash}`;
}
