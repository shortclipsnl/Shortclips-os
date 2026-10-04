import { defineConfig } from "drizzle-kit";

/**
 * Migraties worden altijd als gewone Postgres-SQL gegenereerd. Dezelfde
 * bestanden draaien op PGlite (lokaal) en op Supabase/Postgres (productie).
 */
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/shortclips_os",
  },
  verbose: true,
  strict: true,
});
