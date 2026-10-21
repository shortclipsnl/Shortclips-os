import { NextResponse, type NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { videoAnalyses } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { fromStoreRelative } from "@/server/video-intelligence/paths";
import { signedMediaUrl, type MediaStore } from "@/server/video-intelligence/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streamt het lokaal opgeslagen bronbestand van een analyse, met range-support
 * zodat de videospeler kan scrubben. Harde klantscheiding: alleen wie het recht
 * video_intelligence:read heeft én toegang tot de betreffende klant.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!viewer.permissions.has("video_intelligence:read")) return new NextResponse(null, { status: 403 });

  const [a] = await db
    .select({ clientId: videoAnalyses.clientId, mediaPath: videoAnalyses.mediaPath, mediaStore: videoAnalyses.mediaStore, mimeType: videoAnalyses.mimeType })
    .from(videoAnalyses)
    .where(eq(videoAnalyses.id, id))
    .limit(1);
  if (!a || !a.mediaPath) return new NextResponse(null, { status: 404 });
  if (!hasClientAccess(viewer, a.clientId)) return new NextResponse(null, { status: 403 });

  // Supabase-opslag: stuur de speler door naar een tijdelijke, ondertekende URL.
  if ((a.mediaStore as MediaStore) === "supabase") {
    const url = await signedMediaUrl("supabase", a.mediaPath);
    if (!url) return new NextResponse(null, { status: 404 });
    return NextResponse.redirect(url, { status: 302 });
  }

  const abs = fromStoreRelative(a.mediaPath);
  let size: number;
  try {
    size = (await stat(abs)).size;
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  const type = a.mimeType || "video/mp4";
  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    const start = m && m[1] ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : size - 1;
    if (start >= size || end >= size || start > end) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(abs, { start, end })) as unknown as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    },
  });
}
