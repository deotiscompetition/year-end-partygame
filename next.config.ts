import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  const development = phase === PHASE_DEVELOPMENT_SERVER;
  const apiPort = Number(process.env.GAME_API_PORT ?? 8797);
  return {
    // Only development has a proxy; production remains a static Cloudflare export.
    ...(development
      ? { async rewrites() { return [{ source: "/api/:path*", destination: `http://127.0.0.1:${apiPort}/api/:path*` }]; } }
      : { output: "export" as const }),
    trailingSlash: true,
    images: { unoptimized: true },
  };
}
