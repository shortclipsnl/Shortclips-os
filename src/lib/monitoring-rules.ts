/**
 * Spelregels van de Koppelingsbewaking. Bewust puur (geen database, geen
 * netwerk), zodat ze los te testen zijn en overal hetzelfde werken.
 *
 * Niveaus:
 *  - ok    groen  functioneert correct
 *  - warn  oranje synchronisatie vertraagd of gedeeltelijke storing
 *  - down  rood   koppeling werkt niet
 *  - off   grijs  bewust (nog) niet ingesteld, geen storing
 *
 * Meldbeleid:
 *  - Kleine problemen: het systeem probeert zelf te herstellen. Lukt dat, dan
 *    volgt geen melding (wel zichtbaar in de historie en het dagoverzicht).
 *  - Terugkerende problemen (3x of vaker in 7 dagen): zichtbaar op het dashboard.
 *  - Kritiek: een kernkoppeling ligt plat. Direct één melding aan de beheerder,
 *    meteen als er menselijke actie nodig is, anders na een half uur zonder herstel.
 *  - Dagoverzicht: alleen als er de afgelopen 24 uur iets was of nog openstaat.
 */

export type MonitorLevel = "ok" | "warn" | "down" | "off";

export const LEVEL_RANK: Record<MonitorLevel, number> = { off: 0, ok: 1, warn: 2, down: 3 };

export const LEVEL_LABEL: Record<MonitorLevel, string> = {
  ok: "Functioneert correct",
  warn: "Vertraagd of gedeeltelijke storing",
  down: "Werkt niet",
  off: "Niet ingesteld",
};

export function worstLevel(levels: MonitorLevel[]): MonitorLevel {
  let worst: MonitorLevel = "ok";
  let any = false;
  for (const l of levels) {
    if (l === "off") continue;
    any = true;
    if (LEVEL_RANK[l] > LEVEL_RANK[worst]) worst = l;
  }
  return any ? worst : levels.length ? "off" : "ok";
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Wachttijd vóór de volgende herstelpoging: 15, 30, 60, 120 min, daarna elke 4 uur. */
export const RECOVERY_BACKOFF_MS = [15 * MIN, 30 * MIN, 60 * MIN, 120 * MIN, 240 * MIN];

export function nextRecoveryDelay(attemptsDone: number): number {
  const i = Math.max(0, Math.min(attemptsDone, RECOVERY_BACKOFF_MS.length - 1));
  return RECOVERY_BACKOFF_MS[i]!;
}

/** Een kernkoppeling die zo lang plat ligt zonder herstel, levert een directe melding op. */
export const CRITICAL_GRACE_MS = 30 * MIN;
/** Zoveel keer in 7 dagen hetzelfde probleem = terugkerend. */
export const RECURRING_THRESHOLD = 3;
export const RECURRING_WINDOW_MS = 7 * 24 * HOUR;
/** Vanaf dit uur (NL-tijd) gaat het dagoverzicht uit. */
export const DIGEST_HOUR = 8;

export type Freshness = {
  /** Ouder dan dit = vertraagd (oranje). */
  warnAfterMs: number;
  /** Ouder dan dit = werkt niet (rood). */
  downAfterMs: number;
};

/**
 * Niveau op basis van de leeftijd van de laatste geslaagde synchronisatie.
 * Nooit gelukt telt als rood: dan komt er aantoonbaar geen data binnen.
 */
export function levelFromAge(lastOkAt: Date | null, now: Date, f: Freshness): MonitorLevel {
  if (!lastOkAt) return "down";
  const age = now.getTime() - lastOkAt.getTime();
  if (age > f.downAfterMs) return "down";
  if (age > f.warnAfterMs) return "warn";
  return "ok";
}

/** Uur (0-23) en datum (yyyy-mm-dd) in Nederlandse tijd. */
export function amsterdamParts(now: Date): { hour: number; day: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), day: `${p.year}-${p.month}-${p.day}` };
}

