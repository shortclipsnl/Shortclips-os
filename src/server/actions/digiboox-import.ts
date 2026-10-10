"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { companyFinanceMonths } from "@/db/schema";
import { requirePermission, ForbiddenError } from "@/server/auth/context";
import { readXlsx } from "@/lib/xlsx";
import { parseDigiboox, type DigibooxMonth, type DigibooxYear } from "@/server/digiboox";

export type DigibooxImportResult = {
  ok: boolean;
  message?: string;
  imported?: number; // aantal bijgewerkte maanden
  months?: { period: string; revenue: number; cost: number; financeIncome: number; result: number }[];
  year?: DigibooxYear | null;
  files?: { name: string; kind: string; months: number; warnings: string[] }[];
};

const MAX_BYTES = 5 * 1024 * 1024; // ruim; exports zijn enkele KB's

/**
 * Leest één of meer Digiboox-exports (.xlsx) in en vult de boekhoudcijfers
 * (omzet, kosten, financiële baten, resultaat) per maand in companyFinanceMonths.
 * Uitsluitend de eigenaar (finance:write). De bestanden worden als data behandeld.
 */
export async function importDigibooxFinance(formData: FormData): Promise<DigibooxImportResult> {
  let viewer;
  try {
    viewer = await requirePermission("finance:write");
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, message: "Geen bestand gekozen." };

  const merged = new Map<string, DigibooxMonth>();
  let year: DigibooxYear | null = null;
  const fileSummaries: NonNullable<DigibooxImportResult["files"]> = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      fileSummaries.push({ name: file.name, kind: "overgeslagen", months: 0, warnings: [`Bestand te groot (${Math.round(file.size / 1024)} kB).`] });
      continue;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      fileSummaries.push({ name: file.name, kind: "overgeslagen", months: 0, warnings: ["Geen .xlsx-bestand."] });
      continue;
    }
    let parsed;
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      parsed = parseDigiboox(readXlsx(buf));
    } catch (err) {
      fileSummaries.push({ name: file.name, kind: "fout", months: 0, warnings: [`Kon niet lezen: ${String(err)}`] });
      continue;
    }
    for (const m of parsed.months) {
      const e = merged.get(m.period) ?? { period: m.period, revenue: 0, cost: 0, financeIncome: 0 };
      // Laatste bestand wint per maand (nieuwere export overschrijft).
      e.revenue = m.revenue; e.cost = m.cost; e.financeIncome = m.financeIncome;
      merged.set(m.period, e);
    }
    if (parsed.year && !year) year = parsed.year;
    fileSummaries.push({ name: file.name, kind: parsed.kind, months: parsed.months.length, warnings: parsed.warnings });
  }

  const months = [...merged.values()].sort((a, b) => a.period.localeCompare(b.period));

  if (months.length === 0) {
    return {
      ok: false,
      message: year
        ? "Alleen jaarcijfers gevonden. Upload de ‘Mutaties’-export voor de maandcijfers."
        : "Geen maandcijfers gevonden in de gekozen bestanden.",
      year,
      files: fileSummaries,
    };
  }

  const now = new Date();
  for (const m of months) {
    await db
      .insert(companyFinanceMonths)
      .values({
        period: m.period,
        bookRevenue: m.revenue.toFixed(2),
        bookCost: m.cost.toFixed(2),
        bookFinanceIncome: m.financeIncome.toFixed(2),
        bookSource: "digiboox",
        bookImportedAt: now,
        updatedById: viewer.id,
      })
      .onConflictDoUpdate({
        target: companyFinanceMonths.period,
        set: {
          bookRevenue: m.revenue.toFixed(2),
          bookCost: m.cost.toFixed(2),
          bookFinanceIncome: m.financeIncome.toFixed(2),
          bookSource: "digiboox",
          bookImportedAt: now,
          updatedById: viewer.id,
          updatedAt: now,
        },
      });
  }

  revalidatePath("/financien");
  return {
    ok: true,
    imported: months.length,
    months: months.map((m) => ({ ...m, result: m.revenue + m.financeIncome - m.cost })),
    year,
    files: fileSummaries,
  };
}
