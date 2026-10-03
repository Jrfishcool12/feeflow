import type { Metadata } from "next";
import { DonationFeed } from "@/components/DonationFeed";

export const metadata: Metadata = { title: "Payouts" };

export default function Donations() {
  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <div className="page-head">
        <h1>Payouts</h1>
        <p className="sub">Every payout from every coin, newest first: support sent to a recipient's own wallet, or a donation to a nonprofit through donate.gg. Each one links to its on-chain receipt.</p>
      </div>
      <DonationFeed limit={40} />
    </div>
  );
}
