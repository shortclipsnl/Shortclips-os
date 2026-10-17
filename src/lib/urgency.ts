import type { Tone } from "@/components/ui";

/**
 * Eén deadline-urgentieschaal voor het hele portaal (scripting-blokken,
 * productieoverzicht, editing, video's). De kleur volgt automatisch uit de
 * echte deadline en of iets al af is — en maakt onderscheid tussen een deadline
 * die nadert en een deadline die al verstreken is.
 *
 *  - ok      → groen  : loopt volgens planning (of al afgerond)
 *  - soon    → geel   : deadline komt dichterbij
 *  - warn    → oranje : actie binnenkort noodzakelijk
 *  - overdue → rood   : deadline verstreken / direct risico
 *  - none    → neutraal: geen deadline bekend
 */
export type UrgencyLevel = "ok" | "soon" | "warn" | "overdue" | "none";

export const URGENCY_TONE: Record<UrgencyLevel, Tone> = {
  ok: "good",
  soon: "lime",
  warn: "warn",
  overdue: "bad",
  none: "neutral",
};

export const URGENCY_LABEL: Record<UrgencyLevel, string> = {
  ok: "Op planning",
  soon: "Nadert",
  warn: "Actie nodig",
  overdue: "Te laat",
  none: "Geen deadline",
};

/**
 * Bepaalt het urgentieniveau uit het aantal (werk)dagen tot de deadline.
 * Negatief = verstreken. `done` forceert groen. Drempels: ≤0 rood, ≤2 oranje,
 * ≤5 geel, daarboven groen.
 */
export function deadlineUrgency(daysUntil: number | null | undefined, done = false): UrgencyLevel {
  if (done) return "ok";
  if (daysUntil === null || daysUntil === undefined) return "none";
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 2) return "warn";
  if (daysUntil <= 5) return "soon";
  return "ok";
}

/** Urgentietoon direct uit een ISO-datum (yyyy-mm-dd of volledige timestamp). */
export function deadlineUrgencyFromDate(dueOn: string | null | undefined, done = false): UrgencyLevel {
  if (done) return "ok";
  if (!dueOn) return "none";
  const due = new Date(dueOn.length <= 10 ? `${dueOn}T00:00:00` : dueOn);
  if (Number.isNaN(due.getTime())) return "none";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  return deadlineUrgency(days, done);
}
