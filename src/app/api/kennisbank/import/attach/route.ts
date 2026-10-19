import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { kbAssets, kbLessons, type KbResource } from "@/db/schema";
import { getViewer, isOwner } from "@/server/auth/context";
import { auditLog } from "@/server/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Nazending van de Skool-migratie (alleen de eigenaar): koppelt een al
 * geüpload bestand aan de les(sen) waar het in Skool bij hoorde, op basis van
 * het oorspronkelijke Skool file-id of video-id. Wijzigt verder niets aan de les.
 */
const schema = z.union([
  z.object({ skoolFileId: z.string().regex(/^[0-9a-f]{32}$/), assetId: z.string().uuid() }),
  z.object({ skoolVideoId: z.string().regex(/^[0-9a-f]{32}$/), assetId: z.string().uuid() }),
]);

export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer || !isOwner(viewer)) return Response.json({ ok: false, message: "Alleen de eigenaar." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ ok: false, message: "Ongeldig verzoek." }, { status: 400 });
  const data = parsed.data;
  const [asset] = await db.select({ id: kbAssets.id, isComplete: kbAssets.isComplete }).from(kbAssets).where(eq(kbAssets.id, data.assetId)).limit(1);
  if (!asset?.isComplete) return Response.json({ ok: false, message: "Bestand niet (volledig) geüpload." }, { status: 400 });

  let updated = 0;
  if ("skoolFileId" in data) {
    const lessons = await db
      .select({ id: kbLessons.id, resources: kbLessons.resources, notes: kbLessons.migrationNotes })
      .from(kbLessons)
      .where(and(isNull(kbLessons.deletedAt), sql`${kbLessons.resources}::text like ${"%" + data.skoolFileId + "%"}`));
    for (const l of lessons) {
      let notes = l.notes ?? "";
      const resources = (l.resources ?? []).map((r: KbResource) => {
        if (r.skoolFileId !== data.skoolFileId) return r;
        notes = notes.replace(`Bijlage "${r.title}" (${r.fileName}) kon nog niet uit Skool worden overgezet.`, "").trim();
        return { ...r, assetId: data.assetId };
      });
      await db.update(kbLessons).set({ resources, migrationNotes: notes || null }).where(eq(kbLessons.id, l.id));
      updated++;
    }
  } else {
    const note = "De video van deze les stond direct in Skool en is nog niet overgezet. Upload het originele videobestand via Bewerken.";
    const lessons = await db
      .select({ id: kbLessons.id, notes: kbLessons.migrationNotes })
      .from(kbLessons)
      .where(and(isNull(kbLessons.deletedAt), sql`${kbLessons.sourceRef} like ${"%video " + data.skoolVideoId + "%"}`));
    for (const l of lessons) {
      await db.update(kbLessons).set({ videoAssetId: data.assetId, migrationNotes: (l.notes ?? "").replace(note, "").trim() || null }).where(eq(kbLessons.id, l.id));
      updated++;
    }
  }
  await auditLog({ viewer, action: "kennisbank.import.attach", entityType: "kb_asset", entityId: data.assetId, changes: { ...data, updated } });
  return Response.json({ ok: true, updated });
}
