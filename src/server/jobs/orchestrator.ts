import { sweepInactiveClients } from "@/server/client-status-transition";
import { syncFrameLibrary } from "./frameio-library";
import "server-only";
import { runProductionPhaseAdvance } from "./production-phases";
import { runLinkSuggestions } from "./link-suggestions";
import { runContentSync } from "./content-sync";
import { runAutoPublishDueContent } from "./content-publish";
import { runTaskArchive } from "./task-archive";
import { runCalendarSync } from "./calendar-sync";
import { syncOpenOnboardings } from "@/server/onboarding";
import { runShootReconciliation } from "./shoot-reconciliation";
import { runMonthlyReportDrafts } from "./report-drafts";
import { runContentOnlineNotifications } from "./content-online-notify";
import { runMonthlyInsightTasks } from "./insight-tasks";
import { runIntegrationHealthCheck } from "./integration-health";
import { runDriveSync } from "./drive-sync";
import { runCaptionDriveLink } from "./caption-drive-link";
import { runMetricoolSync } from "./metricool-sync";
import { snapshotFinanceMonth } from "./finance-snapshot";
import { runProfitabilitySignals } from "./profitability-signals";
import { runContentHealthSignals } from "./content-health-signals";
import { runRetentionTasks } from "./retention";
import { runScriptReviewReminders } from "./script-review-reminders";
import {
  pullFrameComments,
  pullFrameDeliverables,
  pullFrameProjects,
} from "./frameio-sync";
import { runClientsWithoutShootSignal, runContentGapSignal, runDailySignals, runEditorDeadlineReminders, recordDeadlinePerformance, runHourlySignals, runScriptTodoReminders } from "./maintenance";
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
  results.push(await step("onboarding.sync", () => syncOpenOnboardings()));
  results.push(await step("frameio.pull_comments", () => pullFrameComments()));
  results.push(await step("signals.hourly", () => runHourlySignals()));
  // Klant op de hoogte brengen (video/script klaar, opname morgen). Idempotent,
  // dus veilig om vaak te draaien.
  results.push(await step("portal.notify_clients", () => runClientNotifications()));
  return { ok: results.every((r) => r.ok), results };
}

/**
 * 's Nachts draaien: de interne run (klantstatus, rapportages, dag-signalen,
 * herinneringen, klantbehoud, backup). De externe syncs draaien een uur eerder
 * in runNightlyExternalSync, zodat een time-out daar deze run niet afbreekt.
 */
export async function runNightlySync() {
  const results: StepResult[] = [];

  // Portaaltoegang gelijktrekken met de samenwerkingsstatussen (gestopte klanten
  // dicht, actieve weer open).
  results.push(await step("portal.enforce_access", () => enforcePortalAccess()));
  // Centrale klantstatus: vangnet dat open automatische taken en rapporten in de
  // wachtrij van niet actieve klanten opruimt (idempotent).
  results.push(await step("clients.status_sweep", () => sweepInactiveClients()));
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
  results.push(await step("finance.snapshot_month", () => snapshotFinanceMonth()));
  // Na de maand-snapshot: financiële winstgevendheid-signalen voor de eigenaar.
  results.push(await step("profit.signals", () => runProfitabilitySignals()));
  results.push(await step("signals.daily", () => runDailySignals()));
  results.push(await step("reminders.editor_deadlines", () => runEditorDeadlineReminders()));
  // reminders.task_deadlines draait niet meer 's nachts: de operationele controle
  // (08:45 en 15:30) meldt te late en vandaag-af-taken in één persoonlijk overzicht.
  // Escalatie bij uitblijvende opvolging + prestatieregistratie (gemiste deadlines).
  // escalations.editor_deadlines: vervangen door de escalatie in de operationele
  // controle (medewerker → operationeel verantwoordelijke → Jarno bij uitzonderingen).
  results.push(await step("performance.record_deadlines", () => recordDeadlinePerformance()));
  results.push(await step("signals.clients_without_shoot", () => runClientsWithoutShootSignal()));
  results.push(await step("signals.content_gap", () => runContentGapSignal()));
  // Contentgezondheidscheck per klant: urgente aandachtspunten → taken voor de
  // coördinator + overbelasting-melding voor de eigenaar (na alle signalen hierboven).
  results.push(await step("content_health.signals", () => runContentHealthSignals()));
  // Klantbehoud: taken bij teruglopende resultaten en naderende contractmomenten.
  results.push(await step("retention.tasks", () => runRetentionTasks()));
  results.push(await step("reminders.script_todo", () => runScriptTodoReminders()));
  // De oude, rumoerige "reminders.post_shoot_todo" is vervangen door de gerichte
  // reminders.post_shoot-job (eigen cron, 08:45 werkdagen, alleen Milou/Jiska, met
  // kant-en-klaar bericht per klant) — die draait dus niet via deze orchestrator.
  // Herinnering aan klanten met scripts die nog ter controle staan (dedupe per week).
  results.push(await step("reminders.script_review", () => runScriptReviewReminders()));
  // Als laatste: een volledige database-backup naar Google Drive.
  results.push(await step("backup.database", () => runDatabaseBackup()));
  // Noodprocedure-PDF naar Drive, zodat kritieke info bij portaaluitval beschikbaar blijft.
  results.push(await step("emergency.export", () => runEmergencyExport()));
  return { ok: results.every((r) => r.ok), results };
}

/**
 * 's Nachts, vóór de interne run: de zware externe syncs (Drive, Frame.io,
 * agenda, Metricool) en de gezondheidscheck van die koppelingen. Draait als eigen
 * cron, zodat een trage of vastlopende koppeling (time-out) nooit meer de
 * signalen, herinneringen, klantbehoud-taken en backups van de nachtrun meeneemt.
 */
export async function runNightlyExternalSync() {
  const results: StepResult[] = [];
  results.push(await step("drive.sync_all", () => runDriveSync()));
  // Direct ná de Drive-sync: koppel nieuwe script-PDF's automatisch aan de juiste
  // opname en bereid de captions voor (de files-tabel is nu vers).
  results.push(await step("captions.link_drive_scripts", () => runCaptionDriveLink()));
  results.push(await step("frameio.pull_projects", () => pullFrameProjects()));
  results.push(await step("frameio.pull_deliverables", () => pullFrameDeliverables()));
  // Frame.io-bibliotheek voor het klantportaal (sessiemappen, video's, thumbnails).
  results.push(await step("frameio.sync_library", () => syncFrameLibrary(undefined, undefined, { full: true })));
  results.push(await step("calendar.sync", () => runCalendarSync()));
  // Direct ná de agenda-sync: controleer of alle opnames ook echt in de planning
  // staan en meld afwijkingen (opname zonder klant / mogelijk gemiste opname).
  results.push(await step("shoots.reconcile", () => runShootReconciliation()));
  results.push(await step("metricool.sync", () => runMetricoolSync()));
  // Na alle externe syncs: controleer de gezondheid van de koppelingen en meld
  // proactief verouderde/nooit-geslaagde koppelingen aan de verantwoordelijke.
  results.push(await step("integrations.health_check", () => runIntegrationHealthCheck()));
  return { ok: results.every((r) => r.ok), results };
}
