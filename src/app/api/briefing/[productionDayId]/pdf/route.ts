import { NextResponse, type NextRequest } from "next/server";
import { ForbiddenError, getViewer } from "@/server/auth/context";
import { briefingHtml, loadBriefingFor } from "@/server/briefing/access";
import { htmlToPdf } from "@/server/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Editor-briefing als PDF: exact dezelfde opmaak als de weergave in het
 * portaal. Toegang via `loadBriefingFor` (team binnen de eigen klanten,
 * editors alleen voor hun eigen opname).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ productionDayId: string }> }) {
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
  if (!loaded || loaded.doc.scripts.length === 0) return new NextResponse(null, { status: 404 });

  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(await briefingHtml(loaded.doc, "pdf"));
  } catch (e) {
    return NextResponse.json(
      { error: "PDF genereren is mislukt. Controleer of Chrome beschikbaar is (CHROME_PATH).", detail: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }

  const safe = (loaded.doc.client.name || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "klant";
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="Editor_briefing_${safe}_${loaded.doc.session.date}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
