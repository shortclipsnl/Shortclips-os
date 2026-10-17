import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { videoAnalyses } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { analysisDir, framesDir } from "@/server/video-intelligence/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serveert een frame/thumbnail-JPEG van een analyse (?name=thumb.jpg of
 * shot_3.jpg). Klant-gescoped; naam wordt tot basename gereduceerd zodat er geen
 * pad-traversal mogelijk is.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!viewer.permissions.has("video_intelligence:read")) return new NextResponse(null, { status: 403 });

  const rawName = req.nextUrl.searchParams.get("name") ?? "thumb.jpg";
  const name = path.basename(rawName);
  if (!/^[a-z0-9_.-]+\.jpg$/i.test(name)) return new NextResponse(null, { status: 400 });

  const [a] = await db.select({ clientId: videoAnalyses.clientId }).from(videoAnalyses).where(eq(videoAnalyses.id, id)).limit(1);
  if (!a) return new NextResponse(null, { status: 404 });
  if (!hasClientAccess(viewer, a.clientId)) return new NextResponse(null, { status: 403 });

  const dir = name === "thumb.jpg" ? analysisDir(id) : framesDir(id);
  try {
    const buf = await readFile(path.join(dir, name));
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
