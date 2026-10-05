import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runDailySignals, runHourlySignals } from "@/server/jobs/maintenance";
import { pullFrameComments } from "@/server/jobs/frameio-sync";
import { runCalendarSync } from "@/server/jobs/calendar-sync";
import { runMondayClientImport } from "@/server/jobs/monday-import";
import { runPilotPortalSetup } from "@/server/jobs/pilot-setup";
import { pruneSessions } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Startpunt voor geplande taken (Vercel Cron, GitHub Actions of een externe
 * scheduler). Beveiligd met CRON_SECRET; zonder dat geheim is de route dicht,
 * ook lokaal niet per ongeluk aanroepbaar vanaf buiten.
 */
const JOBS: Record<string, () => Promise<unknown>> = {
  "signals.daily": runDailySignals,
  "signals.hourly": runHourlySignals,
  "frameio.pull_comments": pullFrameComments,
  "calendar.sync": runCalendarSync,
  "monday.import_clients": runMondayClientImport,
  "pilot.setup_logins": () => runPilotPortalSetup(),
  "maintenance.prune_sessions": async () => ({ removed: await pruneSessions() }),
};

function authorized(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Niet toegestaan. Zet CRON_SECRET en stuur die mee als Bearer-token." },
      { status: 401 },
    );
  }

  const job = new URL(request.url).searchParams.get("job");
  if (!job || !JOBS[job]) {
    return NextResponse.json(
      { error: "Onbekende taak", beschikbaar: Object.keys(JOBS) },
      { status: 400 },
    );
  }

  const result = await JOBS[job]!();
  return NextResponse.json({ ok: true, job, result });
}
