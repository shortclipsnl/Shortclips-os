import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, productionDays } from "@/db/schema";
import { getViewer } from "@/server/auth/context";
import { getBriefingForShoot } from "@/server/briefing/service";
import { htmlToPdf } from "@/server/pdf/render";
import { formatDateFull } from "@/lib/format";
import type { EditorBriefing } from "@/server/actions/ai-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Zelfstandige, compacte editor-briefing in de Shortclips-huisstijl. */
function renderBriefingHtml(opts: {
  clientName: string;
  shootTitle: string;
  shootDate: string;
  briefing: EditorBriefing;
}): string {
  const { clientName, shootTitle, shootDate, briefing } = opts;
  const intro = briefing.projectIntro;
  const specifiek = briefing.shorts.filter((s) => s.aandachtspunten.length > 0);

  const algemeen = intro.algemeneAandachtspunten.length
    ? `<section><h2>Algemene aandachtspunten</h2><ul>${intro.algemeneAandachtspunten.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></section>`
    : "";

  const overzicht = `<section><h2>Overzicht video's (${briefing.shorts.length})</h2><ol>${briefing.shorts
    .map((s, i) => `<li>${esc(s.titel || `Video ${i + 1}`)}</li>`)
    .join("")}</ol></section>`;

  const perVideo = specifiek.length
    ? `<section><h2>Specifieke aandachtspunten per video</h2>${specifiek
        .map(
          (s) =>
            `<div class="vid"><p class="vt">${esc(s.titel)}</p><ul>${s.aandachtspunten
              .map((a) => `<li>${esc(a)}</li>`)
              .join("")}</ul></div>`,
        )
        .join("")}</section>`
    : "";

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, -apple-system, system-ui, sans-serif; color: #00003b; font-size: 11.5px; line-height: 1.5; margin: 0; }
  .head { border-bottom: 3px solid #FF6A00; padding-bottom: 14px; margin-bottom: 20px; }
  .kicker { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #2E90FA; font-weight: 700; }
  h1 { font-size: 22px; margin: 4px 0 8px; }
  .meta { color: #51516b; font-size: 11px; }
  .meta b { color: #00003b; }
  h2 { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #6f6f82; margin: 22px 0 6px; }
  ul, ol { margin: 0; padding-left: 20px; }
  li { margin: 2px 0; }
  .vid { margin: 0 0 10px; }
  .vt { font-weight: 600; margin: 0 0 2px; }
  section:first-of-type h2 { margin-top: 0; }
</style></head><body>
  <div class="head">
    <div class="kicker">Editor Briefing · Shortclips</div>
    <h1>${esc(shootTitle)}</h1>
    <div class="meta"><b>Klant:</b> ${esc(clientName)} &nbsp;·&nbsp; <b>Opname:</b> ${esc(shootDate)} &nbsp;·&nbsp; <b>Aantal video's:</b> ${briefing.shorts.length}</div>
    ${intro.omschrijving ? `<div class="meta" style="margin-top:6px">${esc(intro.omschrijving)}</div>` : ""}
  </div>
  ${algemeen}
  ${overzicht}
  ${perVideo}
</body></html>`;
}

/**
 * Editor-briefing van een opname als PDF. Toegang via `getBriefingForShoot`
 * (intern én de toegewezen editor binnen zijn klantscope). Rendert de compacte
 * HTML direct — het script zelf staat elders en wordt hier niet herhaald.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ productionDayId: string }> }) {
  const { productionDayId } = await params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });

  // Scope + bestaan: gooit ForbiddenError bij geen toegang, geeft null bij onbekend.
  let briefing;
  try {
    briefing = await getBriefingForShoot(viewer, productionDayId);
  } catch {
    return new NextResponse(null, { status: 403 });
  }
  if (!briefing || !briefing.content) return new NextResponse(null, { status: 404 });

  const [day] = await db
    .select({ title: productionDays.title, scheduledOn: productionDays.scheduledOn, clientName: clients.name })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
    .limit(1);
  if (!day) return new NextResponse(null, { status: 404 });

  const html = renderBriefingHtml({
    clientName: day.clientName,
    shootTitle: day.title,
    shootDate: formatDateFull(day.scheduledOn),
    briefing: briefing.content,
  });

  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(html);
  } catch (e) {
    return NextResponse.json(
      { error: "PDF genereren is mislukt. Controleer of Chrome beschikbaar is (CHROME_PATH).", detail: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }

  const safe = (day.clientName || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "klant";
  const datum = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Shortclips_Briefing_${safe}_${datum}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
