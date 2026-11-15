import { NextResponse } from "next/server";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { canSeeQuarterReports, getPublishedKlantRapport, isQuarterTeamReader, klantRapportVanWerkversie, loadQuarterPdfData } from "@/server/quarterly/service";
import { renderQuarterDirectieHtml, renderQuarterInternHtml, renderQuarterKlantHtml } from "@/server/quarterly/pdf-html";
import { APPROVED_QUARTER_STATUSES } from "@/lib/kwartaal";
import { hasKlantInhoud } from "@/lib/kwartaal-inhoud";
import { toKlantMetrics } from "@/lib/kwartaal-klant";
import { htmlToPdf } from "@/server/pdf/render";
import { auditLog } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function filename(name: string, key: string, versie: string): string {
  const safe = (name || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "klant";
  const soort = versie === "intern" ? "Intern_Kwartaalrapport" : versie === "directie" ? "Directieoverzicht" : "Kwartaalrapportage";
  return `Shortclips_${soort}_${safe}_${key.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`;
}

function withConceptBar(html: string, voorlopig: boolean): string {
  const tekst = `CONCEPT · nog niet goedgekeurd · niet naar de klant versturen${voorlopig ? " · voorlopige cijfers" : ""}`;
  const bar = `<div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#3b2300;font:600 10px/1 Poppins,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;text-align:center;padding:6px 0">${tekst}</div>`;
  return html.replace("<body>", `<body>${bar}`);
}

/**
 * Interne PDF-route voor de kwartaalrapportage:
 *  ?versie=klant    (standaard) de klantversie van de werkversie;
 *  ?versie=intern   de interne rapportage (alleen voor medewerkers);
 *  ?versie=directie het directieoverzicht van één pagina;
 *  ?bron=portaal    de versie die nu in het klantportaal staat (bevroren);
 *  ?download=1      als bijlage downloaden.
 * Klanten komen hier nooit binnen; zij gebruiken /api/portal/kwartaalrapport.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const v = url.searchParams.get("versie");
  const versie = v === "intern" ? "intern" : v === "directie" ? "directie" : "klant";
  const portaal = url.searchParams.get("bron") === "portaal";
  const download = url.searchParams.get("download") === "1";

  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!canSeeQuarterReports(viewer)) return new NextResponse(null, { status: 403 });

  const data = await loadQuarterPdfData(id);
  if (!data) return NextResponse.json({ error: "Deze rapportage is nog niet gegenereerd." }, { status: 404 });
  if (!hasClientAccess(viewer, data.clientId)) return new NextResponse(null, { status: 403 });
  const approved = APPROVED_QUARTER_STATUSES.includes(data.status);
  if (isQuarterTeamReader(viewer) && !approved) return new NextResponse(null, { status: 403 });
  if (!hasKlantInhoud(data.klant)) return NextResponse.json({ error: "Deze rapportage heeft nog geen inhoud. Genereer haar eerst." }, { status: 409 });

  let html: string;
  if (versie === "intern") {
    html = renderQuarterInternHtml({
      clientName: data.clientName, pmName: data.pmName, title: data.title, periodLabel: data.quarter.label, periodStart: data.quarter.from, periodEnd: data.quarter.to,
      status: data.status, voorlopig: data.voorlopig, versie: data.versie, approvedAt: data.approvedAt, metrics: data.metrics, klant: data.klant,
      klantMetrics: toKlantMetrics(data.metrics, data.klant), intern: data.intern, ontbrekend: data.ontbrekend, health: data.health, thumbs: data.thumbs,
    });
  } else {
    const rapport = portaal ? await getPublishedKlantRapport(id) : await klantRapportVanWerkversie(id);
    if (!rapport) return NextResponse.json({ error: portaal ? "Er staat geen versie in het klantportaal." : "Rapportage niet gevonden." }, { status: 404 });
    html = versie === "directie" ? renderQuarterDirectieHtml(rapport) : renderQuarterKlantHtml(rapport);
    // Een klantversie die niet is goedgekeurd krijgt op elke pagina een CONCEPT-balk.
    if (!portaal && !approved) html = withConceptBar(html, data.voorlopig);
  }
  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(html);
  } catch (e) {
    return NextResponse.json({ error: "PDF genereren is mislukt (Chrome beschikbaar?).", detail: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  if (download) await auditLog({ viewer, action: `quarter_report.pdf_download_${versie}`, entityType: "quarterly_report", entityId: id, clientId: data.clientId }).catch(() => undefined);
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename(data.clientName, data.quarter.key, versie)}"`,
      "Cache-Control": "no-store",
    },
  });
}
