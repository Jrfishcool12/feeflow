import type { NextConfig } from "next";

// The API server (../server). Requests to /api and /auth are proxied to it, so the site and
// the API share one origin and the X login cookie works without any CORS setup.
const backend = process.env.BACKEND_URL ?? "http://localhost:8787";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/auth/:path*", destination: `${backend}/auth/:path*` },
    ];
  },
};

export default config;
