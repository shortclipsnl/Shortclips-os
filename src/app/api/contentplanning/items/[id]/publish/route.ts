import { NextResponse } from "next/server";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { getContentItemForVideo } from "@/server/content-video";
import { getPublishingView, planViaMetricool, revokePlanning, setPublishMode } from "@/server/publishing";
import { auditLog } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Publiceren van één bericht in de contentplanning.
 * GET  → huidige keuze (handmatig/Metricool), kanalen en status.
 * POST → { action: "mode", mode } | { action: "plan", confirm: true } | { action: "revoke" }
 * Alleen interne medewerkers met schrijfrecht op de contentplanning én toegang tot de klant.
 * "plan" werkt alleen met confirm: true (de bevestiging "Ja, inplannen").
 */
async function guard(id: string, write: boolean) {
  const viewer = await getViewer();
  if (!viewer) return { error: new NextResponse(null, { status: 401 }) } as const;
  if (viewer.isPortalUser || viewer.isEditorOnly) return { error: new NextResponse(null, { status: 403 }) } as const;
  const ok = write ? viewer.permissions.has("calendar:write") : viewer.permissions.has("calendar:read") || viewer.permissions.has("calendar:write");
  if (!ok) return { error: new NextResponse(null, { status: 403 }) } as const;
  const item = await getContentItemForVideo(id);
  if (!item || !hasClientAccess(viewer, item.clientId)) return { error: new NextResponse(null, { status: 404 }) } as const;
  return { viewer, item } as const;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id, false);
  if ("error" in g) return g.error;
  const view = await getPublishingView(id);
  return NextResponse.json({ view, canEdit: g.viewer.permissions.has("calendar:write") }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id, true);
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => null)) as { action?: string; mode?: string; confirm?: boolean } | null;
  let result;
  if (body?.action === "mode" && (body.mode === "handmatig" || body.mode === "metricool")) result = await setPublishMode(id, body.mode);
  else if (body?.action === "plan" && body.confirm === true) result = await planViaMetricool(id, g.viewer.id);
  else if (body?.action === "revoke") result = await revokePlanning(id);
  else return NextResponse.json({ error: "Ongeldige actie." }, { status: 400 });
  await auditLog({
    viewer: g.viewer,
    action: `content_calendar.publish_${body.action}`,
    entityType: "content_calendar",
    entityId: id,
    clientId: g.item.clientId,
    changes: { mode: body.mode ?? null, ok: result.ok, message: result.message },
  }).catch(() => undefined);
  const view = await getPublishingView(id);
  return NextResponse.json({ result, view }, { status: result.ok ? 200 : 422 });
}
