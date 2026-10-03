import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap page-head" style={{ paddingBottom: 96 }}>
      <h1>Page not found</h1>
      <p className="sub">That page doesn't exist.</p>
      <Link href="/" className="btn btn-dark">Go home</Link>
    </div>
  );
}
