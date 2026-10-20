/**
 * Migraties uitvoeren op de actieve driver.
 * Gebruik: `npm run db:migrate`
 *
 * Voor Postgres (productie/Supabase) gebruikt de migratie bij voorkeur
 * MIGRATE_DATABASE_URL en valt terug op DATABASE_URL. Reden: Supabase heeft twee
 * poolers. De live app (serverless) hoort op de Transaction pooler (poort 6543)
 * te draaien, maar daar lopen migraties op vast. Migraties hebben de Session
 * pooler (poort 5432) nodig. Door migraties een eigen URL te geven kan DATABASE_URL
 * op 6543 (runtime) en MIGRATE_DATABASE_URL op 5432 (migraties) staan.
 */
import path from "node:path";
import { resolveDriver } from "./client";

async function main() {
  const driver = resolveDriver();
  const folder = path.resolve(process.cwd(), "drizzle");

  console.log(`→ Migraties uitvoeren met driver "${driver}" vanuit ${folder}`);

  if (driver === "postgres") {
    const connectionString = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "MIGRATE_DATABASE_URL/DATABASE_URL ontbreekt terwijl DATABASE_DRIVER=postgres. " +
          "Zet de Supabase Session pooler (poort 5432) in MIGRATE_DATABASE_URL.",
      );
    }
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({
      connectionString,
      max: 1,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
    const dbm = drizzle(pool);
    await migrate(dbm, { migrationsFolder: folder });
    await pool.end();
  } else {
    const { db, rawClient } = await import("./client");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: folder });
    const raw = rawClient();
    if ("close" in raw && typeof raw.close === "function") await raw.close();
  }

  console.log("✓ Migraties voltooid.");
}

main().catch((error) => {
  console.error("✗ Migratie mislukt:", error);
  process.exit(1);
});
