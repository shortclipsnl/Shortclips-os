import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { transferFiles, transfers } from "@/db/schema";
import { isOwner, type Viewer } from "@/server/auth/context";
import { env } from "@/lib/env";

export const DOWNLOAD_DAYS = 30;
export const STORAGE_DAYS = 45;
/** R2/S3: minimaal 5 MB per deel (behalve het laatste), max 10.000 delen. */
const MIN_PART = 16 * 1024 * 1024; // 16 MB — ruime marge onder 10.000 delen bij 100 GB
const MAX_PART = 256 * 1024 * 1024;

/** Onvoorspelbare publieke deel-code. */
export function generateCode(): string {
  return randomBytes(18).toString("base64url"); // 24 tekens
}

/** Deel-grootte zodat ook 100 GB binnen 10.000 delen past. */
export function partSizeFor(sizeBytes: number): number {
  const needed = Math.ceil(sizeBytes / 9000); // ruim onder 10.000 delen
  return Math.min(MAX_PART, Math.max(MIN_PART, needed));
}

export function partCount(sizeBytes: number, partSize: number): number {
  return Math.max(1, Math.ceil(sizeBytes / partSize));
}

/** Basis-URL voor de publieke deel-/downloadlinks. */
export function transferPublicBase(): string {
  return (env.TRANSFER_PUBLIC_URL || env.APP_URL || "").replace(/\/$/, "");
}
export function transferLink(code: string): string {
  return `${transferPublicBase()}/d/${code}`;
}

export type MyTransferRow = {
  id: string;
  code: string;
  title: string;
  fileCount: number;
  totalBytes: number;
  status: string;
  createdAt: string;
  downloadExpiresOn: string | null;
  storageExpiresOn: string | null;
  downloadCount: number;
  link: string;
};

/** Transfers van de gebruiker (eigenaar ziet alle). Verwijderde onderaan/mee. */
export async function listMyTransfers(viewer: Viewer): Promise<MyTransferRow[]> {
  const rows = await db
    .select({
      id: transfers.id,
      code: transfers.code,
      title: transfers.title,
      fileCount: transfers.fileCount,
      totalBytes: transfers.totalBytes,
      status: transfers.status,
      createdAt: transfers.createdAt,
      downloadExpiresOn: transfers.downloadExpiresOn,
      storageExpiresOn: transfers.storageExpiresOn,
      downloadCount: transfers.downloadCount,
    })
    .from(transfers)
    .where(and(isNull(transfers.deletedAt), isOwner(viewer) ? sql`true` : eq(transfers.ownerId, viewer.id)))
    .orderBy(desc(transfers.createdAt))
    .limit(300);
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    downloadExpiresOn: r.downloadExpiresOn ? r.downloadExpiresOn.toISOString() : null,
    storageExpiresOn: r.storageExpiresOn ? r.storageExpiresOn.toISOString() : null,
    link: transferLink(r.code),
  }));
}

export type PublicTransfer = {
  code: string;
  title: string;
  status: string;
  totalBytes: number;
  downloadExpiresOn: string | null;
  files: { id: string; fileName: string; sizeBytes: number }[];
  /** Afgeleid: mag er nu gedownload worden? */
  downloadable: boolean;
};

/** Publieke weergave van een transfer (voor de downloadpagina, geen login). */
export async function getPublicTransfer(code: string): Promise<PublicTransfer | null> {
  const [t] = await db
    .select()
    .from(transfers)
    .where(and(eq(transfers.code, code), isNull(transfers.deletedAt)))
    .limit(1);
  if (!t || t.status === "deleted") return null;
  const files = await db
    .select({ id: transferFiles.id, fileName: transferFiles.fileName, sizeBytes: transferFiles.sizeBytes, status: transferFiles.status })
    .from(transferFiles)
    .where(eq(transferFiles.transferId, t.id));
  const now = new Date();
  const downloadable =
    t.status === "available" && (!t.downloadExpiresOn || t.downloadExpiresOn > now);
  return {
    code: t.code,
    title: t.title,
    status: t.status,
    totalBytes: t.totalBytes,
    downloadExpiresOn: t.downloadExpiresOn ? t.downloadExpiresOn.toISOString() : null,
    files: files.map((f) => ({ id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes })),
    downloadable,
  };
}

export type TransferCosts = {
  totalBytes: number;
  uploadedThisMonthBytes: number;
  estMonthlyCostCents: number;
  activeTransfers: number;
  expiringSoon: number;
};

/** Kostenoverzicht voor de eigenaar — uit de DB, geen R2-call nodig. */
export async function getTransferCosts(): Promise<TransferCosts> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);

  const [agg] = await db
    .select({
      totalBytes: sql<number>`coalesce(sum(case when ${transfers.status} <> 'deleted' then ${transfers.totalBytes} else 0 end), 0)`,
      monthBytes: sql<number>`coalesce(sum(case when ${transfers.createdAt} >= ${monthStart.toISOString()} then ${transfers.totalBytes} else 0 end), 0)`,
      active: sql<number>`count(*) filter (where ${transfers.status} = 'available')`,
      expiring: sql<number>`count(*) filter (where ${transfers.status} <> 'deleted' and ${transfers.storageExpiresOn} is not null and ${transfers.storageExpiresOn} <= ${soon.toISOString()})`,
    })
    .from(transfers)
    .where(isNull(transfers.deletedAt));

  const totalBytes = Number(agg?.totalBytes ?? 0);
  const gb = totalBytes / (1024 * 1024 * 1024);
  const estMonthlyCostCents = Math.round(gb * env.TRANSFER_STORAGE_CENTS_PER_GB_MONTH);
  return {
    totalBytes,
    uploadedThisMonthBytes: Number(agg?.monthBytes ?? 0),
    estMonthlyCostCents,
    activeTransfers: Number(agg?.active ?? 0),
    expiringSoon: Number(agg?.expiring ?? 0),
  };
}

/** Of de viewer deze transfer mag beheren (eigenaar van de transfer of owner). */
export function canManageTransfer(viewer: Viewer, ownerId: string | null): boolean {
  return isOwner(viewer) || (!!ownerId && ownerId === viewer.id);
}
