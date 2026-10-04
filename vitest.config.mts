import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // PGlite ondersteunt één schrijver tegelijk, dus geen parallelle bestanden.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 180000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // `server-only` bestaat om per ongeluk gebruik in de browser te
      // voorkomen. In tests draaien we sowieso op de server.
      "server-only": path.resolve(import.meta.dirname, "./tests/helpers/server-only.ts"),
    },
  },
});
