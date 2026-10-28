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
    // De HTML wordt uitgeserveerd door de embed-route (/dashboard/vermogen/embed),
    // dus het databestand moet mee in díe serverless functie.
    "/dashboard/vermogen/embed": ["./data/vermogen/vermogen_dashboard.html"],
    "/vermogen/vermogen-db-shim.js": ["./data/vermogen/vermogen-db-shim.js"],
  },
  experimental: {
    // Server actions krijgen soms grotere payloads: de import-wizard en vooral
    // script-PDF's die als base64 worden verstuurd. Een PDF van ~15MB (de
    // bovengrens van het scriptreview-systeem) wordt als base64 ~20MB, dus de
    // limiet staat daarop afgestemd. (Het platform kan een eigen bovengrens
    // hebben; grote uploads landen pas als het hostingplan dat toelaat.)
    serverActions: { bodySizeLimit: "20mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // SAMEORIGIN i.p.v. DENY: het vermogensdashboard wordt same-origin in
          // een iframe geladen (/dashboard/vermogen → /dashboard/vermogen/embed).
          // Cross-origin framing (clickjacking) blijft geblokkeerd.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
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
