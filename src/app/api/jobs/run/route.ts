import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runCleaningFridayReminder, runClientsWithoutShootSignal, runContentGapSignal, runDailySignals, runDailyTeamTodoReminder, runEditorDeadlineReminders, runEditorFridayWrapUp, runFinanceMonthReminder, runHourlySignals, runPostShootTodoReminders, runScriptTodoReminders, runTaskDeadlineReminders, runVrijdagcheckNotification } from "@/server/jobs/maintenance";
import { runGoalsRecompute, runGoalsSeed } from "@/server/jobs/goals-job";
import { runAwardsRecompute } from "@/server/jobs/awards-job";
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
import { runMondayLeaveImport } from "@/server/jobs/monday-leave";
import { runMondayLeadsImport } from "@/server/jobs/monday-leads";
import { runMondayTasksImport } from "@/server/jobs/monday-tasks";
import { runMondayClientDistributionImport } from "@/server/jobs/monday-client-distribution";
import { runMondayCapacityImport } from "@/server/jobs/monday-capacity";
import { runMonthlyReportDrafts } from "@/server/jobs/report-drafts";
import { runDriveSync } from "@/server/jobs/drive-sync";
import { runPilotPortalSetup } from "@/server/jobs/pilot-setup";
import { linkMetricoolBrands, pullMetricoolMetrics, runMetricoolSync } from "@/server/jobs/metricool-sync";
import { setTeamContact } from "@/server/jobs/team";
import { enforcePortalAccess, portalAccessReport } from "@/server/jobs/portal-access";
import { seedAiKnowledge } from "@/server/jobs/ai-seed";
import { seedAutomationRules } from "@/server/jobs/automations-seed";
import { runProductionPhaseAdvance } from "@/server/jobs/production-phases";
import { runLinkSuggestions } from "@/server/jobs/link-suggestions";
import { runContentSync } from "@/server/jobs/content-sync";
import { runAutoPublishDueContent } from "@/server/jobs/content-publish";
import { runTaskArchive } from "@/server/jobs/task-archive";
import { snapshotFinanceMonth } from "@/server/jobs/finance-snapshot";
import { curateTeam } from "@/server/jobs/team-curate";
import { setupTeamLogins } from "@/server/jobs/team-login-setup";
import { applyClientLogos } from "@/server/jobs/client-logos-apply";
import { bootstrapProduction } from "@/server/jobs/bootstrap";
import { runClientNotifications } from "@/server/jobs/notifications";
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
  "reminders.editor_deadlines": runEditorDeadlineReminders,
  "reminders.task_deadlines": runTaskDeadlineReminders,
  "signals.clients_without_shoot": runClientsWithoutShootSignal,
  "signals.content_gap": runContentGapSignal,
  "reminders.script_todo": runScriptTodoReminders,
  "reminders.post_shoot_todo": runPostShootTodoReminders,
  "reminders.daily_todo": runDailyTeamTodoReminder,
  "reminders.editor_friday_wrapup": runEditorFridayWrapUp,
  "reminders.cleaning_friday": runCleaningFridayReminder,
  "goals.recompute": runGoalsRecompute,
  "goals.seed": runGoalsSeed,
  "awards.recompute": runAwardsRecompute,
  "vrijdagcheck.notify": runVrijdagcheckNotification,
  "finance.month_reminder": runFinanceMonthReminder,
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
  "monday.import_leave": runMondayLeaveImport,
  "monday.import_leads": runMondayLeadsImport,
  "monday.import_tasks": runMondayTasksImport,
  "monday.import_client_distribution": runMondayClientDistributionImport,
  "monday.import_capacity": runMondayCapacityImport,
  "metricool.link_brands": linkMetricoolBrands,
  "metricool.pull_metrics": pullMetricoolMetrics,
  "metricool.sync": runMetricoolSync,
  "sync.frequent": runFrequentSync,
  "sync.nightly": runNightlySync,
  "pilot.setup_logins": () => runPilotPortalSetup(),
  "portal.enforce_access": enforcePortalAccess,
  "portal.coverage": portalAccessReport,
  "portal.notify_clients": runClientNotifications,
  "ai.seed_knowledge": seedAiKnowledge,
  "automations.seed": seedAutomationRules,
  "production.advance_phases": runProductionPhaseAdvance,
  "editing.suggest_opname_links": runLinkSuggestions,
  "content.sync_from_videos": runContentSync,
  "content.auto_publish_due": runAutoPublishDueContent,
  "tasks.archive_done": runTaskArchive,
  "reports.generate_drafts": runMonthlyReportDrafts,
  "drive.sync_all": runDriveSync,
  "finance.snapshot_month": snapshotFinanceMonth,
  "team.curate": curateTeam,
  "team.setup_logins": setupTeamLogins,
  "clients.apply_logos": applyClientLogos,
  "bootstrap.production": bootstrapProduction,
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

async function handle(request: Request) {
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

// Zowel POST (handmatig/scripts) als GET (Vercel Cron gebruikt standaard GET en
// stuurt CRON_SECRET als Bearer mee). Beide vereisen dezelfde autorisatie.
export const POST = handle;
export const GET = handle;
