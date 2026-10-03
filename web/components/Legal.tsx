export function Legal({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="wrap" style={{ padding: "56px 24px 96px" }}>
      <article className="prose">
        <h1>{title}</h1>
        <p className="muted small">Last updated {updated}</p>
        {children}
      </article>
    </div>
  );
}
