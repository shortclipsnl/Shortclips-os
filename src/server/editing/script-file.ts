import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { editProjectFiles } from "@/db/schema";
import { createScriptUploadTarget, deleteScriptPdf, downloadScriptPdf, scriptStorageConfigured } from "@/server/scripts/script-storage";

/**
 * Opslag van het script-pdf bij een opname (editing-board). Kleine bestanden gaan
 * als base64 in de database; grotere PDF's gaan rechtstreeks naar Supabase Storage
 * (langs de 4,5MB-requestlimiet van Vercel) en dan bewaren we alleen de
 * opslagsleutel. Hergebruikt dezelfde opslag-helpers als de scriptcontrole.
 */

export { scriptStorageConfigured, createScriptUploadTarget as createEditScriptUploadTarget, downloadScriptPdf as downloadEditScript };

export type EditScriptInput = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  base64?: string | null;
  storagePath?: string | null;
};

/** Verwijdert het bestaande script van een opname, inclusief het Supabase-bestand. */
export async function clearEditScript(productionDayId: string): Promise<void> {
  const olds = await db
    .select({ storagePath: editProjectFiles.storagePath })
    .from(editProjectFiles)
    .where(and(eq(editProjectFiles.productionDayId, productionDayId), eq(editProjectFiles.kind, "script")));
  for (const o of olds) if (o.storagePath) await deleteScriptPdf(o.storagePath);
  await db.delete(editProjectFiles).where(and(eq(editProjectFiles.productionDayId, productionDayId), eq(editProjectFiles.kind, "script")));
}

/** Vervangt het script van een opname door een nieuw bestand (base64 óf Supabase). */
export async function replaceEditScript(productionDayId: string, input: EditScriptInput, uploadedById: string): Promise<void> {
  await clearEditScript(productionDayId);
  await db.insert(editProjectFiles).values({
    productionDayId,
    kind: "script",
    fileName: input.fileName.slice(0, 255),
    contentType: "application/pdf",
    sizeBytes: input.sizeBytes,
    dataBase64: input.base64 ?? null,
    storagePath: input.storagePath ?? null,
    uploadedById,
  });
}
