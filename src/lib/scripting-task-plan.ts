/**
 * Beslislogica voor de automatische scriptingtaken. Puur (geen database), zodat
 * het gedrag los te testen is. De server-module `scripting-tasks.ts` leest de
 * opnames en bestaande taken, roept `planScriptingTask` aan en voert het plan uit.
 *
 * Uitgangspunten:
 * - Eén taak per scriptsessie (opname). Bij een statuswijziging wordt dezelfde
 *   taak bijgewerkt of heropend, nooit een tweede aangemaakt.
 * - Alleen statussen waarbij de medewerker zelf werk heeft, geven een open taak.
 *   Wachten op de klant en Final sluiten de taak automatisch.
 * - Heeft iemand de taak voor de huidige status zelf afgevinkt of verwijderd, dan
 *   blijft dat zo tot de status verandert.
 */

/** Statussen met openstaand werk → actie in de taaktitel. */
export const SCRIPTING_TASK_ACTION: Record<string, string> = {
  concepting: "Scripts opstellen",
  scriptmeeting: "Script meeting plannen",
  controle_jarno: "Scripts controleren",
  feedback_jarno: "Scripts aanpassen",
  nog_aanvullen: "Scripts aanvullen",
};

/** Statussen waarbij het werk bij de klant ligt: geen taak voor het team. */
export const SCRIPTING_WAITING = ["afwachting_klant", "scripts_bij_klant"] as const;

export const SCRIPTING_TASK_PREFIX = "scripting:";
/** Sleutel van een taak die het systeem zelf heeft gesloten. */
export const SCRIPTING_AUTO_CLOSED = "auto-closed";

export function scriptingTaskKey(dayId: string, status: string): string {
  return `${SCRIPTING_TASK_PREFIX}${dayId}:${status}`;
}
/**
 * Sleutel-voorvoegsel voor taken die het systeem zelf heeft gesloten. De server
 * plakt de taak-id erachter: de unieke index op `dedupe_key` telt "vervallen"
 * taken mee als open, dus elke gesloten taak krijgt een eigen sleutel.
 */
export function scriptingClosedKey(dayId: string): string {
  return `${SCRIPTING_TASK_PREFIX}${dayId}:${SCRIPTING_AUTO_CLOSED}:`;
}
export function isClosedKey(key: string | null | undefined): boolean {
  return Boolean(key && key.includes(`:${SCRIPTING_AUTO_CLOSED}`));
}
/** Haalt de opname-id uit een scriptingtaak-sleutel (of null). */
export function dayIdFromKey(key: string | null | undefined): string | null {
  if (!key || !key.startsWith(SCRIPTING_TASK_PREFIX)) return null;
  return key.slice(SCRIPTING_TASK_PREFIX.length).split(":")[0] || null;
}

export function scriptingTaskHref(dayId: string): string {
  return `/scripting?sessie=${dayId}`;
}

