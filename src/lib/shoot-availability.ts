/**
 * Beschikbaarheid voor opnames, per videograaf per werkdag. Puur rekenwerk
 * (geen database), zodat het los te testen is. De gegevens komen uit
 * src/server/shoot-planning.ts: opnamedagen (Google Agenda-sync), goedgekeurd
 * verlof, blokkades in de agenda en Nederlandse feestdagen.
 *
 * Een dag telt alleen als beschikbaar wanneer er binnen de werktijden een
 * aaneengesloten blok vrij is dat lang genoeg is voor een opname, inclusief
 * reistijd rond bestaande opnames. Een dag is "beschikbaar" zodra minstens één
 * videograaf ruimte heeft.
 */

export type VgRef = {
  id: string;
  name: string;
  /** Telt mee als vaste opnamecapaciteit. Iemand zonder eigen agenda met zijn
   *  bezetting (Jarno) staat op false: diens dagen zijn "op aanvraag", anders
   *  zou elke dag ten onrechte als beschikbaar verschijnen. */
  countsForCapacity?: boolean;
};

/** Een interval (HH:MM) waarin een videograaf niet kan filmen. null = hele dag. */
export type BusyItem = {
  /** null = geldt voor het hele team (bijv. sluitingsdag). */
  videographerId: string | null;
  date: string; // YYYY-MM-DD
  start: string | null;
  end: string | null;
  /** Korte uitleg, bijv. klantnaam of "Verlof". */
  label: string;
  /** "opname" telt mee met reistijd; "blokkade" niet. */
  kind: "opname" | "blokkade";
};

export type AvailabilityConfig = {
  workdayStart: string; // "08:30"
  workdayEnd: string; // "17:00"
  /** Minimale aaneengesloten tijd voor een opname. */
  shootMinutes: number;
  /** Reistijd/opbouw vóór en na een bestaande opname. */
  bufferMinutes: number;
};

export const DEFAULT_AVAILABILITY_CONFIG: AvailabilityConfig = {
  workdayStart: "08:30",
  workdayEnd: "17:00",
  shootMinutes: 240,
  bufferMinutes: 60,
};

export type VgDayState = "beschikbaar" | "bezet" | "afwezig" | "op_aanvraag";

export type VgDay = {
  videographerId: string;
  name: string;
  state: VgDayState;
  /** Toelichting: "hele dag", "vanaf 13:30", "Hegro", "Verlof", "Feestdag". */
  detail: string;
  /** Bij bezet: door een geplande opname (blauw) of door iets anders (grijs). */
  busyBy?: "opname" | "blokkade";
};

export type AvailabilityDay = {
  date: string;
  /** "vrijdag 20 november" */
  label: string;
  /** "vrijdag" */
  weekday: string;
  holiday: boolean;
  perVg: VgDay[];
  available: boolean;
};

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
export const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dow(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = zondag
}

export function dayLabel(iso: string): { label: string; weekday: string } {
  const d = new Date(`${iso}T12:00:00Z`);
  const weekday = d.toLocaleDateString("nl-NL", { weekday: "long", timeZone: "UTC" });
  const rest = d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "UTC" });
  return { label: `${weekday} ${rest}`, weekday };
}

/** Werkdagen (ma-vr) van `from` t/m `to`, inclusief beide. */
export function workdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = dow(d);
    if (w >= 1 && w <= 5) out.push(d);
  }
  return out;
}

/**
 * Grootste vrije blok binnen de werkdag na aftrek van de bezette intervallen.
 * Geeft [start, eind] in minuten, of null als er niets vrij is.
 */
