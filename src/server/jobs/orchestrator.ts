import "server-only";
import { runMondayClientImport } from "./monday-import";
import { runMondayEditingImport } from "./monday-editing";
import { runMondayContractImport } from "./monday-contracts";
import { runMondayPlanningImport } from "./monday-planning";
import { runMondayLeaveImport } from "./monday-leave";
import { runMondayLeadsImport } from "./monday-leads";
import { runProductionPhaseAdvance } from "./production-phases";
import { runLinkSuggestions } from "./link-suggestions";
import { runContentSync } from "./content-sync";
import { runTaskArchive } from "./task-archive";
import { runCalendarSync } from "./calendar-sync";
import { runMetricoolSync } from "./metricool-sync";
import { snapshotFinanceMonth } from "./finance-snapshot";
import {
  pullFrameComments,
  pullFrameDeliverables,
  pullFrameProjects,
} from "./frameio-sync";
import { runDailySignals, runEditorDeadlineReminders, runHourlySignals, runTaskDeadlineReminders } from "./maintenance";
import { enforcePortalAccess } from "./portal-access";
import { runClientNotifications } from "./notifications";

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
 * 's Nachts draaien: de zwaardere, volledige syncs — klanten uit Monday,
 * Frame.io-projecten en -video's, en de dag-signalen.
 */
export async function runNightlySync() {
  const results: StepResult[] = [];
  results.push(await step("monday.import_clients", () => runMondayClientImport()));
  // Direct na de klant-import: portaaltoegang gelijktrekken met de nieuwe
  // samenwerkingsstatussen (gestopte klanten dicht, actieve weer open).
  results.push(await step("portal.enforce_access", () => enforcePortalAccess()));
  results.push(await step("monday.import_editing", () => runMondayEditingImport()));
  results.push(await step("monday.import_contracts", () => runMondayContractImport()));
  results.push(await step("monday.import_planning", () => runMondayPlanningImport()));
  results.push(await step("monday.import_leave", () => runMondayLeaveImport()));
  results.push(await step("monday.import_leads", () => runMondayLeadsImport()));
  results.push(await step("production.advance_phases", () => runProductionPhaseAdvance()));
  results.push(await step("editing.suggest_opname_links", () => runLinkSuggestions()));
  results.push(await step("content.sync_from_videos", () => runContentSync()));
  results.push(await step("tasks.archive_done", () => runTaskArchive()));
  results.push(await step("frameio.pull_projects", () => pullFrameProjects()));
  results.push(await step("frameio.pull_deliverables", () => pullFrameDeliverables()));
  results.push(await step("calendar.sync", () => runCalendarSync()));
  results.push(await step("metricool.sync", () => runMetricoolSync()));
  results.push(await step("finance.snapshot_month", () => snapshotFinanceMonth()));
  results.push(await step("signals.daily", () => runDailySignals()));
  results.push(await step("reminders.editor_deadlines", () => runEditorDeadlineReminders()));
  results.push(await step("reminders.task_deadlines", () => runTaskDeadlineReminders()));
  return { ok: results.every((r) => r.ok), results };
}
