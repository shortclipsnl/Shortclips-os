import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { db as defaultDb } from "@/db/client";
import { vermogenDocs } from "@/db/schema";

/**
 * Opslaglaag voor het vermogensdashboard. Document per pad; alle paden moeten
 * met "v/" beginnen (de dashboardpagina gebruikt uitsluitend zulke paden).
 *
 * De eigenaarscontrole gebeurt in de route-handlers; hier staat alleen de
 * pure data-toegang, zodat ook het seedscript en de import deze kan gebruiken.
 */

/** Pad accepteren we alleen als het binnen de "v/"-namespace valt. */
export function isValidVermogenPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 1 && path.length <= 512 && path.startsWith("v/") && !path.includes("..");
}

/** Alle documenten als `{ "<pad>": data }` — precies wat de shim verwacht. */
export async function getAllVermogenDocs(db: Db = defaultDb): Promise<Record<string, unknown>> {
  const rows = await db.select({ path: vermogenDocs.path, data: vermogenDocs.data }).from(vermogenDocs);
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.path] = r.data;
  return out;
}

/** Eén document opslaan (insert of overschrijven). */
export async function putVermogenDoc(path: string, data: unknown, db: Db = defaultDb): Promise<void> {
  await db
    .insert(vermogenDocs)
    .values({ path, data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: vermogenDocs.path, set: { data, updatedAt: new Date() } });
}

/** Eén document verwijderen. */
export async function deleteVermogenDoc(path: string, db: Db = defaultDb): Promise<void> {
  await db.delete(vermogenDocs).where(eq(vermogenDocs.path, path));
}

/** Meerdere documenten in één keer upserten (voor de maandelijkse import). */
export async function upsertVermogenDocs(docs: Record<string, unknown>, db: Db = defaultDb): Promise<number> {
  const entries = Object.entries(docs).filter(([p]) => isValidVermogenPath(p));
  for (const [path, data] of entries) await putVermogenDoc(path, data, db);
  return entries.length;
}

/** Aantal documenten — gebruikt om alleen te seeden als de tabel leeg is. */
export async function countVermogenDocs(db: Db = defaultDb): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(vermogenDocs);
  return row?.n ?? 0;
}
