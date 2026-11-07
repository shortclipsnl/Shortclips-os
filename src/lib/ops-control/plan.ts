/**
 * Operationele controle — beslislogica. Puur (geen database), zodat elk
 * scenario los te testen is. `src/server/ops-control/run.ts` verzamelt de
 * bevindingen en de bestaande punten, roept `planItems` aan en voert het plan uit.
 *
 * Uitgangspunten:
 * - Eén punt (en hoogstens één taak) per soort probleem per klant. Vaker draaien
 *   geeft nooit dubbele punten of taken.
 * - Een punt is pas opgelost als de bron het probleem niet meer laat zien. Wie de
 *   taak afvinkt terwijl het probleem er nog is, krijgt hem bij de volgende
 *   controle terug, voor zover de bron dat kan bevestigen (`verifiable`).
 * - Waar de bron het niet kan bevestigen (wachten op de klant, contact opnemen)
 *   telt handmatig afronden wél, en blijft het punt een paar werkdagen stil.
 * - Escalatie: medewerker → operationeel verantwoordelijke → Jarno, en Jarno
 *   alleen bij de vaste uitzonderingen.
 */

import { addWorkingDays, workingDaysBetween } from "@/lib/workdays";

export type OpsDomain = "scripting" | "editing" | "klantfeedback" | "klantcommunicatie" | "opname" | "taken";
export type OpsSlot = "ochtend" | "middag" | "handmatig";
export type OpsPriority = "hoog" | "normaal";
export type OpsSeverity = "rood" | "oranje";

export const OPS_DOMAINS: { key: OpsDomain | "deadlines"; label: string }[] = [
  { key: "scripting", label: "Scripting" },
  { key: "editing", label: "Editing" },
  { key: "klantfeedback", label: "Klantfeedback" },
  { key: "klantcommunicatie", label: "Klantcommunicatie" },
  { key: "opname", label: "Opnamevoorbereiding" },
  { key: "deadlines", label: "Deadlines" },
  { key: "taken", label: "Openstaande taken" },
];

export const OPS_TASK_PREFIX = "opscontrol:";
export const opsTaskKey = (itemKey: string) => `${OPS_TASK_PREFIX}${itemKey}`;
/** Sleutel voor een taak die niet meer bij een open punt hoort (unieke index vrijgeven). */
export const opsRetiredKey = (itemKey: string, taskId: string) => `${OPS_TASK_PREFIX}gesloten:${itemKey}:${taskId}`.slice(0, 200);

/** Wat de controle in de bronnen heeft gevonden. */
export type Finding = {
  key: string;
  domain: OpsDomain;
  category: string;
  clientId: string | null;
  clientLabel: string | null;
  ownerId: string | null;
  action: string;
  reason: string;
  href: string | null;
  priority: OpsPriority;
  severity: OpsSeverity;
  /** Kan de bron bevestigen dat het echt is opgelost? */
  verifiable: boolean;
  /** Werkdagen stilte na handmatig afronden (alleen bij niet-verifieerbaar). */
  snoozeWorkdays: number;
  /** false = er bestaat al een eigen taak voor (scripting, gewone taken). */
  createTask: boolean;
  /** Bestaande taak die bij dit punt hoort (als createTask false is). */
  linkedTaskId?: string | null;
  /** Deadline uit de bron (bijv. scriptdeadline). Leeg = op basis van prioriteit. */
  dueOn?: string | null;
  /** Gevuld = valt onder de uitzonderingen voor Jarno (reden). */
  jarnoReason?: string | null;
};

/** Wat er al van een punt bekend is. */
export type ItemState = {
  id: string;
  itemKey: string;
  status: "open" | "resolved";
  resolution: string | null;
  ownerId: string | null;
  dueOn: string | null;
  taskId: string | null;
  /** Status van de gekoppelde taak; null = taak bestaat niet (meer) of is verwijderd. */
  taskStatus: string | null;
  escalationLevel: number;
  escalatedAt: string | null; // YYYY-MM-DD
  jarnoNotified: boolean;
  snoozedUntil: string | null;
  manualDoneCount: number;
};

export type PlanContext = {
  today: string;
  holidays?: Set<string>;
  /** Werkdagen dat een punt bij de operationeel verantwoordelijke openstaat vóór Jarno het ziet. */
  jarnoAfterWorkdays: number;
};

export type TaskOp = "create" | "update" | "reopen" | "close" | "none";

export type Decision = {
  key: string;
  itemId: string | null;
  finding: Finding | null;
  /** insert = nieuw (of opnieuw geopend) punt; update = blijft open; resolve = afsluiten. */
  item: "insert" | "update" | "resolve" | "none";
  resolution?: "auto" | "manual";
  task: TaskOp;
  /** Oude taak (geannuleerd of verwijderd) waarvan de sleutel moet vrijkomen. */
  retireTaskId?: string | null;
  dueOn: string | null;
  /** Taak handmatig afgerond terwijl het probleem nog bestaat → heropend. */
  manualDoneDetected: boolean;
  snoozeUntil: string | null;
  /** Nieuw escalatieniveau (alleen als het hoger wordt). */
  escalateTo: 1 | 2 | null;
  notifyJarno: boolean;
};

