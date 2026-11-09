import { batchHref, parseBatchKey } from "@/lib/maandcontrole";
import { dayIdFromKey, scriptingTaskHref, SCRIPTING_TASK_PREFIX } from "@/lib/scripting-task-plan";

/**
 * Link vanuit een taak naar waar die over gaat. Nu: automatische
 * scriptingtaken → de juiste scriptsessie op Scripting; actiepunten uit een
 * maandrapportage → dat rapport. Andere taken houden hun
 * bestaande weergave (null = geen extra link).
 */
export function taskHref(t: { entityType: string | null; entityId: string | null; dedupeKey: string | null }): string | null {
  if (t.entityType === "production_day" && t.dedupeKey?.startsWith(SCRIPTING_TASK_PREFIX)) {
    const id = t.entityId ?? dayIdFromKey(t.dedupeKey);
    return id ? scriptingTaskHref(id) : null;
  }
  // Feedbackherinnering → het project (video) op Editing.
  if (t.entityType === "deliverable" && t.entityId && t.dedupeKey?.startsWith("feedbackronde:")) {
    return `/videos/${t.entityId}`;
  }
  // Actiepunt uit een maandrapportage → terug naar dat rapport.
  if (t.entityType === "client_report" && t.entityId && t.dedupeKey?.startsWith("report_action:")) {
    return `/analytics/maandrapportages/${t.entityId}`;
  }
  // Maandcontrole (één taak per maand) → pagina Maandrapportages, die maand.
  const batch = parseBatchKey(t.dedupeKey);
  if (t.entityType === "report_batch" && batch) return batchHref(batch.period);
  return null;
}
