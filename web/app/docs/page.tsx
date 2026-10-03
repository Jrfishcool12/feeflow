import type { Metadata } from "next";
import Link from "next/link";
import { TreasuryAddress } from "@/components/TreasuryAddress";

export const metadata: Metadata = { title: "Docs", description: "How FeeFlow routes a coin's creator fees: the account tagged on a coin chooses a recipient, who chooses their wallet or a nonprofit." };

const toc: [string, string][] = [
  ["overview", "Overview"],
  ["two-ways", "Two ways in"],
  ["direct", "Launching on FeeFlow"],
  ["relayed", "A coin you already launched"],
  ["naming", "Tagging the chooser"],
  ["roles", "Chooser, recipient, payout destination"],
  ["choosing", "Choosing the recipient"],
  ["routing", "Accepting and routing"],
  ["fallback", "Fallback"],
  ["split", "The 90/5/5 split"],
  ["receipts", "Statuses, receipts and posts"],
  ["buyback", "The FeeFlow coin buyback"],
  ["not-registering", "If a coin isn't registering"],
  ["glossary", "Glossary"],
];

const H = ({ id, n, children }: { id: string; n: number; children: React.ReactNode }) => (
  <h2 id={id}>
    <span className="num">{n}</span>
    {children}
  </h2>
);

