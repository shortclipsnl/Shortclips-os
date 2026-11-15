import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { getPortalResultsForClient } from "@/server/portal";
import { getPeriodReviewForClient } from "@/server/period-review";
import { periodReportTitle, renderPeriodReportHtml } from "@/server/reports/pdf-period-html";
import { htmlToPdf } from "@/server/pdf/render";
import { parsePortalPeriod, periodResultOpts } from "@/lib/portal-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Interne PDF van de gekozen periode voor één klant: exact het rapport dat de
 * klant zelf uit het portaal downloadt (klantversie). Recht analytics:read en
 * harde klantscheiding; klanten komen hier nooit binnen.
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

  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(renderPeriodReportHtml({ clientName: client.name, r, review }));
  } catch (e) {
    return NextResponse.json({ error: "PDF genereren is mislukt (Chrome beschikbaar?).", detail: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  const safe = (client.name || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || slug;
  const filename = `Shortclips_${periodReportTitle(review)}_${safe}_${period.key.replace(/[^0-9A-Za-z]+/g, "_")}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
