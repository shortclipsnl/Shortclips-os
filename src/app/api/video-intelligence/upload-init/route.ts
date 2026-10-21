import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { videoAnalyses } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { createUploadTarget } from "@/server/video-intelligence/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXT_BY_TYPE: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
};
const ALLOWED = ["mp4", "mov", "webm", "mkv", "m4v"];
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB

/**
 * Stap 1 van de upload: maakt de analyse aan en geeft een plek terug waar de
 * browser het bestand naartoe uploadt (ondertekende Supabase-URL in productie,
 * lokale route in ontwikkeling). Zo gaat het bestand buiten de 4,5 MB-limiet van
 * Vercel-functies om.
 */
export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  if (!viewer.permissions.has("video_intelligence:run")) return NextResponse.json({ error: "Geen toegang." }, { status: 403 });

  let body: { clientId?: string; title?: string; filename?: string; mimeType?: string; size?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Onleesbaar verzoek." }, { status: 400 });
  }
  const clientId = String(body.clientId ?? "");
  const title = String(body.title ?? "").trim() || null;
  const mime = String(body.mimeType ?? "");
  const size = Number(body.size ?? 0);

  if (!clientId) return NextResponse.json({ error: "Kies een klant." }, { status: 400 });
  if (!hasClientAccess(viewer, clientId)) return NextResponse.json({ error: "Deze klant hoort niet bij jouw toegang." }, { status: 403 });
  if (Number.isFinite(size) && size > MAX_BYTES) return NextResponse.json({ error: "Bestand te groot (max 500 MB)." }, { status: 413 });

  const ext = EXT_BY_TYPE[mime] ?? (String(body.filename ?? "").split(".").pop() ?? "mp4").toLowerCase();
  if (!ALLOWED.includes(ext)) return NextResponse.json({ error: "Alleen videobestanden (mp4/mov/webm/mkv)." }, { status: 415 });

  const [created] = await db
    .insert(videoAnalyses)
    .values({
      clientId,
      title,
      sourceType: "upload",
      status: "queued",
      mimeType: mime || "video/mp4",
      fileSizeBytes: Number.isFinite(size) ? size : null,
      createdById: viewer.id,
    })
    .returning({ id: videoAnalyses.id });
  const id = created!.id;

  let target;
  try {
    target = await createUploadTarget(id, ext, mime);
  } catch (e) {
    return NextResponse.json({ error: `Opslag niet beschikbaar: ${String(e)}` }, { status: 500 });
  }
  await db.update(videoAnalyses).set({ mediaPath: target.key, mediaStore: target.store, updatedAt: new Date() }).where(eq(videoAnalyses.id, id));

  return NextResponse.json({ id, store: target.store, uploadUrl: target.uploadUrl, headers: target.headers });
}
