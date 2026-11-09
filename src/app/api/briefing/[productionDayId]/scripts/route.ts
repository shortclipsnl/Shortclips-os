import { NextResponse, type NextRequest } from "next/server";
import { ForbiddenError, getViewer } from "@/server/auth/context";
import { loadBriefingFor } from "@/server/briefing/access";
import { scriptPagesPdf } from "@/server/briefing/script-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Alleen de scriptpagina's van de opname (exact uit de script-PDF). Zelfde toegang als de briefing. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ productionDayId: string }> }) {
  const { productionDayId } = await params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  let loaded;
  try {
    loaded = await loadBriefingFor(viewer, productionDayId);
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse(null, { status: 403 });
    throw e;
  }
  if (!loaded) return new NextResponse(null, { status: 404 });
  const pdf = await scriptPagesPdf(loaded.doc);
  if (!pdf) return new NextResponse(null, { status: 404 });
  const buf = Buffer.from(pdf);
  return new NextResponse(buf, {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="Scripts.pdf"', "Cache-Control": "private, no-store" },
  });
}
