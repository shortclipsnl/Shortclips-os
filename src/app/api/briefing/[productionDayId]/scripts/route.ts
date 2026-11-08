import { NextResponse, type NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbAssetParts } from "@/db/schema";
import { ForbiddenError, getViewer } from "@/server/auth/context";
import { loadBriefingFor } from "@/server/briefing/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Alleen de scriptpagina's van de opname (exact uit de script-PDF). Zelfde toegang als de briefing. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ productionDayId: string }> }) {
  const { productionDayId } = await params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  let loaded;
  try {
    loaded = await loadBriefingFor(viewer, productionDayId);
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse(null, { status: 403 });
    throw e;
  }
  const assetId = loaded?.doc.scriptPagesAssetId;
  if (!assetId) return new NextResponse(null, { status: 404 });
  const parts = await db
    .select({ data: kbAssetParts.data })
    .from(kbAssetParts)
    .where(eq(kbAssetParts.assetId, assetId))
    .orderBy(asc(kbAssetParts.partNo));
  const buf = Buffer.concat(parts.map((p) => Buffer.from(p.data)));
  return new NextResponse(buf, {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="Scripts.pdf"', "Cache-Control": "private, no-store" },
  });
}
