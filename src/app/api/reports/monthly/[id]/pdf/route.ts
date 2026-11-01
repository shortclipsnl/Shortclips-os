import { NextResponse } from "next/server";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { loadReportPdfData } from "@/server/reports/service";
import { renderMonthlyReportHtml } from "@/server/reports/pdf-html";
import { htmlToPdf } from "@/server/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function filename(name: string, period: string): string {
  const safe = (name || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "klant";
  return `Shortclips_Maandrapportage_${safe}_${period.replace("-", "_")}.pdf`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!viewer.permissions.has("reports:read")) return new NextResponse(null, { status: 403 });

  const data = await loadReportPdfData(id);
  if (!data) return new NextResponse(null, { status: 404 });
  if (!hasClientAccess(viewer, data.clientId)) return new NextResponse(null, { status: 403 });

  const html = renderMonthlyReportHtml({
    clientName: data.clientName, logoUrl: data.logoUrl, periodLabel: data.periodLabel,
    totals: data.totals as never, analysis: data.analysis, klanttekst: data.klanttekst,
  });
  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(html);
  } catch (e) {
    return NextResponse.json({ error: "PDF genereren is mislukt (Chrome beschikbaar?).", detail: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename(data.clientName, data.period)}"`, "Cache-Control": "no-store" },
  });
}
