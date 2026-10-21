/**
 * Zuivere statuslogica voor doelen. Geen database, geen tijd-afhankelijkheid
 * behalve de meegegeven `now` — zo is alles voorspelbaar te testen.
 *
 * Statussen: gepland, op_koers, risico, achter, niet_bijgewerkt, gehaald.
 */

export type GoalStatus = "gepland" | "op_koers" | "risico" | "achter" | "niet_bijgewerkt" | "gehaald";
export type GoalType = "count" | "norm" | "weekly" | "monthly" | "milestone";

export type GoalStatusInput = {
  type: GoalType;
  source: "live" | "manual";
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  current: number;
  /** null = doel nog niet ingesteld. */
  target: number | null;
  /** Laatste moment waarop de stand is bijgewerkt (handmatige doelen). */
  lastUpdateAt?: Date | string | null;
  /** Aantal weken op rij dat een norm gehaald is (voor "gehaald" bij norm). */
  normConsecutiveHits?: number;
};

export type GoalStatusResult = {
  status: GoalStatus;
  /** Onwaar als er (nog) geen doel is ingesteld: toon dan "Doel nog instellen". */
  measurable: boolean;
  /** Waar we volgens het tempo nu zouden moeten staan (voor de tempostreep). */
  expected: number | null;
  /** Achterstand als fractie 0..1 (0 = op of voor op schema). */
  shortfallPct: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD → ms op 12:00 UTC, zodat tijdzone-randjes nooit een dag schelen. */
function dayMs(d: string): number {
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).getTime();
}
function toMs(d: Date | string | null | undefined): number | null {
  if (d == null) return null;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
}
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function computeGoalStatus(input: GoalStatusInput, now: Date): GoalStatusResult {
  const nowMs = now.getTime();
  const startMs = dayMs(input.startDate);
  const endMs = dayMs(input.endDate);
  const { type, source, current, target } = input;

  // 1. Gepland: vandaag ligt vóór de startdatum.
  if (nowMs < startMs) {
    return { status: "gepland", measurable: target != null, expected: null, shortfallPct: null };
  }

  // 2. Gehaald. Bij een norm pas na 4 weken op rij; anders zodra current >= target.
  if (target != null && target > 0) {
    const reached = type === "norm" ? (input.normConsecutiveHits ?? 0) >= 4 : current >= target;
    if (reached) {
      return { status: "gehaald", measurable: true, expected: target, shortfallPct: 0 };
    }
  }

  // 3. Niet bijgewerkt: handmatig doel dat langer dan 7 dagen geen update kreeg.
  if (source === "manual") {
    const lastMs = toMs(input.lastUpdateAt) ?? startMs;
    if (nowMs - lastMs > 7 * DAY_MS) {
      return { status: "niet_bijgewerkt", measurable: target != null, expected: null, shortfallPct: null };
    }
  }

  // 4. Geen doel ingesteld: niet meetbaar, standaard op koers (UI toont "Doel nog instellen").
  if (target == null || target <= 0) {
    return { status: "op_koers", measurable: false, expected: null, shortfallPct: null };
  }

  // 5. Verwacht tempo per type.
  let expected: number;
  if (type === "count" || type === "milestone") {
    const frac = endMs > startMs ? clamp01((nowMs - startMs) / (endMs - startMs)) : 1;
    expected = target * frac;
  } else {
    // norm/weekly/monthly: we verwachten altijd de volle norm (100%).
    expected = target;
  }
  const shortfallPct = expected > 0 ? Math.max(0, (expected - current) / expected) : 0;

  // 6. Achter / risico / op koers.
  let achter = shortfallPct > 0.15;
  // Extra "achter"-regel voor optellende doelen dicht op de deadline.
  if (!achter && (type === "count" || type === "milestone")) {
    const daysRemaining = (endMs - nowMs) / DAY_MS;
    const remaining = target - current;
    if (daysRemaining > 0 && daysRemaining <= 14 && remaining > 0) {
      const requiredPace = remaining / daysRemaining;
      const daysElapsed = Math.max(1, (nowMs - startMs) / DAY_MS);
      const currentPace = current / daysElapsed;
      if (requiredPace > 1.2 * currentPace) achter = true;
    }
  }
  if (achter) return { status: "achter", measurable: true, expected, shortfallPct };
  if (shortfallPct > 0.05) return { status: "risico", measurable: true, expected, shortfallPct };
  return { status: "op_koers", measurable: true, expected, shortfallPct };
}
