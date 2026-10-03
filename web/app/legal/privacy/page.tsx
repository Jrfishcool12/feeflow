import type { Metadata } from "next";
import { Legal } from "@/components/Legal";

export const metadata: Metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <Legal title="Privacy policy" updated="October 3, 2026">
      <h2>What we collect</h2>
      <p>
        Public blockchain data about FeeFlow coins; public X profile information (handle, name, picture) for accounts tagged on coins; and, if you log in with X, your X user id and handle
        to confirm you're the account tagged on a coin. If you launch a coin, we store the wallet address that signed it.
      </p>
      <h2>What we don't collect</h2>
      <p>We don't receive your X password, can't post on your behalf, and don't ask for your email. Wallet signing happens in your wallet; we never see your keys.</p>
      <h2>Cookies</h2>
      <p>One cookie keeps you logged in after you log in with X. It expires after 7 days. There are no advertising or tracking cookies.</p>
      <h2>Public information</h2>
      <p>Coins, payouts, recipient and destination choices (including the X reply used to choose, and payout wallet addresses) are public on the site and on-chain. On-chain records can't be deleted by anyone.</p>
      <h2>Removing your name</h2>
      <p>If you're tagged on a coin, log in on its page and click "Remove my name", or contact @FeeFlowApp on X.</p>
      <h2>Service providers</h2>
      <p>We use hosting, Solana RPC and X's API to run the service. They process data only to provide those services.</p>
    </Legal>
  );
}
