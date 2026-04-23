import type { NextConfig } from "next";

const rawBackend = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
const backendUrl = rawBackend.startsWith("http") ? rawBackend : `https://${rawBackend}`;

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
