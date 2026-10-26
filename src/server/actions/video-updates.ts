"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, clientVideoUpdates } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { toEmbedUrl } from "@/server/video-updates";

export type ActionResult = { ok: boolean; message?: string };

async function slugOf(clientId: string): Promise<string | null> {
  const [c] = await db.select({ slug: clients.slug }).from(clients).where(eq(clients.id, clientId)).limit(1);
  return c?.slug ?? null;
}

/** Een maand-videoboodschap voor de klant opslaan of bijwerken. */
export async function saveClientVideoUpdate(input: { clientId: string; period: string; videoUrl: string; note: string }): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("analytics:read");
    assertClientAccess(viewer, input.clientId);

    const videoUrl = input.videoUrl.trim();
    if (!/^https?:\/\//i.test(videoUrl)) return { ok: false, message: "Vul een geldige videolink in (begint met https://)." };
    if (!/^\d{4}-\d{2}$/.test(input.period)) return { ok: false, message: "Ongeldige periode." };
    const note = input.note.trim().slice(0, 2000) || null;

    await db
      .insert(clientVideoUpdates)
      .values({ clientId: input.clientId, period: input.period, videoUrl, note, createdById: viewer.id })
      .onConflictDoUpdate({ target: [clientVideoUpdates.clientId, clientVideoUpdates.period], set: { videoUrl, note, deletedAt: null, updatedAt: new Date() } });

    await auditLog({ viewer, action: "video_update.saved", entityType: "client", entityId: input.clientId, clientId: input.clientId, changes: { period: input.period, embeddable: toEmbedUrl(videoUrl) != null } });
    const slug = await slugOf(input.clientId);
    if (slug) revalidatePath(`/analytics/${slug}`);
    revalidatePath("/portal/resultaten");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Een maand-videoboodschap verwijderen (zacht). */
export async function deleteClientVideoUpdate(input: { clientId: string; period: string }): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("analytics:read");
    assertClientAccess(viewer, input.clientId);
    await db
      .update(clientVideoUpdates)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(clientVideoUpdates.clientId, input.clientId), eq(clientVideoUpdates.period, input.period)));
    await auditLog({ viewer, action: "video_update.deleted", entityType: "client", entityId: input.clientId, clientId: input.clientId, changes: { period: input.period } });
    const slug = await slugOf(input.clientId);
    if (slug) revalidatePath(`/analytics/${slug}`);
    revalidatePath("/portal/resultaten");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
