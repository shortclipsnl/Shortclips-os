import { NextResponse } from "next/server";
import { getViewer } from "@/server/auth/context";
import { generateContentPlanningPdf, pdfResponseHeaders } from "@/server/content-planning/pdf";
import { auditLog } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Klant downloadt de eigen contentplanning als PDF. Er gaat bewust géén
 * klant-id mee in de URL: de klant is altijd de eigen klant uit de sessie, dus
 * een klant kan nooit de planning van een andere klant opvragen.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!viewer.isPortalUser || !viewer.clientId) return new NextResponse(null, { status: 403 });

  let out: Awaited<ReturnType<typeof generateContentPlanningPdf>>;
  try {
    out = await generateContentPlanningPdf(viewer.clientId);
  } catch (e) {
    return NextResponse.json({ error: "De PDF kon niet worden gemaakt. Probeer het zo nog eens.", detail: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  if (!out) return new NextResponse(null, { status: 404 });
  await auditLog({ viewer, action: "content_planning.pdf_download", entityType: "client", entityId: viewer.clientId, clientId: viewer.clientId }).catch(() => undefined);
  return new NextResponse(Buffer.from(out.pdf), { status: 200, headers: pdfResponseHeaders(out.filename) });
}
