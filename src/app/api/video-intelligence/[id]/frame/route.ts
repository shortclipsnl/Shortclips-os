import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { videoAnalyses, videoShots } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serveert een frame/thumbnail-JPEG van een analyse (?name=thumb.jpg of
 * shot_3.jpg). De beeldjes staan als base64 in de database, zodat dit ook werkt
 * zonder vaste schijf (productie op Vercel). Klant-gescoped.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!viewer.permissions.has("video_intelligence:read")) return new NextResponse(null, { status: 403 });

  const name = (req.nextUrl.searchParams.get("name") ?? "thumb.jpg").toLowerCase();

  const [a] = await db
    .select({ clientId: videoAnalyses.clientId, thumbnailData: videoAnalyses.thumbnailData })
    .from(videoAnalyses)
    .where(eq(videoAnalyses.id, id))
    .limit(1);
  if (!a) return new NextResponse(null, { status: 404 });
  if (!hasClientAccess(viewer, a.clientId)) return new NextResponse(null, { status: 403 });

  let b64: string | null = null;
  if (name === "thumb.jpg") {
    b64 = a.thumbnailData;
  } else {
    const m = name.match(/^shot_(\d+)\.jpg$/);
    if (!m) return new NextResponse(null, { status: 400 });
    const [s] = await db
      .select({ thumbnailData: videoShots.thumbnailData })
      .from(videoShots)
      .where(and(eq(videoShots.analysisId, id), eq(videoShots.idx, Number(m[1]))))
      .limit(1);
    b64 = s?.thumbnailData ?? null;
  }

  if (!b64) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(Buffer.from(b64, "base64")), {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
}
