import type { Metadata } from "next";

export const metadata: Metadata = { title: "Wallet", description: "Your FeeFlow wallet: log in with X to launch coins and receive payouts without connecting another wallet." };

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return children;
}
