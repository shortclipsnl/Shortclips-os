/**
 * Migraties uitvoeren op de actieve driver.
 * Gebruik: `npm run db:migrate`
 */
import path from "node:path";
import { db, activeDriver, rawClient } from "./client";

async function main() {
  const driver = activeDriver();
  const folder = path.resolve(process.cwd(), "drizzle");

  console.log(`→ Migraties uitvoeren met driver "${driver}" vanuit ${folder}`);

  if (driver === "postgres") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder: folder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: folder });
  }

  console.log("✓ Migraties voltooid.");

  const raw = rawClient();
  if ("end" in raw && typeof raw.end === "function") await raw.end();
  if ("close" in raw && typeof raw.close === "function") await raw.close();
}

main().catch((error) => {
  console.error("✗ Migratie mislukt:", error);
  process.exit(1);
});
