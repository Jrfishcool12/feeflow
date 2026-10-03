"use client";
import { useState } from "react";
import { useApi } from "@/lib/api";

/** The relay treasury address with a copy button. */
export function TreasuryAddress() {
  const { data } = useApi<{ enabled: boolean; treasury: string | null; line: string }>("/api/relay/info");
  const [copied, setCopied] = useState(false);
  if (!data) return <span className="muted">Loading address…</span>;
  if (!data.enabled || !data.treasury) return <span className="muted">Relayed coins aren't enabled on this server yet.</span>;
  return (
    <span className="copy-row">
      <span>{data.treasury}</span>
      <button className="btn btn-dark btn-sm" onClick={() => navigator.clipboard.writeText(data.treasury!).then(() => setCopied(true))}>
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
