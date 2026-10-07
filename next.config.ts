import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Geen Next.js dev-indicator linksonder (ook niet lokaal); in productie is hij
  // sowieso weg.
  devIndicators: false,
  // Deze pakketten mogen niet gebundeld worden: pg opent native sockets en
  // PGlite laadt een WASM-bestand vanaf schijf.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  experimental: {
    // Server actions krijgen soms grotere payloads (import-wizard, scripts).
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
