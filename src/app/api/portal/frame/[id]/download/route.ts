import { NextResponse, type NextRequest } from "next/server";
import { frameAssetForViewer } from "@/server/frame-library-media";
import { frameio } from "@/server/integrations/frameio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloaden van een Frame-video vanuit het klantportaal: een kortlevende,
 * ondertekende download-link rechtstreeks van Frame (geen publieke deellink).
 * Alleen voor gebruikers met toegang tot de klant van de video — zo kan een klant
 * uitsluitend zijn eigen materiaal downloaden.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await frameAssetForViewer(id);
  if (!asset) return new NextResponse(null, { status: 404 });
  try {
    const url = await frameio.getFileDownload(asset.mediaFileId);
    if (!url) return new NextResponse(null, { status: 404 });
    return NextResponse.redirect(url, { status: 307, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
