import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { frameAssets } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { frameio } from "@/server/integrations/frameio";
import { signedUrlExpiry } from "@/lib/frame-url";


/**
 * Haalt een Frame-video uit de bibliotheek op, mits de ingelogde gebruiker
 * toegang heeft tot de klant waar hij bij hoort. Harde klantscheiding: zonder
 * toegang bestaat de video voor de aanvrager niet (404).
 */
export async function frameAssetForViewer(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const viewer = await getViewer();
  if (!viewer) return null;
  const [a] = await db
    .select({ id: frameAssets.id, clientId: frameAssets.clientId, mediaFileId: frameAssets.mediaFileId, thumbnailUrl: frameAssets.thumbnailUrl })
    .from(frameAssets)
    .where(and(eq(frameAssets.id, id), isNull(frameAssets.deletedAt)))
    .limit(1);
  if (!a || !hasClientAccess(viewer, a.clientId)) return null;
  return a;
}

/** Verse thumbnail-URL (en opslaan), of de opgeslagen als die nog geldig is. */
export async function ensureThumbnail(a: { id: string; mediaFileId: string; thumbnailUrl: string | null }): Promise<string | null> {
  if (signedUrlExpiry(a.thumbnailUrl) > Date.now() + 30 * 60_000) return a.thumbnailUrl;
  try {
    const fresh = await frameio.getFileThumbnail(a.mediaFileId);
    if (fresh) {
      await db.update(frameAssets).set({ thumbnailUrl: fresh }).where(eq(frameAssets.id, a.id));
      return fresh;
    }
  } catch {
    /* val terug op de opgeslagen URL */
  }
  return a.thumbnailUrl;
}
