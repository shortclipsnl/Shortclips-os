import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { kostenOmzet, kostenRegels } from "../../db/schema";
import type { KostenPayload } from "./shared";

export type KostenImportResult = {
  /** Maanden waarvan de regels opnieuw zijn ingevoerd. */
  months: string[];
  /** Aantal ingevoerde regels. */
  regels: number;
  /** Aantal maanden waarvoor omzet is gezet. */
  omzetMonths: number;
  /** Maanden die zijn overgeslagen (bij onlyNewMonths: al aanwezig). */
  skipped: string[];
};

/** Basiscontrole op het exportformaat, met een duidelijke fout bij onzin. */
export function validateKostenPayload(data: unknown): asserts data is KostenPayload {
  if (!data || typeof data !== "object") throw new Error("Payload is geen object.");
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.lev)) throw new Error("Veld 'lev' (leveranciers) ontbreekt of is geen lijst.");
  if (!Array.isArray(d.subs)) throw new Error("Veld 'subs' (subcategorieën) ontbreekt of is geen lijst.");
  if (!d.m || typeof d.m !== "object") throw new Error("Veld 'm' (maanden) ontbreekt of is geen object.");
  for (const maand of Object.keys(d.m as object)) {
    if (!/^\d{4}-\d{2}$/.test(maand)) throw new Error(`Maand '${maand}' is geen geldige YYYY-MM.`);
  }
}

/**
 * Leest het DigiBoox-exportformaat in en zet het in de database.
 *
 * Idempotent per maand: de bestaande regels van een maand worden eerst
 * verwijderd en daarna opnieuw ingevoerd. Zo levert dezelfde export altijd
 * dezelfde stand op, en vervangt een nieuwe export alleen de maanden die hij
 * bevat.
 *
 * `onlyNewMonths` slaat maanden over die al regels hebben — voor de eerste keer
 * vullen bij een deploy, zodat latere correcties via het import-endpoint niet
 * worden overschreven.
 */
export async function importKostenData(
  db: Db,
  payload: KostenPayload,
  opts: { onlyNewMonths?: boolean } = {},
): Promise<KostenImportResult> {
  validateKostenPayload(payload);
  const bijgewerkt = payload.bijgewerkt && /^\d{4}-\d{2}-\d{2}$/.test(payload.bijgewerkt) ? payload.bijgewerkt : null;

  const existing = new Set<string>();
  if (opts.onlyNewMonths) {
    const rows = await db.selectDistinct({ maand: kostenRegels.maand }).from(kostenRegels);
    for (const r of rows) existing.add(r.maand);
  }

  const allMonths = Object.keys(payload.m);
  const targetMonths = allMonths.filter((m) => !existing.has(m));
  const skipped = allMonths.filter((m) => existing.has(m));

  let regels = 0;
  for (const maand of targetMonths) {
    const rows = payload.m[maand] ?? [];
    await db.delete(kostenRegels).where(eq(kostenRegels.maand, maand));
    if (!rows.length) continue;
    const values = rows.map(([li, si, met, ex, n]) => {
      const leverancier = payload.lev[li] ?? "Onbekend";
      const sub = payload.subs[si] ?? ["Overige kosten", "operationeel", "variabel"];
      return {
        maand,
        leverancier: String(leverancier).slice(0, 200),
        subcategorie: String(sub[0]).slice(0, 80),
        groep: String(sub[1]).slice(0, 24),
        soort: String(sub[2]).slice(0, 16),
        metBtw: String(Math.round(Number(met) || 0)),
        zonderBtw: String(Math.round(Number(ex) || 0)),
        aantal: Math.max(1, Math.round(Number(n) || 1)),
        bijgewerkt,
      };
    });
    // In blokken invoegen zodat een extreem grote maand de parameterlimiet niet raakt.
    for (let i = 0; i < values.length; i += 500) {
      await db.insert(kostenRegels).values(values.slice(i, i + 500));
    }
    regels += values.length;
  }

  let omzetMonths = 0;
  for (const [maand, bedrag] of Object.entries(payload.omzet ?? {})) {
    if (!/^\d{4}-\d{2}$/.test(maand)) continue;
    if (opts.onlyNewMonths && existing.has(maand)) continue;
    await db
      .insert(kostenOmzet)
      .values({ maand, omzet: String(Math.round(Number(bedrag) || 0)), bijgewerkt })
      .onConflictDoUpdate({
        target: kostenOmzet.maand,
        set: { omzet: String(Math.round(Number(bedrag) || 0)), bijgewerkt, updatedAt: sql`now()` },
      });
    omzetMonths += 1;
  }

  return { months: targetMonths, regels, omzetMonths, skipped };
}
