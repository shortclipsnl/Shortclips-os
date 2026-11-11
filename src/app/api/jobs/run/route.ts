import { frameLibraryCoverage, syncFrameLibrary } from "@/server/jobs/frameio-library";
import { NextResponse } from "next/server";
import { runFinanceSyncHealth } from "@/server/jobs/finance-sync";
import { runPublicationDueCheck } from "@/server/jobs/publication-reminders";
import { runVermogenAdvies } from "@/server/jobs/vermogen-advies";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runCleaningFridayReminder, runClientsWithoutShootSignal, runContentGapSignal, runDailySignals, runDailyTeamTodoReminder, runNextDayTodoReminder, runEditorDeadlineReminders, runEditorEscalations, recordDeadlinePerformance, runEditorFridayWrapUp, runFinanceMonthReminder, runFinanceWeeklySummary, runHourlySignals, runPostShootReminder, runScriptTodoReminders, runTaskDeadlineReminders, runVrijdagcheckNotification } from "@/server/jobs/maintenance";
import { runGoalsRecompute, runGoalsSeed } from "@/server/jobs/goals-job";
import { runAwardsRecompute } from "@/server/jobs/awards-job";
import { runMeetingsRollOver } from "@/server/jobs/meetings-roll-over";
import {
  inspectFrameProject,
  listFrameProjects,
  normalizeImportedFrameDeliverables,
  pullFrameComments,
  pullFrameDeliverables,
  pullFrameProjects,
} from "@/server/jobs/frameio-sync";
import { runCalendarSync } from "@/server/jobs/calendar-sync";
import { syncOpenOnboardings } from "@/server/onboarding";
import { runScriptingTaskSync } from "@/server/scripting-tasks";
import { runScriptVersionSync } from "@/server/script-versions";
import { runFrequentSync, runNightlyExternalSync, runNightlySync } from "@/server/jobs/orchestrator";
import { runMonthlyReportDrafts } from "@/server/jobs/report-drafts";
import { runContentOnlineNotifications } from "@/server/jobs/content-online-notify";
import { runMonthlyInsightTasks } from "@/server/jobs/insight-tasks";
import { runIntegrationHealthCheck } from "@/server/jobs/integration-health";
import { runEmergencyExport } from "@/server/jobs/emergency-export";
import { runLeadImapSync } from "@/server/jobs/leads-imap-sync";
import { runProfitabilitySignals } from "@/server/jobs/profitability-signals";
import { runContentHealthSignals } from "@/server/jobs/content-health-signals";
import { runScriptReviewReminders } from "@/server/jobs/script-review-reminders";
import { runTransferCleanup } from "@/server/jobs/transfer-cleanup";
import { runCaptionsAutoGenerate } from "@/server/jobs/captions-autogen";
import { runCaptionDriveLink } from "@/server/jobs/caption-drive-link";
import { runBriefingAutoGenerate } from "@/server/jobs/briefing-autogen";
import { runContentResearchWeekly } from "@/server/jobs/content-research-autogen";
import { runContentResearchNotify } from "@/server/jobs/content-research-notify";
import { runMonthlyReports, runReportQueue } from "@/server/jobs/report-monthly";
import { runReportTeamNotifications } from "@/server/reports/team";
import { runReportReviewReminders } from "@/server/jobs/report-review-reminders";
import { runFeedbackReminders } from "@/server/feedback-rounds";
import { runAttentionNotify } from "@/server/jobs/attention-notify";
import { runEditorStatusChecks } from "@/server/editor-status-checks";
import { processDriveChanges, reconcileDriveFolders, runDriveSync } from "@/server/jobs/drive-sync";
import { runDriveHealthCheck } from "@/server/integrations/drive-status";
import { runPilotPortalSetup } from "@/server/jobs/pilot-setup";
import { linkMetricoolBrands, pullMetricoolMetrics, pullMetricoolPosts, pullMetricoolPostsRecent, runMetricoolSync } from "@/server/jobs/metricool-sync";
import { runShootReconciliation } from "@/server/jobs/shoot-reconciliation";
import { setTeamContact } from "@/server/jobs/team";
import { enforcePortalAccess, portalAccessReport } from "@/server/jobs/portal-access";
import { sweepInactiveClients } from "@/server/client-status-transition";
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
  "escalations.editor_deadlines": runEditorEscalations,
  "performance.record_deadlines": recordDeadlinePerformance,
  "reminders.task_deadlines": runTaskDeadlineReminders,
  "signals.clients_without_shoot": runClientsWithoutShootSignal,
  "signals.content_gap": runContentGapSignal,
  "reminders.script_todo": runScriptTodoReminders,
  "reminders.post_shoot": runPostShootReminder,
  "reminders.daily_todo": runDailyTeamTodoReminder,
  "reminders.next_day_todo": runNextDayTodoReminder,
  "reminders.editor_friday_wrapup": runEditorFridayWrapUp,
  // Statuscheck editors halverwege de editor deadline (alleen 09:00-17:00 op werkdagen).
  "editors.status_checks": runEditorStatusChecks,
  // Feedbacktermijn klant: rondes bijwerken en op de laatste termijndag (vanaf
  // 09:00, werkdagen) de vaste verantwoordelijke een melding + taak geven.
  "feedback.reminders": runFeedbackReminders,
  "reminders.cleaning_friday": runCleaningFridayReminder,
  "goals.recompute": runGoalsRecompute,
  "goals.seed": runGoalsSeed,
  "awards.recompute": runAwardsRecompute,
  "meetings.roll_over": runMeetingsRollOver,
  "vrijdagcheck.notify": runVrijdagcheckNotification,
  "finance.month_reminder": runFinanceMonthReminder,
  "finance.weekly_summary": runFinanceWeeklySummary,
  "finance.sync_health": runFinanceSyncHealth,
  "publications.due_check": runPublicationDueCheck,
  "vermogen.advies_maand": runVermogenAdvies,
  "signals.hourly": runHourlySignals,
  "frameio.pull_projects": pullFrameProjects,
  "frameio.pull_comments": pullFrameComments,
  "frameio.pull_deliverables": pullFrameDeliverables,
  "frameio.normalize_imported": normalizeImportedFrameDeliverables,
  "frameio.list_projects": listFrameProjects,
  "frameio.sync_library": syncFrameLibrary,
  "frameio.library_coverage": frameLibraryCoverage,
  // Na de agenda-sync ook de scriptingtaken bijwerken: verplaatste of vervallen
  // opnames passen zo binnen het uur hun taak (deadline/afsluiten) aan.
  "calendar.sync": async () => {
    const res = await runCalendarSync();
    await runScriptingTaskSync().catch((e) => console.error("[scripting.task_sync]", e));
    // Klantonboarding: opname in de agenda → opnamedag-stap klaar, alles klaar → afgerond.
    await syncOpenOnboardings().catch((e) => console.error("[onboarding.sync]", e));
    return res;
  },
  "scripting.task_sync": runScriptingTaskSync,
  "onboarding.sync": syncOpenOnboardings,
  // Altijd de nieuwste scriptversie: nieuwere Drive-versie koppelen en captions bijwerken.
  "scripts.version_sync": runScriptVersionSync,
  "shoots.reconcile": runShootReconciliation,
  "metricool.link_brands": linkMetricoolBrands,
  "metricool.pull_metrics": pullMetricoolMetrics,
  "metricool.pull_posts": pullMetricoolPosts,
  "metricool.pull_posts_recent": pullMetricoolPostsRecent,
  "metricool.sync": runMetricoolSync,
  "sync.frequent": runFrequentSync,
  "sync.nightly": runNightlySync,
  "sync.nightly_external": runNightlyExternalSync,
  "pilot.setup_logins": () => runPilotPortalSetup(),
  "portal.enforce_access": enforcePortalAccess,
  "clients.status_sweep": sweepInactiveClients,
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
  "content.online_notify": runContentOnlineNotifications,
  "insights.monthly_tasks": runMonthlyInsightTasks,
  "integrations.health_check": runIntegrationHealthCheck,
  "emergency.export": runEmergencyExport,
  "leads.sync_mailbox": runLeadImapSync,
  "profit.signals": runProfitabilitySignals,
  "content_health.signals": runContentHealthSignals,
  "script_review.reminders": runScriptReviewReminders,
  "transfers.cleanup": runTransferCleanup,
  "captions.auto_generate": runCaptionsAutoGenerate,
  "captions.link_drive_scripts": runCaptionDriveLink,
  "briefing.auto_generate": runBriefingAutoGenerate,
  "content_research.weekly": runContentResearchWeekly,
  "content_research.notify": runContentResearchNotify,
  "reports.generate_monthly": runMonthlyReports,
  "reports.review_reminders": runReportReviewReminders,
  "reports.process_queue": runReportQueue,
  "reports.team_notify": () => runReportTeamNotifications(),
  "attention.notify": runAttentionNotify,
  "drive.sync_all": runDriveSync,
  // Elke 2 minuten: wijzigingen uit Drive verwerken (licht als er niets is).
  "drive.sync_changes": () => processDriveChanges({ trigger: "cron", budgetMs: 100_000 }),
  // Elk uur: een paar klantmappen volledig nalopen (vangnet).
  "drive.reconcile": () => reconcileDriveFolders({ budgetMs: 200_000, maxClients: 8 }),
  // Elke 15 minuten: bewaking, afgebroken runs afsluiten, melden bij echte verbreking.
  "drive.health": runDriveHealthCheck,
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
