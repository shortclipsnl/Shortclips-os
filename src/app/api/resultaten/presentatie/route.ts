import { NextResponse, type NextRequest } from "next/server";
import { can, getViewer } from "@/server/auth/context";
import { amsterdamToday, parsePeriodKey, resolvePeriod } from "@/lib/resultaten-overzicht";
import { loadPresentation } from "@/server/resultaten-presentatie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verse cijfers voor de presentatiemodus, zodat die zichzelf bijwerkt zonder herladen. */
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || viewer.isPortalUser || !can(viewer, "analytics:read")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const period = resolvePeriod(parsePeriodKey(req.nextUrl.searchParams.get("periode")), amsterdamToday());
  const data = await loadPresentation(period);
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
