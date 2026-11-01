"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { transferFiles, transfers } from "@/db/schema";
import { ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  deleteObjects,
  listParts,
  presignUploadPart,
  r2Configured,
} from "@/server/transfer/r2";
import {
  DOWNLOAD_DAYS,
  STORAGE_DAYS,
  canManageTransfer,
  generateCode,
  partCount,
  partSizeFor,
  transferLink,
} from "@/server/transfer/service";

export type CreateTransferInput = { files: { name: string; size: number; type?: string | null }[] };
export type CreateTransferResult =
  | {
      ok: true;
      transferId: string;
      code: string;
      link: string;
      files: { fileId: string; partSize: number; partCount: number }[];
    }
  | { ok: false; reason?: "no_storage"; message: string };

const MAX_FILE_BYTES = 110 * 1024 * 1024 * 1024; // ruime 110 GB-marge boven de 100 GB-eis
const MAX_FILES = 500;

function safeName(name: string): string {
  return (name || "bestand").replace(/[\r\n\\/]/g, "_").slice(0, 400);
}

/**
 * Maakt een transfer aan: DB-records + een R2 multipart-upload per bestand. Geeft
 * meteen de deel-link terug (vóór de upload klaar is) + per bestand de deel-grootte.
 */
export async function createTransfer(input: CreateTransferInput): Promise<CreateTransferResult> {
  try {
    const viewer = await requirePermission("transfer:write");
    const files = (input.files ?? []).filter((f) => f && f.name);
    if (files.length === 0) return { ok: false, message: "Voeg eerst bestanden toe." };
    if (files.length > MAX_FILES) return { ok: false, message: `Maximaal ${MAX_FILES} bestanden per transfer.` };
    if (files.some((f) => f.size > MAX_FILE_BYTES)) return { ok: false, message: "Een bestand is te groot (max 100 GB)." };
    if (!r2Configured()) {
      return { ok: false, reason: "no_storage", message: "De opslag (Cloudflare R2) is nog niet ingesteld. Vul de R2-sleutels in bij de omgevingsvariabelen." };
    }

    const totalBytes = files.reduce((s, f) => s + Math.max(0, Math.floor(f.size || 0)), 0);
    const code = generateCode();
    const title = files.length === 1 ? safeName(files[0]!.name) : `${safeName(files[0]!.name)} +${files.length - 1}`;

    const [t] = await db
      .insert(transfers)
      .values({ code, ownerId: viewer.id, title: title.slice(0, 240), totalBytes, fileCount: files.length, status: "uploading" })
      .returning({ id: transfers.id });
    const transferId = t!.id;

    const out: { fileId: string; partSize: number; partCount: number }[] = [];
    for (const f of files) {
      const size = Math.max(0, Math.floor(f.size || 0));
      const psize = partSizeFor(size);
      const [row] = await db
        .insert(transferFiles)
        .values({ transferId, fileName: safeName(f.name), sizeBytes: size, contentType: f.type ?? null, r2Key: "", partSize: psize, status: "uploading" })
        .returning({ id: transferFiles.id });
      const fileId = row!.id;
      const key = `${transferId}/${fileId}/${safeName(f.name)}`;
      const uploadId = await createMultipartUpload(key, f.type);
      await db.update(transferFiles).set({ r2Key: key, uploadId }).where(eq(transferFiles.id, fileId));
      out.push({ fileId, partSize: psize, partCount: partCount(size, psize) });
    }

    await auditLog({ viewer, action: "transfer.created", entityType: "transfer", entityId: transferId, changes: { files: files.length, bytes: totalBytes } });
    return { ok: true, transferId, code, link: transferLink(code), files: out };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Interne helper: laad een bestand + de transfer-eigenaar, met toegangscontrole. */
async function loadFileForWrite(viewer: Awaited<ReturnType<typeof requirePermission>>, fileId: string) {
  const [row] = await db
    .select({
      id: transferFiles.id,
      key: transferFiles.r2Key,
      uploadId: transferFiles.uploadId,
      transferId: transferFiles.transferId,
      ownerId: transfers.ownerId,
      status: transfers.status,
    })
    .from(transferFiles)
    .innerJoin(transfers, eq(transfers.id, transferFiles.transferId))
    .where(and(eq(transferFiles.id, fileId), isNull(transfers.deletedAt)))
    .limit(1);
  if (!row) return null;
  if (!canManageTransfer(viewer, row.ownerId)) throw new ForbiddenError();
  return row;
}

export type SignPartResult = { ok: boolean; url?: string; message?: string };

/** Ondertekende URL voor één upload-deel (browser PUT rechtstreeks naar R2). */
export async function signUploadPart(input: { fileId: string; partNumber: number }): Promise<SignPartResult> {
  try {
    const viewer = await requirePermission("transfer:write");
    const file = await loadFileForWrite(viewer, input.fileId);
    if (!file || !file.uploadId) return { ok: false, message: "Upload niet gevonden." };
    if (input.partNumber < 1 || input.partNumber > 10000) return { ok: false, message: "Ongeldig deelnummer." };
    const url = await presignUploadPart(file.key, file.uploadId, input.partNumber);
    return { ok: true, url };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Reeds geüploade delen opvragen (hervatten na onderbreking). */
export async function listUploadedParts(input: { fileId: string }): Promise<{ ok: boolean; parts?: { PartNumber: number; ETag: string; Size: number }[]; message?: string }> {
  try {
    const viewer = await requirePermission("transfer:write");
    const file = await loadFileForWrite(viewer, input.fileId);
    if (!file || !file.uploadId) return { ok: false, message: "Upload niet gevonden." };
    const parts = await listParts(file.key, file.uploadId);
    return { ok: true, parts };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export type CompleteFileResult = { ok: boolean; transferComplete?: boolean; link?: string; message?: string };

/**
 * Rond één bestand af. De server haalt zelf de geüploade delen (+ETags) bij R2
 * op (`listParts`) en voltooit de multipart-upload — zo hoeft R2-CORS de
 * ETag-header niet te exposen. Markeert de transfer 'available' zodra alle
 * bestanden klaar zijn.
 */
export async function completeFile(input: { fileId: string }): Promise<CompleteFileResult> {
  try {
    const viewer = await requirePermission("transfer:write");
    const file = await loadFileForWrite(viewer, input.fileId);
    if (!file || !file.uploadId) return { ok: false, message: "Upload niet gevonden." };

    const uploaded = await listParts(file.key, file.uploadId);
    if (uploaded.length === 0) return { ok: false, message: "Er zijn nog geen delen geüpload." };
    await completeMultipartUpload(file.key, file.uploadId, uploaded.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })));
    await db.update(transferFiles).set({ status: "done", completedAt: new Date() }).where(eq(transferFiles.id, file.id));

    // Alle bestanden van deze transfer klaar? Dan de transfer beschikbaar maken.
    const remaining = await db
      .select({ id: transferFiles.id })
      .from(transferFiles)
      .where(and(eq(transferFiles.transferId, file.transferId), eq(transferFiles.status, "uploading")));
    const allDone = remaining.length === 0;
    let link: string | undefined;
    if (allDone) {
      const now = new Date();
      const downloadExpiresOn = new Date(now.getTime() + DOWNLOAD_DAYS * 86400000);
      const storageExpiresOn = new Date(now.getTime() + STORAGE_DAYS * 86400000);
      const [t] = await db
        .update(transfers)
        .set({ status: "available", completedAt: now, downloadExpiresOn, storageExpiresOn, updatedAt: now })
        .where(and(eq(transfers.id, file.transferId), eq(transfers.status, "uploading")))
        .returning({ code: transfers.code });
      if (t) link = transferLink(t.code);
      revalidatePath("/transfer/mijn");
    }
    return { ok: true, transferComplete: allDone, link };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export type SimpleResult = { ok: boolean; message?: string };

/** Een nog lopende (of mislukte) upload afbreken en opruimen. */
export async function abortTransfer(input: { transferId: string }): Promise<SimpleResult> {
  try {
    const viewer = await requirePermission("transfer:write");
    const [t] = await db.select({ id: transfers.id, ownerId: transfers.ownerId }).from(transfers).where(and(eq(transfers.id, input.transferId), isNull(transfers.deletedAt))).limit(1);
    if (!t) return { ok: false, message: "Transfer niet gevonden." };
    if (!canManageTransfer(viewer, t.ownerId)) throw new ForbiddenError();
    const files = await db.select({ key: transferFiles.r2Key, uploadId: transferFiles.uploadId }).from(transferFiles).where(eq(transferFiles.transferId, t.id));
    for (const f of files) if (f.uploadId && f.key) await abortMultipartUpload(f.key, f.uploadId);
    await db.update(transfers).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(transfers.id, t.id));
    revalidatePath("/transfer/mijn");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Een transfer definitief verwijderen (bestanden uit R2 + soft-delete). */
export async function deleteTransfer(input: { transferId: string }): Promise<SimpleResult> {
  try {
    const viewer = await requirePermission("transfer:write");
    const [t] = await db.select({ id: transfers.id, ownerId: transfers.ownerId }).from(transfers).where(and(eq(transfers.id, input.transferId), isNull(transfers.deletedAt))).limit(1);
    if (!t) return { ok: false, message: "Transfer niet gevonden." };
    if (!canManageTransfer(viewer, t.ownerId)) throw new ForbiddenError();
    const files = await db.select({ key: transferFiles.r2Key, uploadId: transferFiles.uploadId }).from(transferFiles).where(eq(transferFiles.transferId, t.id));
    for (const f of files) if (f.uploadId && f.key) await abortMultipartUpload(f.key, f.uploadId);
    await deleteObjects(files.map((f) => f.key).filter(Boolean));
    // Bestanden weg uit R2, maar de transfer blijft als "Verwijderd" zichtbaar in
    // "Mijn transfers" (geen soft-delete).
    await db.update(transfers).set({ status: "deleted", updatedAt: new Date() }).where(eq(transfers.id, t.id));
    await auditLog({ viewer, action: "transfer.deleted", entityType: "transfer", entityId: t.id });
    revalidatePath("/transfer/mijn");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Een verlopen (nog niet verwijderde) transfer opnieuw activeren binnen het bewaartermijn. */
export async function reactivateTransfer(input: { transferId: string }): Promise<SimpleResult> {
  try {
    const viewer = await requirePermission("transfer:write");
    const [t] = await db
      .select({ id: transfers.id, ownerId: transfers.ownerId, status: transfers.status, storageExpiresOn: transfers.storageExpiresOn })
      .from(transfers)
      .where(and(eq(transfers.id, input.transferId), isNull(transfers.deletedAt)))
      .limit(1);
    if (!t) return { ok: false, message: "Transfer niet gevonden." };
    if (!canManageTransfer(viewer, t.ownerId)) throw new ForbiddenError();
    if (t.status !== "expired") return { ok: false, message: "Alleen een verlopen transfer kan heractiveerd worden." };
    const now = new Date();
    if (!t.storageExpiresOn || t.storageExpiresOn <= now) return { ok: false, message: "De bewaartermijn is voorbij; de bestanden zijn niet meer beschikbaar." };
    const plus7 = new Date(now.getTime() + 7 * 86400000);
    const newExpiry = plus7 < t.storageExpiresOn ? plus7 : t.storageExpiresOn;
    await db.update(transfers).set({ status: "available", downloadExpiresOn: newExpiry, updatedAt: now }).where(eq(transfers.id, t.id));
    await auditLog({ viewer, action: "transfer.reactivated", entityType: "transfer", entityId: t.id });
    revalidatePath("/transfer/mijn");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