const OPEN_TASK = new Set(["todo", "in_progress", "blocked"]);

/** Deadline voor een nieuw punt: hoog = vandaag, normaal = over 2 werkdagen. */
export function initialDue(f: Finding, ctx: PlanContext): string {
  if (f.dueOn) return f.dueOn;
  return f.priority === "hoog" ? ctx.today : addWorkingDays(ctx.today, 2, ctx.holidays);
}

/** Belangrijk = mag escaleren: vandaag nodig of al kritiek. */
export function isImportant(f: Finding): boolean {
  return f.priority === "hoog" || f.severity === "rood";
}

export function planItems(findings: Finding[], items: ItemState[], ctx: PlanContext): Decision[] {
  const byKey = new Map(items.map((i) => [i.itemKey, i]));
  const seen = new Set<string>();
  const out: Decision[] = [];

  for (const f of findings) {
    if (seen.has(f.key)) continue; // zelfde punt twee keer gevonden: één keer behandelen
    seen.add(f.key);
    out.push(decideFound(f, byKey.get(f.key) ?? null, ctx));
  }

  // Punten die niet meer gevonden worden: het probleem is weg → automatisch afsluiten.
  for (const it of items) {
    if (seen.has(it.itemKey) || it.status !== "open") continue;
    out.push({
      key: it.itemKey, itemId: it.id, finding: null, item: "resolve", resolution: "auto",
      task: it.taskId && it.taskStatus && OPEN_TASK.has(it.taskStatus) ? "close" : "none",
      dueOn: it.dueOn, manualDoneDetected: false, snoozeUntil: null, escalateTo: null, notifyJarno: false,
    });
  }
  return out;
}

function base(f: Finding, it: ItemState | null): Decision {
  return {
    key: f.key, itemId: it?.id ?? null, finding: f, item: "none", task: "none", dueOn: it?.dueOn ?? null,
    manualDoneDetected: false, snoozeUntil: null, escalateTo: null, notifyJarno: false,
  };
}

function decideFound(f: Finding, it: ItemState | null, ctx: PlanContext): Decision {
  const d = base(f, it);

  // Nieuw punt, of een eerder afgesloten punt dat terugkomt.
  if (!it || it.status === "resolved") {
    // Handmatig afgerond en nog in de rustperiode: niets doen.
    if (it && it.resolution === "manual" && it.snoozedUntil && it.snoozedUntil > ctx.today) return d;
    d.item = "insert";
    d.dueOn = initialDue(f, ctx);
    d.task = f.createTask ? "create" : "none";
    // Een oude, nog openstaande taak van dit punt hergebruiken in plaats van een tweede.
    if (f.createTask && it?.taskId && it.taskStatus && OPEN_TASK.has(it.taskStatus)) d.task = "update";
    else if (f.createTask && it?.taskId && it.taskStatus) d.retireTaskId = it.taskId;
    if (f.jarnoReason) { d.notifyJarno = true; d.escalateTo = 2; }
    return d;
  }

  // Punt staat al open.
  d.item = "update";
  d.dueOn = it.dueOn ?? initialDue(f, ctx);
  // Een deadline uit de bron (scripting) mag meeschuiven; een eigen deadline niet,
  // anders schuift "vandaag" elke dag op en escaleert er nooit iets.
  if (f.dueOn && f.dueOn !== it.dueOn) d.dueOn = f.dueOn;

  if (f.createTask) {
    const st = it.taskStatus;
    if (st && OPEN_TASK.has(st)) {
      d.task = "update";
    } else if (f.verifiable) {
      // Afgevinkt/verwijderd, maar de bron laat het probleem nog zien → terug.
      d.manualDoneDetected = st === "done" || st === "cancelled" || st === null;
      if (st === "done") d.task = "reopen";
      else { d.task = "create"; d.retireTaskId = it.taskId; }
    } else {
      // Niet te controleren: handmatig afronden telt, een paar werkdagen stilte.
      d.item = "resolve";
      d.resolution = "manual";
      d.task = "none";
      d.snoozeUntil = addWorkingDays(ctx.today, Math.max(1, f.snoozeWorkdays), ctx.holidays);
      if (st === "cancelled" || st === null) d.retireTaskId = it.taskId;
      return d;
    }
  }

  // Escalatie.
  const overdue = d.dueOn != null && d.dueOn < ctx.today;
  if (f.jarnoReason && !it.jarnoNotified) {
    d.notifyJarno = true;
    d.escalateTo = 2;
  } else if (it.escalationLevel < 1 && overdue && isImportant(f)) {
    d.escalateTo = 1;
  } else if (
    it.escalationLevel === 1 && !it.jarnoNotified && it.escalatedAt &&
    CLIENT_FACING.has(f.domain) && isImportant(f) &&
    workingDaysBetween(it.escalatedAt, ctx.today, ctx.holidays) >= ctx.jarnoAfterWorkdays
  ) {
    // Ook de operationeel verantwoordelijke krijgt het niet opgelost en de klant merkt het.
    d.notifyJarno = true;
    d.escalateTo = 2;
  }
  return d;
}

