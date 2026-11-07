import { NextResponse, type NextRequest } from "next/server";
import { ensureThumbnail, frameAssetForViewer } from "@/server/frame-library-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Thumbnail van een video uit de Frame-bibliotheek (alleen voor de eigen klant). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await frameAssetForViewer(id);
  if (!asset) return new NextResponse(null, { status: 404 });
  const url = await ensureThumbnail(asset);
  if (!url) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(url, { status: 307, headers: { "Cache-Control": "private, max-age=900" } });
}
