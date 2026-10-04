import type { NextConfig } from "next";

// The API server (../server). Requests to /api and /auth are proxied to it, so the site and
// the API share one origin and the X login cookie works without any CORS setup.
const backend = process.env.BACKEND_URL ?? "http://localhost:8787";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Old domain: once CANONICAL_HOST (e.g. feeward.app) is set, every other host redirects there, path included.
  async redirects() {
    const canonical = process.env.CANONICAL_HOST;
    if (!canonical) return [];
    return ["feeflow.io", "www.feeflow.io", `www.${canonical}`].map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: `https://${canonical}/:path*`,
      permanent: true,
    }));
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/auth/:path*", destination: `${backend}/auth/:path*` },
    ];
  },
};

export default config;