/** Een job die alleen overdag draait (bijv. 07-20 uur) mag 's nachts ouder zijn. */
export function daytimeFreshness(now: Date, day: Freshness, night: Freshness, from = 7, to = 21): Freshness {
  const { hour } = amsterdamParts(now);
  return hour >= from && hour < to ? day : night;
}

// ---------------------------------------------------------------------------
// Incidenten
// ---------------------------------------------------------------------------

export type Incident = {
  key: string;
  name: string;
  level: Exclude<MonitorLevel, "ok" | "off">;
  summary: string;
  action: string | null;
  /** Herstel lukt alleen met menselijke actie (bijv. opnieuw inloggen). */
  needsHuman: boolean;
  /** Kernkoppeling (Drive, Agenda, Frame.io, achtergrondtaken): rood = kritiek. */
  core: boolean;
  openedAt: string;
  lastSeenAt: string;
  recoveryAttempts: number;
  lastRecoveryAt: string | null;
  lastRecoveryOk: boolean | null;
  nextRecoveryAt: string | null;
  criticalNotifiedAt: string | null;
  resolvedAt?: string | null;
  /** Opgelost zonder dat de beheerder iets hoefde te doen. */
  autoResolved?: boolean;
};

export type Observation = {
  key: string;
  name: string;
  level: MonitorLevel;
  summary: string;
  action: string | null;
  needsHuman: boolean;
  retryable: boolean;
  core: boolean;
};

export type IncidentStep = {
  /** Bijgewerkte open incidenten. */
  open: Record<string, Incident>;
  /** Net opgeloste incidenten (naar de historie). */
  resolved: Incident[];
  /** Incidenten die nu een directe melding moeten krijgen. */
  notifyCritical: Incident[];
  /** Opgeloste incidenten waarover eerder een kritieke melding is gestuurd. */
  notifyRecovered: Incident[];
};

/**
 * Eén bewakingsronde verwerken: incidenten openen, bijwerken en sluiten, en
 * bepalen wie een melding krijgt. Puur: de aanroeper verstuurt en bewaart.
 */
export function stepIncidents(
  previous: Record<string, Incident>,
  observations: Observation[],
  now: Date,
): IncidentStep {
  const iso = now.toISOString();
  const open: Record<string, Incident> = {};
  const resolved: Incident[] = [];
  const notifyCritical: Incident[] = [];
  const notifyRecovered: Incident[] = [];
  const seen = new Set<string>();

  for (const o of observations) {
    seen.add(o.key);
    const prev = previous[o.key];
    if (o.level === "ok" || o.level === "off") {
      if (prev) {
        const done: Incident = { ...prev, resolvedAt: iso, autoResolved: !prev.criticalNotifiedAt };
        resolved.push(done);
        if (prev.criticalNotifiedAt) notifyRecovered.push(done);
      }
      continue;
    }
    const inc: Incident = prev
      ? {
          ...prev,
          name: o.name,
          // Een incident kan verergeren (oranje → rood), maar blijft hetzelfde incident.
          level: o.level,
          summary: o.summary,
          action: o.action,
          needsHuman: o.needsHuman,
          core: o.core,
          lastSeenAt: iso,
        }
      : {
          key: o.key,
          name: o.name,
          level: o.level,
          summary: o.summary,
          action: o.action,
          needsHuman: o.needsHuman,
          core: o.core,
          openedAt: iso,
          lastSeenAt: iso,
          recoveryAttempts: 0,
          lastRecoveryAt: null,
          lastRecoveryOk: null,
          nextRecoveryAt: null,
          criticalNotifiedAt: null,
        };
    if (shouldNotifyCritical(inc, now)) {
      inc.criticalNotifiedAt = iso;
      notifyCritical.push(inc);
    }
    open[o.key] = inc;
  }

  // Een incident waarvan de check niet meer bestaat (koppeling uitgezet), sluiten.
  for (const [key, prev] of Object.entries(previous)) {
    if (!seen.has(key)) resolved.push({ ...prev, resolvedAt: iso, autoResolved: !prev.criticalNotifiedAt });
  }

  return { open, resolved, notifyCritical, notifyRecovered };
}

