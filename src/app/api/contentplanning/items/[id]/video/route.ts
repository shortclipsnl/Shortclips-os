import { NextResponse } from "next/server";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { contentVideoCandidates, getContentItemForVideo, resolveContentVideo, setContentVideo } from "@/server/content-video";
import { auditLog } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Video bij een bericht in de contentplanning (intern).
 * GET  → gekoppelde video (handmatig of automatisch), met ?kandidaten=1 ook de
 *        video's van de klant om zelf te kiezen.
 * POST → { frameAssetId: string | null } handmatig koppelen of terug naar automatisch.
 * Alleen interne medewerkers met recht op de contentplanning én toegang tot de klant.
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

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id, false);
  if ("error" in g) return g.error;
  const withCandidates = new URL(req.url).searchParams.get("kandidaten") === "1";
  const [video, candidates] = await Promise.all([
    resolveContentVideo(g.item),
    withCandidates ? contentVideoCandidates(g.item) : Promise.resolve(null),
  ]);
  return NextResponse.json(
    { video, candidates, canEdit: g.viewer.permissions.has("calendar:write") },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id, true);
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => null)) as { frameAssetId?: unknown } | null;
  const frameAssetId = typeof body?.frameAssetId === "string" && /^[0-9a-f-]{36}$/i.test(body.frameAssetId) ? body.frameAssetId : null;
  if (body?.frameAssetId && !frameAssetId) return NextResponse.json({ error: "Ongeldige video." }, { status: 400 });
  const ok = await setContentVideo(g.item, frameAssetId);
  if (!ok) return NextResponse.json({ error: "Deze video hoort niet bij deze klant." }, { status: 400 });
  await auditLog({
    viewer: g.viewer,
    action: frameAssetId ? "content_calendar.video_linked" : "content_calendar.video_auto",
    entityType: "content_calendar",
    entityId: g.item.id,
    clientId: g.item.clientId,
  }).catch(() => undefined);
  const video = await resolveContentVideo({ ...g.item, frameAssetId });
  return NextResponse.json({ video });
}
