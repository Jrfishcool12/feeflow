/** The whole flow as it happens on X: @feewardx tags the account a coin is named for, they reply with a recipient, the bot tags the recipient. */
const X = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="13" height="13">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

function Post({ bot, handle, name, children, reply }: { bot?: boolean; handle: string; name: string; children: React.ReactNode; reply?: string }) {
  return (
    <div className="xpost">
      <div className={`xav${bot ? " bot" : ""}`}>
        {bot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/feeward-icon.png" alt="" width={22} height={22} />
        ) : (
          handle[0].toUpperCase()
        )}
      </div>
      <div className="xbody">
        <div className="xhead">
          <b>{name}</b> <span>@{handle}</span>
        </div>
        {reply && <div className="xreply">Replying to {reply}</div>}
        <div className="xtext">{children}</div>
      </div>
    </div>
  );
}

export function XThread() {
  return (
    <div className="xthread" aria-label="Example thread on X">
      <div className="xbar">
        {X} <span>Example thread on X</span>
      </div>
      <Post bot handle="feewardx" name="Feeward">
        <a>@yourname</a> you were tagged on $COIN. Choose who gets its creator fees: you, a friend, a project, a cause or a charity.
        <br />
        <br />
        Reply with one @handle (or "me") or use feeward.app/c/…
      </Post>
      <Post handle="yourname" name="You" reply="@feewardx">
        <a>@feewardx</a> <a>@theirpick</a>
      </Post>
      <Post bot handle="feewardx" name="Feeward" reply="@yourname">
        <a>@yourname</a> selected <a>@theirpick</a> as $COIN's recipient.
        <br />
        <br />
        <a>@theirpick</a>: log in to accept and choose your wallet or a nonprofit, or reply with another @handle to pass it on.
      </Post>
      <Post bot handle="feewardx" name="Feeward">
        <a>@theirpick</a> the first payout from $COIN creator fees just landed in your wallet. Receipt: feeward.app/c/…
      </Post>
    </div>
  );
}
