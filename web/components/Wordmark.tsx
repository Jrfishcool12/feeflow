/* eslint-disable @next/next/no-img-element */
/** The Feeward logo (Relay mark + wordmark). `tone="light"` is the white-text version for dark surfaces. */
export function Wordmark({ className, title = "Feeward", tone = "dark" }: { className?: string; title?: string; tone?: "dark" | "light" }) {
  return <img className={`wordmark${className ? ` ${className}` : ""}`} src={tone === "light" ? "/feeward-logo-light.png" : "/feeward-logo.png"} alt={title} width={396} height={96} />;
}

/** Just the Relay mark. */
export function Mark({ className, title = "Feeward" }: { className?: string; title?: string }) {
  return <img className={className} src="/feeward-mark.png" alt={title} width={134} height={96} />;
}
