import type { Metadata } from "next";
import { Legal } from "@/components/Legal";

export const metadata: Metadata = { title: "Disclosures" };

export default function Disclosures() {
  return (
    <Legal title="Disclosures" updated="October 3, 2026">
      <h2 id="affiliation">Affiliation</h2>
      <p>FeeFlow is not affiliated with, endorsed by or sponsored by X Corp., Pump.fun, donate.gg, or any nonprofit listed on the site. Names and handles are used to identify them.</p>
      <h2>Choosers and recipients</h2>
      <p>
        A coin can tag any X account without asking it. That account (the chooser) chooses who receives the coin's fees (the recipient): any X account, including itself.
        Being tagged on a coin or chosen as a recipient does not mean an account endorses, promotes or has any connection to the coin. Recipients can receive funds in their own
        wallet, so a chooser or recipient may receive money from a coin's fees. FeeFlow confirms control of an X account by X login only; it does not verify identity beyond that or
        anyone's nonprofit status. Labels such as "cause" or "foundation" don't mean a registered nonprofit. A chooser can remove their name from FeeFlow's site and posts.
      </p>
      <h2>Choices and changes</h2>
      <p>
        The chooser picks a recipient once, on the website or by an X reply, and can't change it; deleting the reply doesn't undo it. Until a payout destination is set, the
        current recipient can pass the coin on to another X account, which can do the same; each pass is public. A payout destination is permanent once set. FeeFlow can't
        make any of these choices on anyone's behalf.
      </p>
      <h2>Coins</h2>
      <p>
        Memecoins are speculative, volatile and can lose all of their value. Nothing on FeeFlow is investment, financial, legal or tax advice, and nothing here is an offer or solicitation to
        buy any coin. Payouts a coin has made say nothing about its price or future.
      </p>
      <h2>Fees, support and donations</h2>
      <p>
        Every FeeFlow coin's creator fees split 90% to the recipient's payout destination, 5% to FeeFlow and 5% to buying back and burning the FeeFlow coin. These are shares of
        creator fees, not of trading volume or of what anyone pays for a coin. Payouts to a recipient's wallet are support, not charitable donations. Payouts to a nonprofit are
        delivered by donate.gg, which takes its own processing fee, so the nonprofit receives less than the 90% share. Buying a coin is not a charitable donation by you, and FeeFlow
        does not issue tax receipts.
      </p>
      <h2>Held funds and fallback</h2>
      <p>
        Until a recipient is chosen and sets a payout destination, the recipient share of a coin's fees is held in a treasury FeeFlow controls. Held amounts are shown on each coin's
        page and are released in public transactions to the destination the recipient sets. If the recipient declines, or no destination is set within 90 days of launch, held and
        future funds go to the fallback nonprofit shown on the coin's page. Held funds don't earn interest and aren't used for anything else.
      </p>
      <h2>Relayed coins</h2>
      <p>Fees of coins launched elsewhere pass through a treasury FeeFlow controls before they're forwarded. Every forward is published with its transaction.</p>
      <h2>The FeeFlow coin</h2>
      <p>
        The FeeFlow coin gates nothing: holding it gives no rights, no share of fees, no vote and no claim on FeeFlow. The buyback is a published mechanism, not a promise of value. FeeFlow
        may change or stop it.
      </p>
      <h2>FeeFlow wallets</h2>
      <p>
        Logging in with X can create a FeeFlow wallet: a Solana wallet provided by Privy. FeeFlow can't see, move or recover what's in it, and can't restore access if you lose
        your X account; you can export its key to another wallet at any time. Once exported, keeping the key safe is up to you. FeeFlow doesn't hold funds in these wallets.
      </p>
      <h2>Software</h2>
      <p>FeeFlow relies on Solana, Pump.fun and donate.gg, any of which can fail, change or pause. Smart contracts and software can contain bugs.</p>
    </Legal>
  );
}