export default function Docs() {
  return (
    <div className="wrap docs">
      <nav className="toc" aria-label="Contents">
        {toc.map(([id, label], i) => (
          <a key={id} href={`#${id}`}>
            {i + 1}. {label}
          </a>
        ))}
      </nav>
      <article className="prose">
        <h1>How FeeFlow works</h1>
        <p>
          FeeFlow is transparent funding through coin creator fees. A coin tags an X account; that account chooses who receives 90% of its creator fees: themselves, a
          creator, a project, a cause, a foundation, a community or a nonprofit. The recipient chooses where the money goes, their own wallet or a nonprofit on donate.gg, and
          every payout is a public transaction.
        </p>
        <p>
          FeeFlow's code is public: <a href="https://github.com/Jrfishcool12/feeflow" target="_blank" rel="noopener">github.com/Jrfishcool12/feeflow</a>. The fee split, payouts, wallet checks and X-reply handling
          described below are all in it, so you can check that the code does what these docs say.
        </p>

        <H id="overview" n={1}>Overview</H>
        <p>A coin on Pump.fun earns creator fees on every trade. On a FeeFlow coin those fees are split three ways, every time:</p>
        <dl className="facts">
          <dt>To the recipient's wallet or nonprofit</dt><dd>90%</dd>
          <dt>To FeeFlow</dt><dd>5%</dd>
          <dt>Buys and burns the FeeFlow coin</dt><dd>5%</dd>
        </dl>
        <p>
          These are shares of the creator fees, the small fee Pump.fun pays a coin's creator on each trade. They aren't shares of trading volume or of what anyone spends buying
          the coin. When the recipient routes to a nonprofit, donate.gg delivers the donation and charges its own processing fee, so the nonprofit receives a little less than 90%.
        </p>

        <H id="two-ways" n={2}>Two ways in</H>
        <dl className="facts">
          <dt>Direct</dt><dd>Launched on FeeFlow. The split is set at launch and locked by Pump.fun; the recipient share goes through the FeeFlow treasury.</dd>
          <dt>Relayed</dt><dd>Launched anywhere on Pump.fun. Fees go to the FeeFlow treasury first and are forwarded in public.</dd>
        </dl>
        <p>The split, the receipts and the roles are the same either way. Every coin is labeled Direct or Relayed.</p>

        <H id="direct" n={3}>Launching on FeeFlow</H>
        <ol className="steps-num">
          <li><span><b>Fill in the coin</b>Name, ticker, image and the X account to tag, on the <Link href="/launch">launch page</Link>.</span></li>
          <li><span><b>Sign in your wallet</b>Your wallet signs the Pump.fun launch.</span></li>
          <li><span><b>Routing switches on</b>Seconds later, fee sharing is set: the recipient share is held in the FeeFlow treasury, and the FeeFlow and buyback shares go out as usual. The coin page shows the split checked on-chain, and @FeeFlowApp tags that account on X.</span></li>
        </ol>
        <p>You don't earn creator fees from a FeeFlow coin. A dev buy is optional.</p>

        <H id="relayed" n={4}>A coin you already launched</H>
        <p>No sign-up and no approval. A coin that meets these three conditions registers on its own:</p>
        <ol className="steps-num">
          <li><span><b>Send 100% of fees to the FeeFlow treasury</b>On the coin's Pump.fun page, open fee sharing and add this address at 100%, with no other recipients:</span></li>
        </ol>
        <p><TreasuryAddress /></p>
        <ol className="steps-num" start={2} style={{ counterReset: "s 1" }}>
          <li><span><b>Lock it</b>Revoke the fee-sharing authority on Pump.fun. A coin whose fees could still be redirected is detected but not registered.</span></li>
          <li><span><b>Tag the chooser</b>Add the line in section 5 to the coin's description.</span></li>
        </ol>
        <p>
          Why 100% and locked: a partial share would mean the public totals are a fraction of what the coin earned with no way to tell, and a direction that can still be changed is a
          promise that can still be withdrawn. To see what a coin still needs, use <Link href="/launch?tab=existing">Check a coin</Link>.
        </p>

        <H id="naming" n={5}>Tagging the chooser</H>
        <p>For relayed coins, the X account is read from the coin's description. Put this line in it:</p>
        <code className="line">Fees to @handle via FeeFlow</code>
        <p>Write anything else you like around the line. For direct coins you name the account on the launch page instead.</p>
        <p>
          The account doesn't need to agree, know in advance, hold a wallet or have an account here. Being tagged doesn't mean they endorsed the coin, and FeeFlow says so on the coin's
          page and in its posts.
        </p>

        <H id="roles" n={6}>Chooser, recipient, payout destination</H>
        <dl className="facts">
          <dt>Chooser</dt><dd>The X account tagged on the coin. Chooses the recipient, once.</dd>
          <dt>Recipient</dt><dd>Any X account the chooser picks, including the chooser. Accepts and chooses where funds go, or declines.</dd>
          <dt>Payout destination</dt><dd>The recipient's own wallet (support) or a nonprofit on donate.gg (a donation). Chosen once.</dd>
        </dl>
        <p>
          A cause, foundation, community or project is represented by whatever X account the chooser picks. Those labels don't mean the account is a registered nonprofit: FeeFlow
          confirms who controls an X account by X login and doesn't verify nonprofit status. Accounts are recorded by their permanent X id, so a renamed account or a handle that
          changes hands can't redirect funds to someone else.
        </p>

        <H id="choosing" n={7}>Choosing the recipient</H>
        <p>The chooser picks one of two ways:</p>
        <ol className="steps-num">
          <li><span><b>Reply on X</b>Reply to @FeeFlowApp's post about the coin with the recipient's @handle, or "me". FeeFlow checks the reply came from the chooser's account, matches it to the coin, looks the handle up, and replies naming the exact account it locked. A reply with several handles, a handle that doesn't exist or unclear wording gets a request to try again instead.</span></li>
          <li><span><b>On the website</b>Log in with X on the coin's page, type the handle, check the account it resolves to, and confirm. Useful for protected accounts, or if you'd rather not reply publicly.</span></li>
        </ol>
        <p>
          <b>The choice is permanent.</b> Once a recipient is locked, nobody can replace it, including the chooser. Deleting a selection reply doesn't undo the choice or reverse
          payouts. A reply chooses the recipient for that one coin only.
        </p>

        <H id="routing" n={8}>Accepting and routing</H>
        <p>The recipient logs in with X on the coin's page and chooses one destination:</p>
        <dl className="facts">
          <dt>Their wallet</dt><dd>They connect it and sign a message proving they own it (no transaction, no fee). Payments are support, not donations.</dd>
          <dt>A nonprofit</dt><dd>Any nonprofit on donate.gg's onboarded list. donate.gg delivers it; the nonprofit doesn't need a FeeFlow account.</dd>
          <dt>Decline</dt><dd>Funds go to the fallback nonprofit instead.</dd>
        </dl>
        <p>
          <b>The destination is permanent.</b> Once set, it can't be changed. Everything held for the coin is sent there right away, and every fee after that follows. Until the
          recipient acts, the coin's page says funds are awaiting the recipient; nothing is described as paid until there's a transaction.
        </p>

        <H id="fallback" n={9}>Fallback</H>
        <p>
          If the recipient declines, or no payout destination is set within 90 days of launch, the recipient share goes to the fallback nonprofit: what's held, and every fee after
          that. The fallback is shown on every coin's page before and after it applies, and the payout receipt says when it was used.
        </p>

        <H id="split" n={10}>The 90/5/5 split</H>
        <dl className="facts">
          <dt>Applied</dt><dd>To every creator fee, on every coin, whatever the destination</dd>
          <dt>Direct coins</dt><dd>Pump.fun's fee sharing pays all three at once; the recipient share goes through the FeeFlow treasury</dd>
          <dt>Relayed coins</dt><dd>Each payout pays all three in one transaction</dd>
          <dt>Changed by</dt><dd>Nobody. Pump.fun locks a coin's split after it's set</dd>
        </dl>
        <p>
          Before a destination is set, the recipient share is held in the FeeFlow treasury and recorded against the coin it came from, read from each payout transaction. Failed
          transactions create no payout and are retried; funds stay where they are in the meantime.
        </p>

        <H id="receipts" n={11}>Statuses, receipts and posts</H>
        <dl className="facts">
          <dt>Awaiting recipient selection</dt><dd>The chooser hasn't picked a recipient.</dd>
          <dt>Awaiting recipient routing selection</dt><dd>The recipient is locked but hasn't accepted and chosen a destination.</dd>
          <dt>Routing active</dt><dd>A payout destination is set.</dd>
          <dt>Recipient declined</dt><dd>The recipient said no; funds go to the fallback.</dd>
          <dt>Fallback activated</dt><dd>The fallback nonprofit is receiving the funds.</dd>
          <dt>Payment completed</dt><dd>Shown per payout, with its public transaction.</dd>
        </dl>
        <p>
          Every payout appears in the public <Link href="/donations">payout feed</Link> and on its coin's page with its transaction, along with a record of who chose what and when.
          @FeeFlowApp posts milestones with a receipt card. Wallet payouts are called support; donate.gg payouts are called donations.
        </p>

        <H id="buyback" n={12}>The FeeFlow coin buyback</H>
        <p>
          5% of fees goes to the buyback wallet. At a random moment between 5 minutes and an hour after the last attempt, it buys the FeeFlow coin on the open market and burns everything it
          bought. Random timing means nobody can trade around it. The coin gates nothing. See <Link href="/buyback">Buyback</Link> and <Link href="/legal/disclosures">Disclosures</Link>.
        </p>

        <H id="not-registering" n={13}>If a coin isn't registering</H>
        <dl className="facts">
          <dt>Not the whole fee</dt><dd>The treasury gets a partial share. It has to be 100%.</dd>
          <dt>Not locked</dt><dd>Fee sharing can still be edited. Revoke its authority on Pump.fun.</dd>
          <dt>Wrong address</dt><dd>Fees go to an address that isn't the FeeFlow treasury.</dd>
          <dt>No handle line</dt><dd>The description doesn't contain "Fees to @handle via FeeFlow".</dd>
          <dt>Handle not found</dt><dd>The tagged account doesn't exist on X.</dd>
          <dt>Wrong coin type</dt><dd>Holder-rewards and cashback coins don't pay creator fees.</dd>
          <dt>Too recent</dt><dd>The indexer runs every few minutes. Check the coin to register it right away.</dd>
        </dl>

        <H id="glossary" n={14}>Glossary</H>
        <dl className="facts">
          <dt>Creator fees</dt><dd>What Pump.fun pays a coin's creator from trading in that coin.</dd>
          <dt>Chooser</dt><dd>The X account tagged on a coin. Picks the recipient once.</dd>
          <dt>Recipient</dt><dd>The X account that receives the coin's fees and chooses where they go.</dd>
          <dt>Payout destination</dt><dd>The recipient's verified wallet or a donate.gg nonprofit.</dd>
          <dt>Support</dt><dd>A payout to a recipient's wallet.</dd>
          <dt>Donation</dt><dd>A payout to a nonprofit through donate.gg.</dd>
          <dt>Treasury</dt><dd>Where the recipient share is held until a destination is set, and where relayed coins send fees.</dd>
          <dt>Fallback nonprofit</dt><dd>Where funds go if the recipient declines or no destination is set within 90 days.</dd>
          <dt>Fee sharing</dt><dd>Pump.fun's setting that splits creator fees across up to ten addresses.</dd>
        </dl>
      </article>
    </div>
  );
}
