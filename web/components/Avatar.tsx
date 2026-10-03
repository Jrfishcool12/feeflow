/* eslint-disable @next/next/no-img-element */
"use client";
import { useState } from "react";

/** A round picture with a letter fallback (X avatars, token art). */
export function Avatar({ src, label, size = 42, square = false }: { src?: string | null; label: string; size?: number; square?: boolean }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, borderRadius: square ? Math.round(size * 0.22) : "50%", fontSize: Math.round(size * 0.4) };
  if (src && !broken)
    return <img src={src} alt="" width={size} height={size} style={{ ...style, objectFit: "cover", flex: "none", background: "var(--gray)" }} onError={() => setBroken(true)} loading="lazy" />;
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {(label.replace(/^[@$]/, "")[0] ?? "?").toUpperCase()}
    </span>
  );
}
