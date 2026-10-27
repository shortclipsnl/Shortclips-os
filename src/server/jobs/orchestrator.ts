import "server-only";
import { runProductionPhaseAdvance } from "./production-phases";
import { runLinkSuggestions } from "./link-suggestions";
import { runContentSync } from "./content-sync";
import { runAutoPublishDueContent } from "./content-publish";
import { runTaskArchive } from "./task-archive";
import { runCalendarSync } from "./calendar-sync";
import { runMonthlyReportDrafts } from "./report-drafts";
import { runContentOnlineNotifications } from "./content-online-notify";
import { runMonthlyInsightTasks } from "./insight-tasks";
import { runIntegrationHealthCheck } from "./integration-health";
import { runDriveSync } from "./drive-sync";
import { runMetricoolSync } from "./metricool-sync";
import { snapshotFinanceMonth } from "./finance-snapshot";
import { runProfitabilitySignals } from "./profitability-signals";
import { runContentHealthSignals } from "./content-health-signals";
import { runScriptReviewReminders } from "./script-review-reminders";
import {
  pullFrameComments,
  pullFrameDeliverables,
  pullFrameProjects,
} from "./frameio-sync";
import { runClientsWithoutShootSignal, runContentGapSignal, runDailySignals, runEditorDeadlineReminders, runEditorEscalations, recordDeadlinePerformance, runHourlySignals, runPostShootTodoReminders, runScriptTodoReminders, runTaskDeadlineReminders } from "./maintenance";
import { enforcePortalAccess } from "./portal-access";
import { runClientNotifications } from "./notifications";
import { runDatabaseBackup } from "./backup";
import { runEmergencyExport } from "./emergency-export";

/**
 * Orkestratie van alle koppelingen, zodat één geplande taak (cron) het hele
 * platform vers houdt — zonder handwerk. Elke stap wordt apart afgevangen: als
 * één koppeling (nog) niet is ingesteld of een keer faalt, lopen de andere
 * gewoon door. Zo blijft het portaal altijd zo actueel mogelijk.
 */

type StepResult = { job: string; ok: boolean; error?: string };

async function step(job: string, fn: () => Promise<unknown>): Promise<StepResult> {
  try {
    const r = (await fn()) as { ok?: boolean; error?: string } | undefined;
    return { job, ok: r?.ok ?? true, error: r?.error };
  } catch (error) {
    return { job, ok: false, error: String(error) };
  }
}

/**
 * Vaak draaien (bijv. elk half uur): de lichte, snel veranderende dingen —
 * agenda-afspraken en nieuwe Frame.io-feedback — plus de uur-signalen.
 */
export async function runFrequentSync() {
  const results: StepResult[] = [];
  results.push(await step("calendar.sync", () => runCalendarSync()));
  results.push(await step("frameio.pull_comments", () => pullFrameComments()));
  results.push(await step("signals.hourly", () => runHourlySignals()));
  // Klant op de hoogte brengen (video/script klaar, opname morgen). Idempotent,
  // dus veilig om vaak te draaien.
  results.push(await step("portal.notify_clients", () => runClientNotifications()));
  return { ok: results.every((r) => r.ok), results };
}

/**
 * 's Nachts draaien: de zwaardere, volledige syncs — Frame.io-projecten en
 * -video's, Drive, Metricool, rapportages en de dag-signalen. Alle data staat nu
 * in het platform zelf; er is geen Monday-koppeling meer.
 */
export async function runNightlySync() {
  const results: StepResult[] = [];

  // Portaaltoegang gelijktrekken met de samenwerkingsstatussen (gestopte klanten
  // dicht, actieve weer open).
  results.push(await step("portal.enforce_access", () => enforcePortalAccess()));
  results.push(await step("production.advance_phases", () => runProductionPhaseAdvance()));
  results.push(await step("editing.suggest_opname_links", () => runLinkSuggestions()));
  results.push(await step("content.sync_from_videos", () => runContentSync()));
  results.push(await step("content.auto_publish_due", () => runAutoPublishDueContent()));
  results.push(await step("tasks.archive_done", () => runTaskArchive()));
  results.push(await step("reports.generate_drafts", () => runMonthlyReportDrafts()));
  // Klant de dag ná publicatie mailen dat zijn video online staat.
  results.push(await step("content.online_notify", () => runContentOnlineNotifications()));
  // Maandelijkse AI-verbeterlus: inzichten → verbeterpunt-taken (idempotent, gated).
  results.push(await step("insights.monthly_tasks", () => runMonthlyInsightTasks()));
  results.push(await step("drive.sync_all", () => runDriveSync()));
  results.push(await step("frameio.pull_projects", () => pullFrameProjects()));
  results.push(await step("frameio.pull_deliverables", () => pullFrameDeliverables()));
  results.push(await step("calendar.sync", () => runCalendarSync()));
  results.push(await step("metricool.sync", () => runMetricoolSync()));
  // Na alle externe syncs: controleer de gezondheid van de koppelingen en meld
  // proactief verouderde/nooit-geslaagde koppelingen aan de verantwoordelijke.
  results.push(await step("integrations.health_check", () => runIntegrationHealthCheck()));
  results.push(await step("finance.snapshot_month", () => snapshotFinanceMonth()));
  // Na de maand-snapshot: financiële winstgevendheid-signalen voor de eigenaar.
  results.push(await step("profit.signals", () => runProfitabilitySignals()));
  results.push(await step("signals.daily", () => runDailySignals()));
  results.push(await step("reminders.editor_deadlines", () => runEditorDeadlineReminders()));
  results.push(await step("reminders.task_deadlines", () => runTaskDeadlineReminders()));
  // Escalatie bij uitblijvende opvolging + prestatieregistratie (gemiste deadlines).
  results.push(await step("escalations.editor_deadlines", () => runEditorEscalations()));
  results.push(await step("performance.record_deadlines", () => recordDeadlinePerformance()));
  results.push(await step("signals.clients_without_shoot", () => runClientsWithoutShootSignal()));
  results.push(await step("signals.content_gap", () => runContentGapSignal()));
  // Contentgezondheidscheck per klant: urgente aandachtspunten → taken voor de
  // coördinator + overbelasting-melding voor de eigenaar (na alle signalen hierboven).
  results.push(await step("content_health.signals", () => runContentHealthSignals()));
  results.push(await step("reminders.script_todo", () => runScriptTodoReminders()));
  results.push(await step("reminders.post_shoot_todo", () => runPostShootTodoReminders()));
  // Herinnering aan klanten met scripts die nog ter controle staan (dedupe per week).
  results.push(await step("reminders.script_review", () => runScriptReviewReminders()));
  // Als laatste: een volledige database-backup naar Google Drive.
  results.push(await step("backup.database", () => runDatabaseBackup()));
  // Noodprocedure-PDF naar Drive, zodat kritieke info bij portaaluitval beschikbaar blijft.
  results.push(await step("emergency.export", () => runEmergencyExport()));
  return { ok: results.every((r) => r.ok), results };
}
