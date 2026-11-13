import { NextResponse } from "next/server";
import { readMonitorState } from "@/server/monitoring/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Publieke hartslag voor een externe uptime-dienst (bijv. UptimeRobot).
 * Geeft 503 als de bewaking zelf niet meer draait (planner stilgevallen) of als
 * er een kernkoppeling plat ligt. Bevat bewust geen details: alleen een status.
 */
export async function GET() {
  try {
    const state = await readMonitorState();
    const age = state.lastRunAt ? Date.now() - new Date(state.lastRunAt).getTime() : Infinity;
    const stalled = age > 45 * 60_000;
    const status = stalled ? "stalled" : state.lastLevel === "down" ? "down" : state.lastLevel === "warn" ? "degraded" : "ok";
    return NextResponse.json(
      { status, checkedAt: state.lastRunAt },
      { status: stalled || state.lastLevel === "down" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