export function largestFreeGap(busy: Array<[number, number]>, dayStart: number, dayEnd: number): [number, number] | null {
  const sorted = busy
    .map(([a, b]) => [Math.max(dayStart, a), Math.min(dayEnd, b)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let cursor = dayStart;
  let best: [number, number] | null = null;
  for (const [a, b] of sorted) {
    if (a > cursor && (!best || a - cursor > best[1] - best[0])) best = [cursor, a];
    cursor = Math.max(cursor, b);
  }
  if (dayEnd > cursor && (!best || dayEnd - cursor > best[1] - best[0])) best = [cursor, dayEnd];
  return best;
}

export function computeAvailability(input: {
  from: string;
  to: string;
  today: string;
  /** Huidige tijd in minuten (Nederlandse tijd), voor vandaag. */
  nowMinutes: number;
  videographers: VgRef[];
  busy: BusyItem[];
  holidays: ReadonlySet<string>;
  config?: AvailabilityConfig;
}): AvailabilityDay[] {
  const cfg = input.config ?? DEFAULT_AVAILABILITY_CONFIG;
  const ws = toMin(cfg.workdayStart);
  const we = toMin(cfg.workdayEnd);

  const byKey = new Map<string, BusyItem[]>();
  for (const b of input.busy) {
    const k = `${b.date}|${b.videographerId ?? "*"}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(b);
  }

  const days: AvailabilityDay[] = [];
  for (const date of workdaysBetween(input.from, input.to)) {
    if (date < input.today) continue;
    const { label, weekday } = dayLabel(date);
    const holiday = input.holidays.has(date);
    const perVg: VgDay[] = input.videographers.map((vg) => {
      if (holiday) return { videographerId: vg.id, name: vg.name, state: "afwezig", detail: "Feestdag" };
      const items = [...(byKey.get(`${date}|${vg.id}`) ?? []), ...(byKey.get(`${date}|*`) ?? [])];

      // Hele-dag-blokkade (verlof, vrij, sluitingsdag) → afwezig.
      const fullBlock = items.find((i) => i.kind === "blokkade" && !i.start && !i.end);
      if (fullBlock) return { videographerId: vg.id, name: vg.name, state: "afwezig", detail: fullBlock.label };

      const intervals: Array<[number, number]> = [];
      for (const i of items) {
        const buf = i.kind === "opname" ? cfg.bufferMinutes : 0;
        const s = i.start ? toMin(i.start) : ws;
        // Opname zonder eindtijd: reken een volle opnamedag (6 uur).
        const e = i.end ? toMin(i.end) : i.start ? toMin(i.start) + 360 : we;
        intervals.push([s - buf, e + buf]);
      }
      if (date === input.today) intervals.push([ws, input.nowMinutes]);

      const gap = largestFreeGap(intervals, ws, we);
      const shoots = items.filter((i) => i.kind === "opname").map((i) => i.label);
      if (vg.countsForCapacity === false && shoots.length === 0) {
        return { videographerId: vg.id, name: vg.name, state: "op_aanvraag", detail: "Op aanvraag" };
      }
      if (gap && gap[1] - gap[0] >= cfg.shootMinutes) {
        const whole = gap[0] === ws && gap[1] === we;
        const detail = whole ? "hele dag" : gap[1] === we ? `vanaf ${fromMin(gap[0])}` : `${fromMin(gap[0])}-${fromMin(gap[1])}`;
        return { videographerId: vg.id, name: vg.name, state: "beschikbaar", detail };
      }
      const blockers = items.filter((i) => i.kind === "blokkade").map((i) => i.label);
      const detail = shoots.length > 0 ? shoots.join(", ") : blockers.length > 0 ? blockers.join(", ") : date === input.today ? "dag bijna voorbij" : "vol";
      return { videographerId: vg.id, name: vg.name, state: "bezet", detail, busyBy: shoots.length > 0 ? "opname" : "blokkade" };
    });
    days.push({ date, label, weekday, holiday, perVg, available: perVg.some((v) => v.state === "beschikbaar") });
  }
  return days;
}

/** Herkent een agenda-afspraak die een videograaf (of het hele team) blokkeert. */
const ABSENT_RE = /\b(vrij|vakantie|verlof|ziek|afwezig|niet beschikbaar|vrije dag)\b/i;
const TEAM_CLOSED_RE = /\b(gesloten|sluitingsdag|kantoor dicht|shortclips dicht)\b/i;

export function blockFromCalendarTitle(
  title: string | null,
  videographers: VgRef[],
): { videographerId: string | null; label: string } | null {
  if (!title) return null;
  if (TEAM_CLOSED_RE.test(title)) return { videographerId: null, label: "Gesloten" };
  if (!ABSENT_RE.test(title)) return null;
  for (const vg of videographers) {
    const first = vg.name.split(" ")[0]!;
    if (new RegExp(`\\b${first}\\b`, "i").test(title)) return { videographerId: vg.id, label: "Afwezig" };
  }
  return null;
}
