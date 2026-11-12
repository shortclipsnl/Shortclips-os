import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { draaiboekNotes, draaiboeken, productionDays } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { canManageDraaiboek } from "@/server/draaiboek/service";

export const dynamic = "force-dynamic";

/** Ingesproken notitie afspelen: alleen voor de videograaf van de opname en Team Shortclips. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer || viewer.isPortalUser) return new Response("Niet toegestaan", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Niet gevonden", { status: 404 });
  const [n] = await db
    .select({
      audio: draaiboekNotes.audio,
      mime: draaiboekNotes.audioMime,
      clientId: draaiboeken.clientId,
      sentToId: draaiboeken.sentToId,
      videographerId: productionDays.videographerId,
    })
    .from(draaiboekNotes)
    .innerJoin(draaiboeken, eq(draaiboeken.id, draaiboekNotes.draaiboekId))
    .innerJoin(productionDays, eq(productionDays.id, draaiboeken.productionDayId))
    .where(and(eq(draaiboekNotes.id, id), isNull(draaiboekNotes.deletedAt)))
    .limit(1);
  if (!n || !n.audio) return new Response("Niet gevonden", { status: 404 });
  const assigned = n.sentToId === viewer.id || n.videographerId === viewer.id;
  if (!assigned && !(canManageDraaiboek(viewer) && hasClientAccess(viewer, n.clientId))) return new Response("Niet toegestaan", { status: 403 });
  return new Response(new Uint8Array(n.audio), {
    headers: { "Content-Type": n.mime || "audio/webm", "Content-Length": String(n.audio.length), "Cache-Control": "private, no-store" },
  });
}
