import { NextResponse, type NextRequest } from "next/server";
import { frameAssetForViewer } from "@/server/frame-library-media";
import { frameio } from "@/server/integrations/frameio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Afspelen van een Frame-video in het portaal: een kortlevende, ondertekende
 * H.264-link rechtstreeks van Frame (geen publieke deellink). Alleen voor
 * gebruikers met toegang tot de klant van de video.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await frameAssetForViewer(id);
  if (!asset) return new NextResponse(null, { status: 404 });
  try {
    const url = await frameio.getFilePlayback(asset.mediaFileId);
    if (!url) return new NextResponse(null, { status: 404 });
    return NextResponse.redirect(url, { status: 307, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
