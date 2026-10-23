import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Geen Next.js dev-indicator linksonder (ook niet lokaal); in productie is hij
  // sowieso weg.
  devIndicators: false,
  // Deze pakketten mogen niet gebundeld worden: pg opent native sockets en
  // PGlite laadt een WASM-bestand vanaf schijf.
  serverExternalPackages: ["pg", "@electric-sql/pglite", "mammoth", "ffmpeg-static", "ffprobe-static", "puppeteer-core", "@sparticuz/chromium"],
  // Het vermogensdashboard wordt op verzoek als los bestand uitgeleverd (fs),
  // dus de bestanden moeten mee in de serverless functies op Vercel.
  outputFileTracingIncludes: {
    "/dashboard/vermogen": ["./data/vermogen/vermogen_dashboard.html"],
    "/vermogen/vermogen-db-shim.js": ["./data/vermogen/vermogen-db-shim.js"],
  },
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
          // Dwingt de browser om dit domein altijd via HTTPS te benaderen
          // (voorkomt SSL-stripping). 2 jaar, inclusief subdomeinen.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
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
