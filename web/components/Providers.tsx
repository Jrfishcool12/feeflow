"use client";
import { PrivyProvider } from "@privy-io/react-auth";

/** Privy app for Feeward wallets. The app ID is public (it identifies the app; it isn't a secret). */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmus90r7101c30dl43tyfbylo";

/**
 * "Log in with X" creates a Feeward wallet: a Privy embedded Solana wallet. Its key is held by Privy's
 * key-sharing setup and the user; Feeward's servers never see it, and the user can export it any time.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["twitter"],
        appearance: {
          theme: "light",
          accentColor: "#315bff",
          // A copy of the logo with an explicit width and height (Privy sizes the logo from the file).
          logo: "/feeward-logo-privy.png",
          walletChainType: "solana-only",
          landingHeader: "Log in to Feeward",
          loginMessage: "Log in with X. Your Feeward wallet is created automatically.",
        },
        embeddedWallets: {
          solana: { createOnLogin: "all-users" },
          ethereum: { createOnLogin: "off" },
          // Feeward shows its own confirmation before every transaction.
          showWalletUIs: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