export function shouldNotifyCritical(inc: Incident, now: Date): boolean {
  if (inc.criticalNotifiedAt) return false;
  if (inc.level !== "down" || !inc.core) return false;
  if (inc.needsHuman) return true;
  return now.getTime() - new Date(inc.openedAt).getTime() >= CRITICAL_GRACE_MS;
}

/** Mag er nu een herstelpoging gedaan worden? */
export function recoveryDue(inc: Incident | undefined, obs: Observation, now: Date, force = false): boolean {
  if (!obs.retryable || obs.needsHuman) return false;
  if (obs.level === "ok" || obs.level === "off") return false;
  if (force || !inc?.nextRecoveryAt) return true;
  return now.getTime() >= new Date(inc.nextRecoveryAt).getTime();
}

export function recordRecovery(inc: Incident, ok: boolean, now: Date): Incident {
  const attempts = inc.recoveryAttempts + 1;
  return {
    ...inc,
    recoveryAttempts: attempts,
    lastRecoveryAt: now.toISOString(),
    lastRecoveryOk: ok,
    nextRecoveryAt: new Date(now.getTime() + nextRecoveryDelay(attempts - 1)).toISOString(),
  };
}

/** Hoe vaak kwam dit probleem voor in de afgelopen 7 dagen (incl. het open incident)? */
export function recurrenceCount(key: string, history: Incident[], open: boolean, now: Date): number {
  const since = now.getTime() - RECURRING_WINDOW_MS;
  const past = history.filter((h) => h.key === key && new Date(h.openedAt).getTime() >= since).length;
  return past + (open ? 1 : 0);
}

export function isRecurring(key: string, history: Incident[], open: boolean, now: Date): boolean {
  return recurrenceCount(key, history, open, now) >= RECURRING_THRESHOLD;
}

/** Historie inkorten: alleen de laatste 30 dagen, maximaal 200 regels. */
export function pruneHistory(history: Incident[], now: Date): Incident[] {
  const since = now.getTime() - 30 * 24 * HOUR;
  return history
    .filter((h) => new Date(h.resolvedAt ?? h.lastSeenAt).getTime() >= since)
    .slice(-200);
}

export type DigestContent = {
  hadProblems: Incident[];
  autoResolved: Incident[];
  stillOpen: Incident[];
};

/** Inhoud van het dagoverzicht; null = alles werkte, dan geen bericht. */
export function digestContent(
  open: Record<string, Incident>,
  history: Incident[],
  now: Date,
): DigestContent | null {
  const since = now.getTime() - 24 * HOUR;
  const recent = history.filter((h) => new Date(h.resolvedAt ?? h.lastSeenAt).getTime() >= since);
  const stillOpen = Object.values(open);
  if (recent.length === 0 && stillOpen.length === 0) return null;
  return {
    hadProblems: [...recent, ...stillOpen],
    autoResolved: recent.filter((h) => h.autoResolved),
    stillOpen,
  };
}

export function digestDue(lastDigestDay: string | null, now: Date): boolean {
  const { hour, day } = amsterdamParts(now);
  return hour >= DIGEST_HOUR && lastDigestDay !== day;
}

/**
 * Tekst die naar buiten gaat (mail, melding) mag nooit tokens, wachtwoorden of
 * lange sleutels bevatten. Alles wat daarop lijkt wordt weggepoetst.
 */
export function redact(text: string): string {
  return text
    .replace(/(token|secret|password|wachtwoord|api[-_ ]?key|authorization|bearer)\s*[:=]\s*\S+/gi, "$1: [verborgen]")
    .replace(/\bya29\.[\w.-]+/g, "[verborgen]")
    .replace(/\b1\/\/[\w-]{20,}/g, "[verborgen]")
    .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, "[verborgen]")
    .slice(0, 400);
}
