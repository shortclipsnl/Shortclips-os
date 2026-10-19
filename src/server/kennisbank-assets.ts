import "server-only";
import crypto from "node:crypto";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { kbAssetParts, kbAssets, KB_PART_SIZE } from "@/db/schema";

/** Bestand in delen wegschrijven (gebruikt door de import; uploads gaan per deel via de API). */
export async function storeAsset(params: {
  kind: "image" | "file" | "video";
  fileName: string;
  contentType: string;
  data: Buffer;
  sourceRef?: string | null;
  createdById?: string | null;
}): Promise<string> {
  const sha256 = crypto.createHash("sha256").update(params.data).digest("hex");
  const [asset] = await db
    .insert(kbAssets)
    .values({
      kind: params.kind,
      fileName: params.fileName.slice(0, 400),
      contentType: params.contentType,
      byteSize: params.data.length,
      sha256,
      isComplete: false,
      sourceRef: params.sourceRef ?? null,
      createdById: params.createdById ?? null,
    })
    .returning({ id: kbAssets.id });
  for (let off = 0, part = 0; off < params.data.length || part === 0; off += KB_PART_SIZE, part++) {
    const chunk = params.data.subarray(off, off + KB_PART_SIZE);
    await db.insert(kbAssetParts).values({ assetId: asset!.id, partNo: part, byteSize: chunk.length, data: Buffer.from(chunk) });
    if (chunk.length === 0) break;
  }
  await db.update(kbAssets).set({ isComplete: true }).where(eq(kbAssets.id, asset!.id));
  return asset!.id;
}

/** Leest [start, end] (inclusief) uit de delen, als stroom. */
export function streamAssetRange(assetId: string, start: number, end: number): ReadableStream<Uint8Array> {
  const firstPart = Math.floor(start / KB_PART_SIZE);
  const lastPart = Math.floor(end / KB_PART_SIZE);
  let part = firstPart;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (part > lastPart) {
        controller.close();
        return;
      }
      // Per keer een paar delen ophalen om geheugen laag te houden.
      const upto = Math.min(lastPart, part + 1);
      const rows = await db
        .select({ partNo: kbAssetParts.partNo, data: kbAssetParts.data })
        .from(kbAssetParts)
        .where(and(eq(kbAssetParts.assetId, assetId), gte(kbAssetParts.partNo, part), lte(kbAssetParts.partNo, upto)))
        .orderBy(asc(kbAssetParts.partNo));
      for (const r of rows) {
        const partStart = r.partNo * KB_PART_SIZE;
        const from = Math.max(0, start - partStart);
        const to = Math.min(r.data.length, end - partStart + 1);
        if (to > from) controller.enqueue(new Uint8Array(r.data.subarray(from, to)));
      }
      part = upto + 1;
    },
  });
}

export async function finalizeAsset(assetId: string): Promise<{ ok: boolean; message?: string }> {
  const [asset] = await db.select().from(kbAssets).where(eq(kbAssets.id, assetId)).limit(1);
  if (!asset) return { ok: false, message: "Bestand niet gevonden." };
  const parts = await db
    .select({ partNo: kbAssetParts.partNo, byteSize: kbAssetParts.byteSize })
    .from(kbAssetParts)
    .where(eq(kbAssetParts.assetId, assetId))
    .orderBy(asc(kbAssetParts.partNo));
  const total = parts.reduce((a, p) => a + p.byteSize, 0);
  const contiguous = parts.every((p, i) => p.partNo === i);
  if (!contiguous || total !== asset.byteSize) {
    return { ok: false, message: `Upload onvolledig (${total} van ${asset.byteSize} bytes).` };
  }
  const hash = crypto.createHash("sha256");
  for (let i = 0; i < parts.length; i++) {
    const [r] = await db.select({ data: kbAssetParts.data }).from(kbAssetParts).where(and(eq(kbAssetParts.assetId, assetId), eq(kbAssetParts.partNo, i)));
    hash.update(r!.data);
  }
  await db.update(kbAssets).set({ isComplete: true, sha256: hash.digest("hex"), updatedAt: sql`now()` }).where(eq(kbAssets.id, assetId));
  return { ok: true };
}
