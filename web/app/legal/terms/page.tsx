import type { Metadata } from "next";
import Link from "next/link";
import { Legal } from "@/components/Legal";

export const metadata: Metadata = { title: "Terms" };

export default function Terms() {
  return (
    <Legal title="Terms of use" updated="October 3, 2026">
      <p>These terms cover your use of the FeeFlow website and services. By using them you agree to these terms. If you don't agree, don't use FeeFlow.</p>
      <h2>What FeeFlow does</h2>
      <p>
        FeeFlow helps you launch Pump.fun coins, or connect coins you already launched, whose creator fees are routed to a recipient chosen by the X account tagged on the coin, and on to the recipient's wallet or a nonprofit. It does not hold your coins or wallet,
        and it can't reverse blockchain transactions.
      </p>
      <h2>Your responsibilities</h2>
      <p>
        You're responsible for the coins you launch or connect, their names, images and descriptions, and for complying with the laws that apply to you. Don't use FeeFlow to impersonate
        anyone, to imply that a person or organization endorses a coin, to harass anyone, or for anything unlawful. FeeFlow may hide any coin, name or content at its discretion.
      </p>
      <h2>Fee routing is permanent</h2>
      <p>
        Coins launched on FeeFlow, and coins whose fee sharing you lock to the FeeFlow treasury, route their creator fees as described in the <Link href="/docs">docs</Link>. You can't take
        those fees back. Read the docs before launching.
      </p>
      <h2>No warranties</h2>
      <p>
        FeeFlow is provided "as is", without warranties of any kind. It depends on third parties (Solana, Pump.fun, donate.gg, X) and may be unavailable, delayed or wrong. To the extent the
        law allows, FeeFlow isn't liable for losses arising from your use of it, including trading losses.
      </p>
      <h2>Changes</h2>
      <p>These terms may change. The date above shows the latest version; continued use means you accept it.</p>
      <p>See also the <Link href="/legal/disclosures">disclosures</Link> and <Link href="/legal/privacy">privacy policy</Link>.</p>
    </Legal>
  );
}
