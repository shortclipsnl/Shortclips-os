import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { getPortalResultsForClient } from "@/server/portal";
import { getPeriodReviewForClient } from "@/server/period-review";
import { periodReportTitle, renderPeriodReportHtml } from "@/server/reports/pdf-period-html";
import { directieVariant, loadDirectieData } from "@/server/reports/directie";
import { directieTitle, renderDirectieHtml } from "@/server/reports/pdf-directie-html";
import { htmlToPdf } from "@/server/pdf/render";
import { parsePortalPeriod, periodResultOpts } from "@/lib/portal-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Interne PDF van de gekozen periode voor één klant: exact het rapport dat de
 * klant zelf uit het portaal downloadt (klantversie). Recht analytics:read en
 * harde klantscheiding; klanten komen hier nooit binnen.
 *
 * ?versie=directie of ?versie=overzicht geeft de directieversie van een maand. Intern is die
 * altijd op te vragen, zodat het team haar kan beoordelen; zolang de klant haar
 * nog niet kan zien staat er "Interne voorvertoning" op.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await getViewer();
  if (!viewer || viewer.isPortalUser) return new NextResponse(null, { status: 401 });
  if (!viewer.permissions.has("analytics:read")) return new NextResponse(null, { status: 403 });

  const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.slug, slug), isNull(clients.deletedAt))).limit(1);
  if (!client) return new NextResponse(null, { status: 404 });
  if (!hasClientAccess(viewer, client.id)) return new NextResponse(null, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const period = parsePortalPeriod({ periode: sp.get("periode") ?? undefined, van: sp.get("van") ?? undefined, tot: sp.get("tot") ?? undefined });
  const r = await getPortalResultsForClient(viewer, client.id, periodResultOpts(period));
  const review = await getPeriodReviewForClient(viewer, client.id, r, "klant");

  const variant = directieVariant(sp.get("versie"));
  let html: string;
  let docTitle = periodReportTitle(review);
  if (variant) {
    const data = await loadDirectieData(client.id, r, review);
    if (!data) return NextResponse.json({ error: "De directieversie bestaat alleen voor een hele maand. Voor een kwartaal is er de kwartaalrapportage." }, { status: 404 });
    html = renderDirectieHtml(data, variant, { concept: !data.beschikbaar.ok });
    docTitle = directieTitle(variant).replace(/\s+/g, "_");
  } else {
    html = renderPeriodReportHtml({ clientName: client.name, r, review });
  }

  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(html);
  } catch (e) {
    return NextResponse.json({ error: "PDF genereren is mislukt (Chrome beschikbaar?).", detail: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  const safe = (client.name || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || slug;
  const filename = `Shortclips_${docTitle}_${safe}_${period.key.replace(/[^0-9A-Za-z]+/g, "_")}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
