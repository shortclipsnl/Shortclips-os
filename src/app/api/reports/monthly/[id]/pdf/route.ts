import { NextResponse } from "next/server";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { APPROVED_STATUSES, canSeeReports, isTeamReader, loadReportPdfData } from "@/server/reports/service";
import { renderMonthlyReportHtml } from "@/server/reports/pdf-html";
import { renderInternReportHtml } from "@/server/reports/pdf-intern-html";
import { htmlToPdf } from "@/server/pdf/render";
import { auditLog } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS_LABEL: Record<string, string> = {
  gegevens_verzamelen: "In de wachtrij", analyse_bezig: "Analyse bezig", klaar_voor_controle: "Wacht op controle",
  aanpassing_nodig: "Aanpassing nodig", goedgekeurd: "Goedgekeurd", gepubliceerd: "Gepubliceerd", mislukt: "Mislukt",
};

function filename(name: string, period: string, versie: "klant" | "intern"): string {
  const safe = (name || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "klant";
  return versie === "intern"
    ? `Shortclips_Intern_Teamrapport_${safe}_${period.replace("-", "_")}.pdf`
    : `Shortclips_Maandrapportage_${safe}_${period.replace("-", "_")}.pdf`;
}

/**
 * Interne PDF-route voor beide versies:
 *  ?versie=klant  (standaard) de klantversie;
 *  ?versie=intern de interne teamrapportage;
 *  ?download=1    als bijlage downloaden i.p.v. in de browser openen.
 * Klanten (portaal) komen hier nooit binnen; zij gebruiken /api/portal/maandrapport.
 * Teamleden zonder controlerecht krijgen alleen goedgekeurde rapporten.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const versie = url.searchParams.get("versie") === "intern" ? "intern" : "klant";
  const download = url.searchParams.get("download") === "1";

  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!canSeeReports(viewer)) return new NextResponse(null, { status: 403 });

  const data = await loadReportPdfData(id);
  if (!data) return new NextResponse(null, { status: 404 });
  if (!hasClientAccess(viewer, data.clientId)) return new NextResponse(null, { status: 403 });
  if (isTeamReader(viewer) && !APPROVED_STATUSES.includes(data.status)) return new NextResponse(null, { status: 403 });
  if (!data.analysis) return NextResponse.json({ error: "Dit rapport heeft nog geen analyse. Genereer het rapport eerst." }, { status: 409 });

  const html = versie === "intern"
    ? renderInternReportHtml({
        clientName: data.clientName, periodLabel: data.periodLabel, pmName: data.pmName, statusLabel: STATUS_LABEL[data.status] ?? data.status,
        approvedAt: data.approvedAt, totals: data.totals as never, analysis: data.analysis, beoordeling: data.beoordeling, ontbrekend: data.ontbrekend,
        videos: data.videos.map((v) => ({ ...v, inzicht: v.les })),
      })
    : renderMonthlyReportHtml({
        clientName: data.clientName, logoUrl: data.logoUrl, periodLabel: data.periodLabel,
        totals: data.totals as never, analysis: data.analysis, klanttekst: data.klanttekst, videos: data.videos,
      });
  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(html);
  } catch (e) {
    return NextResponse.json({ error: "PDF genereren is mislukt (Chrome beschikbaar?).", detail: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  if (download) await auditLog({ viewer, action: `report.pdf_download_${versie}`, entityType: "client_report", entityId: id, clientId: data.clientId }).catch(() => undefined);
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename(data.clientName, data.period, versie)}"`,
      "Cache-Control": "no-store",
    },
  });
}
