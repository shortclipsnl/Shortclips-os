import { NextResponse } from "next/server";
import { getViewer } from "@/server/auth/context";
import { getScreenReel } from "@/server/screen-reel";
import { getScreenData } from "@/server/screen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verse data voor het kantoorscherm (video's + periodecijfers), zodat het scherm
 * zichzelf bijwerkt zonder de pagina te herladen. Alleen voor het team.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer || viewer.isPortalUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [reel, totals] = await Promise.all([getScreenReel(viewer), getScreenData(30, { trusted: true })]);
  return NextResponse.json(
    { reel, totals: totals.totals, clientCount: totals.clientCount },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
