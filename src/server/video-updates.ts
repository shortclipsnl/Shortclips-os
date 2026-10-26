import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientVideoUpdates } from "@/db/schema";

export type ClientVideoUpdate = {
  id: string;
  period: string;
  videoUrl: string;
  embedUrl: string | null;
  note: string | null;
  createdAt: string;
};

/** Huidige periode (YYYY-MM) in Nederlandse tijd. */
export function currentVideoPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Zet een deel-URL om naar een insluit-URL voor YouTube/Vimeo/Loom; anders null. */
export function toEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
      const m = u.pathname.match(/\/(shorts|embed)\/([\w-]+)/);
      if (m) return `https://www.youtube.com/embed/${m[2]}`;
    }
    if (host === "vimeo.com") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
    if (host === "loom.com") {
      const m = u.pathname.match(/\/(share|embed)\/([\w-]+)/);
      if (m) return `https://www.loom.com/embed/${m[2]}`;
    }
    return null;
  } catch {
    return null;
  }
}

function map(row: { id: string; period: string; videoUrl: string; note: string | null; createdAt: Date }): ClientVideoUpdate {
  return { id: row.id, period: row.period, videoUrl: row.videoUrl, embedUrl: toEmbedUrl(row.videoUrl), note: row.note, createdAt: row.createdAt.toISOString() };
}

/** De meest recente videoboodschap voor een klant (of van een specifieke maand). */
export async function getClientVideoUpdate(clientId: string, period?: string): Promise<ClientVideoUpdate | null> {
  const where = period
    ? and(eq(clientVideoUpdates.clientId, clientId), eq(clientVideoUpdates.period, period), isNull(clientVideoUpdates.deletedAt))
    : and(eq(clientVideoUpdates.clientId, clientId), isNull(clientVideoUpdates.deletedAt));
  const [row] = await db
    .select({ id: clientVideoUpdates.id, period: clientVideoUpdates.period, videoUrl: clientVideoUpdates.videoUrl, note: clientVideoUpdates.note, createdAt: clientVideoUpdates.createdAt })
    .from(clientVideoUpdates)
    .where(where)
    .orderBy(desc(clientVideoUpdates.period))
    .limit(1);
  return row ? map(row) : null;
}
