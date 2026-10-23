import { NextResponse } from "next/server";
import { getViewer, isOwner } from "@/server/auth/context";
import { getAllVermogenDocs } from "@/server/vermogen/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Alle vermogensdocumenten voor de eigenaar. Niet-ingelogd → 401,
 * ingelogd maar geen eigenaar → 403. De dashboardpagina (shim) laadt hier
 * de volledige toestand mee.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  if (!isOwner(viewer)) return NextResponse.json({ error: "Alleen voor de eigenaar." }, { status: 403 });

  const docs = await getAllVermogenDocs();
  return NextResponse.json(docs);
}