/** Domeinen waar een vertraging direct gevolgen heeft voor de klant. */
const CLIENT_FACING = new Set<OpsDomain>(["editing", "klantfeedback", "klantcommunicatie"]);

/* ------------------------------------------------------------------ *
 * Planning van de controlemomenten
 * ------------------------------------------------------------------ */

export type LocalClock = { date: string; weekday: number; minutes: number };

/** "09:00" → 540. Ongeldig → null. */
export function parseHHMM(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Lokale tijd in Europe/Amsterdam. */
export function amsterdamClock(now: Date): LocalClock {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday: wd, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Hoe lang na het ingestelde tijdstip een gemist moment nog mag draaien. */
export const SLOT_GRACE_MINUTES = 120;

/**
 * Welk controlemoment moet nu draaien? Alleen op werkdagen (geen feestdag),
 * vanaf het ingestelde tijdstip tot twee uur erna, en elk moment één keer per dag.
 */
export function dueSlot(
  clock: LocalClock,
  times: { ochtend: string; middag: string },
  done: Set<"ochtend" | "middag">,
  holidays?: Set<string>,
): "ochtend" | "middag" | null {
  if (clock.weekday === 0 || clock.weekday === 6) return null;
  if (holidays?.has(clock.date)) return null;
  const order: ("middag" | "ochtend")[] = ["middag", "ochtend"];
  for (const slot of order) {
    const at = parseHHMM(times[slot]);
    if (at == null) continue;
    if (clock.minutes >= at && clock.minutes < at + SLOT_GRACE_MINUTES) return done.has(slot) ? null : slot;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Status per onderdeel (dashboard)
 * ------------------------------------------------------------------ */

export type DomainState = "groen" | "oranje" | "rood" | "grijs";
export type DomainCheck = "checked" | "partial" | "unavailable";

export type OpenItemLite = { domain: OpsDomain; severity: OpsSeverity; dueOn: string | null; escalationLevel: number };

/**
 * Groen alleen als de controle vandaag gedraaid heeft, de bron bereikbaar was en
 * er niets openstaat. Een onbereikbare bron is nooit groen: dan "Controle niet
 * mogelijk". Rood = deadline verstreken, kritiek of geëscaleerd.
 */
export function domainState(
  key: OpsDomain | "deadlines",
  open: OpenItemLite[],
  opts: { today: string; checkedToday: boolean; check: DomainCheck; holidays?: Set<string> },
): DomainState {
  let list: OpenItemLite[];
  if (key === "deadlines") {
    const in48h = addWorkingDays(opts.today, 2, opts.holidays);
    list = open.filter((i) => i.dueOn != null && i.dueOn <= in48h);
  } else {
    list = open.filter((i) => i.domain === key);
  }
  const red = list.some((i) => i.severity === "rood" || i.escalationLevel > 0 || (i.dueOn != null && i.dueOn < opts.today));
  if (red) return "rood";
  if (!opts.checkedToday || opts.check === "unavailable") return "grijs";
  if (list.length > 0) return "oranje";
  return "groen";
}

/* ------------------------------------------------------------------ *
 * Teksten
 * ------------------------------------------------------------------ */

export function morningDigest(firstName: string, items: { clientLabel: string | null }[]): { title: string; body: string } | null {
  if (items.length === 0) return null;
  const clientsN = new Set(items.map((i) => i.clientLabel).filter(Boolean)).size;
  const punten = `${items.length} aandachtspunt${items.length === 1 ? "" : "en"}`;
  const bij = clientsN > 0 ? ` bij ${clientsN} klant${clientsN === 1 ? "" : "en"}` : "";
  return { title: `Goedemorgen ${firstName}. Je hebt vandaag ${punten}${bij}.`, body: "Bekijk je taken." };
}

export function afternoonDigest(items: unknown[]): { title: string; body: string } | null {
  if (items.length === 0) return null;
  const n = items.length;
  return {
    title: `Er ${n === 1 ? "staat" : "staan"} nog ${n} ${n === 1 ? "werkzaamheid" : "werkzaamheden"} open die vandaag aandacht nodig ${n === 1 ? "heeft" : "hebben"}.`,
    body: "Rond deze af of werk de status bij.",
  };
}

export function topLines(items: { clientLabel: string | null; action: string }[], max = 3): string {
  const lines = items.slice(0, max).map((i) => (i.clientLabel ? `${i.clientLabel}: ${i.action}` : i.action));
  return lines.join(" · ") + (items.length > max ? ` · +${items.length - max} meer` : "");
}
