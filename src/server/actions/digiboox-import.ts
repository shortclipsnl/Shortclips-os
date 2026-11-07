"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requirePermission, ForbiddenError } from "@/server/auth/context";
import { readXlsx } from "@/lib/xlsx";
import type { DigibooxYear } from "@/server/digiboox";
import { importDigibooxSheets } from "@/server/bank/digiboox-core";

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

  const parsedFiles: { name: string; sheets: ReturnType<typeof readXlsx> }[] = [];
  const skipped: NonNullable<DigibooxImportResult["files"]> = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      skipped.push({ name: file.name, kind: "overgeslagen", months: 0, warnings: [`Bestand te groot (${Math.round(file.size / 1024)} kB).`] });
      continue;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      skipped.push({ name: file.name, kind: "overgeslagen", months: 0, warnings: ["Geen .xlsx-bestand."] });
      continue;
    }
    try {
      parsedFiles.push({ name: file.name, sheets: readXlsx(Buffer.from(await file.arrayBuffer())) });
    } catch (err) {
      skipped.push({ name: file.name, kind: "fout", months: 0, warnings: [`Kon niet lezen: ${String(err)}`] });
    }
  }

  const res = await importDigibooxSheets(db, parsedFiles, viewer.id);
  if (res.months.length === 0 && !res.balans) {
    return {
      ok: false,
      message: res.year ? "Alleen jaarcijfers gevonden. Upload de ‘Mutaties’-export voor de maandcijfers." : "Geen maandcijfers of balans gevonden in de gekozen bestanden.",
      year: res.year,
      files: [...res.files, ...skipped],
    };
  }

  revalidatePath("/financien");
  revalidatePath("/financien/maand");
  revalidatePath("/kosten");
  return { ok: true, imported: res.months.length, months: res.months, year: res.year, files: [...res.files, ...skipped] };
}
