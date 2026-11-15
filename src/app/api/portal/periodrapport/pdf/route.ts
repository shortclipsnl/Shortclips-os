import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/server/auth/context";
import { getPortalBranding, getPortalResults } from "@/server/portal";
import { getPeriodReview } from "@/server/period-review";
import { periodReportTitle, renderPeriodReportHtml } from "@/server/reports/pdf-period-html";
import { htmlToPdf } from "@/server/pdf/render";
import { parsePortalPeriod, periodResultOpts } from "@/lib/portal-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Portaal-PDF van de gekozen periode (kwartaalrapportage, maandoverzicht of een
 * eigen periode). Uitsluitend de eigen cijfers van de ingelogde klant.
 */
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !viewer.isPortalUser || !viewer.clientId) return new NextResponse(null, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const period = parsePortalPeriod({ periode: sp.get("periode") ?? undefined, van: sp.get("van") ?? undefined, tot: sp.get("tot") ?? undefined });
  const [r, brand] = await Promise.all([getPortalResults(viewer, periodResultOpts(period)), getPortalBranding(viewer)]);
  const review = await getPeriodReview(viewer, r);
  if (!review) return new NextResponse(null, { status: 404 });

  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(renderPeriodReportHtml({ clientName: brand.name, r, review }));
  } catch (e) {
    return NextResponse.json({ error: "PDF genereren is mislukt.", detail: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  const safe = (brand.name || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "klant";
  const filename = `Shortclips_${periodReportTitle(review)}_${safe}_${period.key.replace(/[^0-9A-Za-z]+/g, "_")}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
