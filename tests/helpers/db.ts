import fs from "node:fs";
import path from "node:path";

type Cached = { raw?: { close?: () => Promise<void>; end?: () => Promise<void> } };

/**
 * Verse testdatabase.
 *
 * De databaseverbinding wordt in productie bewust op `globalThis` bewaard zodat
 * hot reload geen verbindingen lekt. In tests moeten we die cache juist
 * opruimen, anders hergebruikt de tweede suite een gesloten verbinding.
 */
export async function freshDatabase() {
  await closeDatabase();

  const global = globalThis as unknown as { __shortclipsDb?: Cached };
  delete global.__shortclipsDb;

  const dir = path.resolve(process.cwd(), ".data/test-pglite");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const { db } = await import("@/db/client");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(db as any, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });

  return db;
}

export async function closeDatabase() {
  const global = globalThis as unknown as { __shortclipsDb?: Cached };
  const raw = global.__shortclipsDb?.raw;
  if (!raw) return;
  try {
    await raw.close?.();
    await raw.end?.();
  } catch {
    // Al gesloten: prima.
  }
  delete global.__shortclipsDb;
}
