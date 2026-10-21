import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { videoAnalyses } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { writeDiskMedia } from "@/server/video-intelligence/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lokale upload-bestemming (alleen ontwikkeling, disk-opslag): ontvangt de bytes
 * van het bronbestand en schrijft ze naar .data. In productie uploadt de browser
 * rechtstreeks naar Supabase en wordt deze route niet gebruikt.
 */
export async function PUT(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!viewer.permissions.has("video_intelligence:run")) return new NextResponse(null, { status: 403 });

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const ext = (req.nextUrl.searchParams.get("ext") ?? "mp4").toLowerCase();
  if (!/^[a-z0-9-]+$/i.test(id) || !/^[a-z0-9]+$/i.test(ext)) return NextResponse.json({ error: "Ongeldige parameters." }, { status: 400 });

  const [a] = await db.select({ clientId: videoAnalyses.clientId }).from(videoAnalyses).where(eq(videoAnalyses.id, id)).limit(1);
  if (!a) return new NextResponse(null, { status: 404 });
  if (!hasClientAccess(viewer, a.clientId)) return new NextResponse(null, { status: 403 });

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return NextResponse.json({ error: "Leeg bestand." }, { status: 400 });
  const key = await writeDiskMedia(id, ext, buf);
  await db.update(videoAnalyses).set({ mediaPath: key, mediaStore: "disk", fileSizeBytes: buf.length, updatedAt: new Date() }).where(eq(videoAnalyses.id, id));

  return NextResponse.json({ ok: true });
}
