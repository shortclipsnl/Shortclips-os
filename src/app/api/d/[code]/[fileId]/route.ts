import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { transferFiles, transfers } from "@/db/schema";
import { presignGet, r2Configured } from "@/server/transfer/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Publieke download: valideert de code + de transfer server-side en stuurt de
 * ontvanger door naar een korte, ondertekende R2-URL. Onze server zit zo niet in
 * het datapad (directe download uit de opslag). Geen login nodig.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string; fileId: string }> }) {
  const { code, fileId } = await params;

  const [row] = await db
    .select({
      transferId: transfers.id,
      status: transfers.status,
      downloadExpiresOn: transfers.downloadExpiresOn,
      fileKey: transferFiles.r2Key,
      fileName: transferFiles.fileName,
      fileTransfer: transferFiles.transferId,
      fileStatus: transferFiles.status,
    })
    .from(transferFiles)
    .innerJoin(transfers, eq(transfers.id, transferFiles.transferId))
    .where(and(eq(transfers.code, code), eq(transferFiles.id, fileId), isNull(transfers.deletedAt)))
    .limit(1);

  if (!row) return new NextResponse("Niet gevonden", { status: 404 });
  if (row.status === "deleted") return new NextResponse("Deze bestanden zijn verwijderd.", { status: 410 });
  if (row.status === "uploading" || row.fileStatus !== "done") return new NextResponse("De upload is nog niet afgerond.", { status: 409 });
  if (row.status === "expired" || (row.downloadExpiresOn && row.downloadExpiresOn < new Date())) {
    return new NextResponse("Deze downloadlink is verlopen.", { status: 410 });
  }
  if (!r2Configured()) return new NextResponse("Opslag niet bereikbaar.", { status: 503 });
  if (!row.fileKey) return new NextResponse("Bestand niet beschikbaar.", { status: 404 });

  const url = await presignGet(row.fileKey, row.fileName);
  // Download tellen (niet-blokkerend voor de redirect).
  await db.update(transfers).set({ downloadCount: sql`${transfers.downloadCount} + 1` }).where(eq(transfers.id, row.transferId)).catch(() => undefined);

  return NextResponse.redirect(url, { status: 302 });
}
