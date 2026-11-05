import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Oude link naar de Editing Guide. De guides staan sinds nov 2026 in de centrale
 * bron (client_documents); deze route stuurt door naar de vaste link daar, zodat
 * eventuele bewaarde links blijven werken.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const url = new URL(`/api/klantdocumenten/${clientId}/editing_guide`, req.url);
  if (new URL(req.url).searchParams.get("download") === "1") url.searchParams.set("download", "1");
  return NextResponse.redirect(url, 307);
}
