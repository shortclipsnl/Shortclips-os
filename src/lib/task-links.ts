import { dayIdFromKey, scriptingTaskHref, SCRIPTING_TASK_PREFIX } from "@/lib/scripting-task-plan";

/**
 * Link vanuit een taak naar waar die over gaat. Nu: automatische
 * scriptingtaken → de juiste scriptsessie op Scripting. Andere taken houden hun
 * bestaande weergave (null = geen extra link).
 */
export function taskHref(t: { entityType: string | null; entityId: string | null; dedupeKey: string | null }): string | null {
  if (t.entityType === "production_day" && t.dedupeKey?.startsWith(SCRIPTING_TASK_PREFIX)) {
    const id = t.entityId ?? dayIdFromKey(t.dedupeKey);
    return id ? scriptingTaskHref(id) : null;
  }
  return null;
}
