"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requirePermission, ForbiddenError } from "@/server/auth/context";
import { importCamtBestand, type BankImportResult } from "@/server/bank/import";

export type BankUploadResult = { ok: boolean; message?: string; resultaten?: BankImportResult[]; fouten?: { bestand: string; fout: string }[] };

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Upload van één of meer Knab CAMT.053-exports (.xml) door de eigenaar.
 * Dubbele boekingen worden automatisch overgeslagen; bestaande gegevens
 * worden nooit gewijzigd of verwijderd.
 */
export async function importBankBestanden(formData: FormData): Promise<BankUploadResult> {
  try {
    await requirePermission("finance:write");
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, message: "Geen bestand gekozen." };

  const resultaten: BankImportResult[] = [];
  const fouten: { bestand: string; fout: string }[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      fouten.push({ bestand: f.name, fout: "Bestand te groot." });
      continue;
    }
    if (!/\.xml$/i.test(f.name)) {
      fouten.push({ bestand: f.name, fout: "Geen .xml. Kies in Knab bij Exporteren het formaat CAMT.053." });
      continue;
    }
    try {
      resultaten.push(await importCamtBestand(db, f.name, await f.text()));
    } catch (err) {
      fouten.push({ bestand: f.name, fout: err instanceof Error ? err.message : String(err) });
    }
  }
  revalidatePath("/financien");
  revalidatePath("/financien/maand");
  revalidatePath("/kosten");
  return { ok: resultaten.length > 0, resultaten, fouten, message: resultaten.length ? undefined : "Niets ingelezen." };
}