const MONTH_SHORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
function fmtShort(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${MONTH_SHORT[(m ?? 1) - 1]}`;
}

export type ScriptingDayState = {
  id: string;
  clientId: string;
  clientName: string;
  scheduledOn: string;
  /** Scriptdeadline (YYYY-MM-DD), 7 werkdagen vóór de opname. */
  deadline: string;
  status: string;
  note: string | null;
  /** Verantwoordelijke voor het werk (al opgelost: schrijver → coördinator, of Jarno bij controle). */
  assigneeId: string | null;
  /** Gekoppelde sessiemap in Drive, alleen voor de omschrijving. */
  sessionLabel: string | null;
  /** Opname vervallen, verwijderd of al geweest. */
  gone: boolean;
};

export type ExistingTask = {
  id: string;
  status: string; // todo | in_progress | blocked | done | cancelled
  dedupeKey: string | null;
  deleted: boolean;
  archived: boolean;
  title: string;
  description: string | null;
  assigneeId: string | null;
  dueOn: string | null;
  priority: string;
  createdAt: string; // ISO, voor "laatste" bepalen
};

export type TaskFields = {
  clientId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  dueOn: string;
  priority: "normal" | "high" | "urgent";
  dedupeKey: string;
};

export type ScriptingTaskPlan =
  | { type: "none"; reason: string }
  | { type: "insert"; fields: TaskFields }
  | { type: "update"; id: string; fields: TaskFields; reopen: boolean }
  /** `keyPrefix` + taak-id wordt de nieuwe sleutel. */
  | { type: "close"; ids: string[]; status: "done" | "cancelled"; keyPrefix: string };

const OPEN = new Set(["todo", "in_progress", "blocked"]);

export function priorityFor(deadline: string, today: string): "normal" | "high" | "urgent" {
  const diff = Math.round((Date.parse(deadline + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000);
  if (diff < 0) return "urgent";
  if (diff <= 2) return "high";
  return "normal";
}

export function desiredFields(day: ScriptingDayState, today: string): TaskFields | null {
  const action = SCRIPTING_TASK_ACTION[day.status];
  if (!action || day.gone) return null;
  const lines = [
    `Automatisch vanuit Scripting. Status: ${action}.`,
    `Opname: ${fmtShort(day.scheduledOn)} · scripts klaar uiterlijk ${fmtShort(day.deadline)}.`,
  ];
  if (day.sessionLabel) lines.push(`Gekoppelde sessiemap: ${day.sessionLabel}.`);
  if (day.note?.trim()) lines.push(`Notitie: ${day.note.trim()}`);
  return {
    clientId: day.clientId,
    title: `${day.clientName} | ${action} | Opname ${fmtShort(day.scheduledOn)}`.slice(0, 240),
    description: lines.join("\n"),
    assigneeId: day.assigneeId,
    dueOn: day.deadline,
    priority: priorityFor(day.deadline, today),
    dedupeKey: scriptingTaskKey(day.id, day.status),
  };
}

function sameFields(t: ExistingTask, f: TaskFields): boolean {
  return t.title === f.title
    && (t.description ?? "") === f.description
    && t.assigneeId === f.assigneeId
    && t.dueOn === f.dueOn
    && t.priority === f.priority
    && t.dedupeKey === f.dedupeKey;
}

/**
 * Bepaalt wat er met de taak van één opname moet gebeuren.
 * `existing` = alle scriptingtaken van deze opname (ook afgerond/verwijderd).
 *
 * `retireIds`: afgeronde/verwijderde taken waarvan de sleutel bij een vórige
 * status hoort. Die markering vervalt zodra de status verandert, zodat een
 * nieuwe ronde (bijv. opnieuw feedback verwerken) wel weer een taak geeft.
 */
export function planScriptingTask(
  day: ScriptingDayState,
  existing: ExistingTask[],
  today: string,
): { plan: ScriptingTaskPlan; retireIds: string[] } {
  const want = desiredFields(day, today);
  const live = existing.filter((t) => !t.deleted);
  const open = live.filter((t) => OPEN.has(t.status));
  const closedKey = scriptingClosedKey(day.id);
  const retireIds = existing
    .filter((t) => (t.deleted || !OPEN.has(t.status)) && t.dedupeKey && !isClosedKey(t.dedupeKey) && t.dedupeKey !== want?.dedupeKey)
    .map((t) => t.id);

  if (!want) {
    if (open.length === 0) return { plan: { type: "none", reason: "geen werk en geen open taak" }, retireIds };
    const status = day.gone ? "cancelled" : "done";
    return { plan: { type: "close", ids: open.map((t) => t.id), status, keyPrefix: closedKey }, retireIds };
  }

  // Er is werk. Bestaat er al een open taak? Dan die bijwerken (de oudste
  // houden; eventuele extra open taken sluit de aanroeper via duplicatesToClose).
  const keep = [...open].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (keep) {
    if (sameFields(keep, want)) return { plan: { type: "none", reason: "taak is al actueel" }, retireIds };
    return { plan: { type: "update", id: keep.id, fields: want, reopen: false }, retireIds };
  }

  // Geen open taak. Is de taak voor déze status zelf afgevinkt of verwijderd?
  // Dan niet terugzetten tot de status verandert.
  const handledManually = existing.some((t) => t.dedupeKey === want.dedupeKey && (t.deleted || !OPEN.has(t.status)));
  if (handledManually) return { plan: { type: "none", reason: "voor deze status al handmatig afgehandeld" }, retireIds };

  // Heropen de laatste (niet-verwijderde) taak van deze opname i.p.v. een nieuwe.
  const reusable = [...live].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (reusable) {
    return { plan: { type: "update", id: reusable.id, fields: want, reopen: true }, retireIds: retireIds.filter((id) => id !== reusable.id) };
  }
  return { plan: { type: "insert", fields: want }, retireIds };
}

/** Extra open taken van dezelfde opname (zou niet moeten voorkomen): de nieuwere sluiten. */
export function duplicatesToClose(existing: ExistingTask[]): string[] {
  const open = existing.filter((t) => !t.deleted && OPEN.has(t.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return open.slice(1).map((t) => t.id);
}
