import { sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { companyFinanceMonths, kostenOmzet } from "../../db/schema";
import type { XlsxSheet } from "../../lib/xlsx";
import { parseDigiboox, type DigibooxMonth, type DigibooxYear } from "../digiboox";
import { parseBalans, saveBalans } from "./balans";

/**
 * Verwerkt DigiBoox-exports (Mutaties en/of Winst- en verlies + Balans):
 *  - omzet, kosten en financiële baten per maand → company_finance_months;
 *  - dezelfde omzet → kosten_omzet, zodat Kostenmonitor en Financiën één bron delen;
 *  - de balans → boekhoud_balansen (debiteuren, crediteuren, btw, vraagposten).
 * Geen `server-only`: ook gebruikt door het importscript.
 */
export type DigibooxCoreResult = {
  months: (DigibooxMonth & { result: number })[];
  year: DigibooxYear | null;
  balans: boolean;
  files: { name: string; kind: string; months: number; warnings: string[] }[];
};

export async function importDigibooxSheets(db: Db, files: { name: string; sheets: XlsxSheet[] }[], userId: string | null): Promise<DigibooxCoreResult> {
  const merged = new Map<string, DigibooxMonth>();
  let year: DigibooxYear | null = null;
  let balans = false;
  const summaries: DigibooxCoreResult["files"] = [];

  for (const f of files) {
    const parsed = parseDigiboox(f.sheets);
    for (const m of parsed.months) merged.set(m.period, { ...m }); // laatste bestand wint per maand
    if (parsed.year && !year) year = parsed.year;
    const b = parseBalans(f.sheets);
    if (b) {
      await saveBalans(db, f.name, b);
      balans = true;
    }
    summaries.push({ name: f.name, kind: b ? `${parsed.kind}+balans` : parsed.kind, months: parsed.months.length, warnings: b ? parsed.warnings.filter((w) => !w.startsWith("Geen herkenbare")) : parsed.warnings });
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const months = [...merged.values()].sort((a, b) => a.period.localeCompare(b.period));
  for (const m of months) {
    const vals = { bookRevenue: m.revenue.toFixed(2), bookCost: m.cost.toFixed(2), bookFinanceIncome: m.financeIncome.toFixed(2), bookSource: "digiboox", bookImportedAt: now };
    await db
      .insert(companyFinanceMonths)
      .values({ period: m.period, ...vals, ...(userId ? { updatedById: userId } : {}) })
      .onConflictDoUpdate({ target: companyFinanceMonths.period, set: { ...vals, ...(userId ? { updatedById: userId } : {}), updatedAt: now } });
    await db
      .insert(kostenOmzet)
      .values({ maand: m.period, omzet: m.revenue.toFixed(2), bijgewerkt: today })
      .onConflictDoUpdate({ target: kostenOmzet.maand, set: { omzet: m.revenue.toFixed(2), bijgewerkt: today, updatedAt: sql`now()` } });
  }
  return { months: months.map((m) => ({ ...m, result: m.revenue + m.financeIncome - m.cost })), year, balans, files: summaries };
}
