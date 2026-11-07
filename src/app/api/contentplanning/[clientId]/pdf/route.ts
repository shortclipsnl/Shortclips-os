import { NextResponse } from "next/server";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { generateContentPlanningPdf, pdfResponseHeaders } from "@/server/content-planning/pdf";
import { auditLog } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Team Shortclips downloadt dezelfde contentplanning-PDF als de klant, vanuit
 * de interne contentplanning. Alleen interne gebruikers met leesrecht op de
 * contentplanning én toegang tot deze klant. Klantaccounts komen hier nooit in.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (viewer.isPortalUser || viewer.isEditorOnly) return new NextResponse(null, { status: 403 });
  if (!viewer.permissions.has("calendar:read") && !viewer.permissions.has("calendar:write")) return new NextResponse(null, { status: 403 });
  if (!UUID.test(clientId)) return new NextResponse(null, { status: 404 });
  if (!hasClientAccess(viewer, clientId)) return new NextResponse(null, { status: 403 });

  let out: Awaited<ReturnType<typeof generateContentPlanningPdf>>;
  try {
    out = await generateContentPlanningPdf(clientId);
  } catch (e) {
    return NextResponse.json({ error: "De PDF kon niet worden gemaakt (Chrome beschikbaar?).", detail: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  if (!out) return new NextResponse(null, { status: 404 });
  await auditLog({ viewer, action: "content_planning.pdf_download_team", entityType: "client", entityId: clientId, clientId }).catch(() => undefined);
  return new NextResponse(Buffer.from(out.pdf), { status: 200, headers: pdfResponseHeaders(out.filename) });
}
