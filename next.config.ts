import type { NextConfig } from "next";
import os from "os";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";

// In dev, Next.js blocks requests to dev resources (/_next/static chunks) from
// origins other than localhost. When the app is opened from a phone/tablet via
// the computer's LAN IP, the browser origin is that IP, so the JS never loads
// and the app appears broken after login. Allow every non-internal IPv4 of this
// machine (plus common loopback origins) so LAN devices work without hardcoding
// a single IP that may change.
const lanOrigins = Object.values(os.networkInterfaces())
  .flat()
  .filter(
    (i): i is os.NetworkInterfaceInfo =>
      !!i && i.family === "IPv4" && !i.internal
  )
  .map((i) => i.address);

const allowedDevOrigins = Array.from(
  new Set([
    ...lanOrigins,
    ...(process.env.ALLOWED_DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
    "localhost",
    "127.0.0.1",
  ])
);

const nextConfig: NextConfig = {
  allowedDevOrigins,
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
