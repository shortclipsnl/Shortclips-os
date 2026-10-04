import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import * as schema from "./schema";

/**
 * Eén schema, twee drivers.
 *
 *  - `pglite`   → ingebouwde Postgres (WASM) in `.data/pglite`. Geen installatie
 *                 nodig, ideaal voor ontwikkelen en tests. Het is echte
 *                 Postgres, dus dezelfde SQL en dezelfde migraties als productie.
 *  - `postgres` → gewone Postgres via `DATABASE_URL`, bijv. Supabase of Neon.
 *
 * De keuze staat in `DATABASE_DRIVER`. Is er een `DATABASE_URL`, dan wint die
 * automatisch, zodat productie nooit per ongeluk op PGlite draait.
 */
export type DatabaseDriver = "pglite" | "postgres";

/** Het type dat de rest van de applicatie gebruikt — driver-onafhankelijk. */
export type Db = NodePgDatabase<typeof schema>;

export function resolveDriver(): DatabaseDriver {
  const explicit = process.env.DATABASE_DRIVER?.toLowerCase();
  if (explicit === "pglite") return "pglite";
  if (explicit === "postgres") return "postgres";
  return process.env.DATABASE_URL ? "postgres" : "pglite";
}

export function pgliteDataDir(): string {
  return process.env.PGLITE_DATA_DIR
    ? path.resolve(process.env.PGLITE_DATA_DIR)
    : path.resolve(process.cwd(), ".data/pglite");
}

type Connection = { db: Db; raw: Pool | PGlite; driver: DatabaseDriver };

// Next herlaadt modules bij elke wijziging in dev. Zonder deze cache zou dat
// elke keer een nieuwe verbinding openen.
const globalCache = globalThis as unknown as { __shortclipsDb?: Connection };

function createConnection(): Connection {
  const driver = resolveDriver();

  if (driver === "postgres") {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL ontbreekt terwijl DATABASE_DRIVER=postgres. Vul .env.local aan, " +
          "of zet DATABASE_DRIVER=pglite om lokaal zonder Postgres te werken.",
      );
    }
    const pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      // Supabase/Neon vereisen TLS; lokaal kan het uit met DATABASE_SSL=false.
      ssl:
        process.env.DATABASE_SSL === "false"
          ? false
          : { rejectUnauthorized: false },
    });
    return { db: drizzlePg(pool, { schema }), raw: pool, driver };
  }

  const dataDir = pgliteDataDir();
  // PGlite maakt alleen de laatste map aan; de bovenliggende paden moeten bestaan.
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  return {
    db: drizzlePglite(client, { schema }) as unknown as Db,
    raw: client,
    driver,
  };
}

function connection(): Connection {
  return (globalCache.__shortclipsDb ??= createConnection());
}

/**
 * De Drizzle-instantie. Bewust lui: de verbinding wordt pas gelegd bij de
 * eerste query, zodat `next build` niet probeert te verbinden.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const instance = connection().db as unknown as Record<string | symbol, unknown>;
    const value = instance[prop];
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/** De onderliggende client (Pool of PGlite) — nodig voor migraties en health. */
export function rawClient(): Pool | PGlite {
  return connection().raw;
}

export function activeDriver(): DatabaseDriver {
  return connection().driver;
}

export { schema };
