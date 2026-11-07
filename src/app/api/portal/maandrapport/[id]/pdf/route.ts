import { NextResponse } from "next/server";
import { getViewer } from "@/server/auth/context";
import { loadReportPdfData } from "@/server/reports/service";
import { renderMonthlyReportHtml } from "@/server/reports/pdf-html";
import { htmlToPdf } from "@/server/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Portaal-PDF: alleen het eigen, gepubliceerde maandrapport van de klant. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer || !viewer.isPortalUser) return new NextResponse(null, { status: 401 });
  const ownClient = viewer.clientScope && viewer.clientScope.length ? viewer.clientScope[0] : null;
  if (!ownClient) return new NextResponse(null, { status: 403 });

  const data = await loadReportPdfData(id);
  if (!data) return new NextResponse(null, { status: 404 });
  // Harde scope: eigen klant én gepubliceerd.
  if (data.clientId !== ownClient || data.status !== "gepubliceerd") return new NextResponse(null, { status: 403 });

  const html = renderMonthlyReportHtml({
    clientName: data.clientName, logoUrl: data.logoUrl, periodLabel: data.periodLabel,
    totals: data.totals as never, analysis: data.analysis, klanttekst: data.klanttekst, videos: data.klantVideos,
  });
  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(html);
  } catch (e) {
    return NextResponse.json({ error: "PDF genereren is mislukt.", detail: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  const safe = (data.clientName || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "klant";
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Shortclips_Maandrapportage_${safe}_${data.period.replace("-", "_")}.pdf"`, "Cache-Control": "no-store" },
  });
}
