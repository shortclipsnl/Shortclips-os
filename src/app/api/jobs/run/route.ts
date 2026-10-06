import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runDailySignals, runHourlySignals } from "@/server/jobs/maintenance";
import {
  inspectFrameProject,
  listFrameProjects,
  normalizeImportedFrameDeliverables,
  pullFrameComments,
  pullFrameDeliverables,
  pullFrameProjects,
} from "@/server/jobs/frameio-sync";
import { runCalendarSync } from "@/server/jobs/calendar-sync";
import { runFrequentSync, runNightlySync } from "@/server/jobs/orchestrator";
import { runMondayClientImport } from "@/server/jobs/monday-import";
import { runMondayEditingImport } from "@/server/jobs/monday-editing";
import { runMondayContractImport } from "@/server/jobs/monday-contracts";
import { runMondayPlanningImport } from "@/server/jobs/monday-planning";
import { runPilotPortalSetup } from "@/server/jobs/pilot-setup";
import { setTeamContact } from "@/server/jobs/team";
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
  "frameio.pull_projects": pullFrameProjects,
  "frameio.pull_comments": pullFrameComments,
  "frameio.pull_deliverables": pullFrameDeliverables,
  "frameio.normalize_imported": normalizeImportedFrameDeliverables,
  "frameio.list_projects": listFrameProjects,
  "calendar.sync": runCalendarSync,
  "monday.import_clients": runMondayClientImport,
  "monday.import_editing": runMondayEditingImport,
  "monday.import_contracts": runMondayContractImport,
  "monday.import_planning": runMondayPlanningImport,
  "sync.frequent": runFrequentSync,
  "sync.nightly": runNightlySync,
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

  const url = new URL(request.url);
  const job = url.searchParams.get("job");

  // Teamlid-telefoonnummer zetten (?name=Milou&phone=+31...).
  if (job === "team.set_contact") {
    const name = url.searchParams.get("name");
    const phone = url.searchParams.get("phone");
    if (!name || !phone) {
      return NextResponse.json({ error: "Geef ?name= en ?phone= mee." }, { status: 400 });
    }
    const result = await setTeamContact(name, phone);
    return NextResponse.json({ ok: result.ok, job, result });
  }

  // Diagnose-taak met parameter (projectstructuur bekijken).
  if (job === "frameio.inspect") {
    const projectId = url.searchParams.get("project");
    if (!projectId) {
      return NextResponse.json({ error: "Geef ?project=<id> mee." }, { status: 400 });
    }
    const result = await inspectFrameProject(projectId);
    return NextResponse.json({ ok: true, job, result });
  }

  if (!job || !JOBS[job]) {
    return NextResponse.json(
      { error: "Onbekende taak", beschikbaar: Object.keys(JOBS) },
      { status: 400 },
    );
  }

  const result = await JOBS[job]!();
  return NextResponse.json({ ok: true, job, result });
}
