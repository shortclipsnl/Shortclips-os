/**
 * Klantmomenten: samenwerkingsjubilea en bedrijfsjubilea van klanten.
 *
 * Pure rekenlogica (geen database), zodat de klantpagina, de takenpagina en de
 * dagelijkse job precies hetzelfde rekenen. Een week vooraf (LEAD_DAYS) krijgt
 * de verantwoordelijke van de klant een taak en een melding.
 *
 * - Samenwerkingsjubileum: elk jaar vanaf 1 jaar samenwerking.
 * - Bedrijfsjubileum: bij 5, 10, 15, 20 jaar enzovoort. Alleen met een volledige
 *   oprichtingsdatum is een melding vooraf mogelijk; met alleen een jaartal toont
 *   de klantpagina "dag en maand aanvullen".
 */

export const LEAD_DAYS = 7;
export const KLANTMOMENT_PREFIX = "klantmoment:";

export type DateStatus = "bevestigd" | "indicatie";

export type MomentInput = {
  /** Start van de samenwerking (YYYY-MM-DD) en hoe zeker die is. */
  start: { date: string; status: DateStatus } | null;
  /** Volledige oprichtingsdatum (YYYY-MM-DD), indien bekend. */
  foundedOn: string | null;
  /** Alleen het oprichtingsjaar, als de exacte datum ontbreekt. */
  foundedYear: number | null;
  /** Hoe zeker de oprichtingsdatum is (standaard indicatie; KvK-uittreksel = bevestigd). */
  foundedStatus?: DateStatus;
};

export type MomentKind = "samenwerking" | "bedrijf";

export type ClientMoment = {
  kind: MomentKind;
  /** Aantal jaren (1, 2, 3 ... of 5, 10, 15 ...). */
  years: number;
  /** Datum van het moment (YYYY-MM-DD). */
  date: string;
  status: DateStatus;
  /** Vanaf deze dag staat de taak klaar (YYYY-MM-DD). */
  taskOn: string;
};

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  return iso(utc(date) + n * DAY);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY);
}

/** Zelfde dag en maand, `n` jaar later. 29 februari valt in gewone jaren op 28 februari. */
export function addYears(date: string, n: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number) as [number, number, number];
  const year = y + n;
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * Alle momenten van een klant die vallen tussen `today - pastDays` en
 * `today + horizonDays`, gesorteerd op datum.
 */
export function computeMoments(input: MomentInput, today: string, horizonDays = 400, pastDays = 0): ClientMoment[] {
  const out: ClientMoment[] = [];
  const from = addDays(today, -pastDays);
  const to = addDays(today, horizonDays);

  const push = (kind: MomentKind, base: string, step: number, status: DateStatus) => {
    for (let n = step; n <= 200; n += step) {
      const date = addYears(base, n);
      if (date > to) break;
      if (date < from) continue;
      out.push({ kind, years: n, date, status, taskOn: addDays(date, -LEAD_DAYS) });
    }
  };

  if (input.start?.date) push("samenwerking", input.start.date, 1, input.start.status);
  if (input.foundedOn) push("bedrijf", input.foundedOn, 5, input.foundedStatus ?? "indicatie");

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/**
 * Eerstvolgend bedrijfsjubileum (5, 10, 15 ...) als alleen het jaartal bekend is:
 * dan weten we het jaar, maar niet de dag. Null als er een volledige datum is.
 */
export function yearOnlyJubilee(input: MomentInput, today: string): { year: number; years: number } | null {
  if (input.foundedOn || !input.foundedYear) return null;
  let year = Number(today.slice(0, 4));
  while ((year - input.foundedYear) % 5 !== 0 || year - input.foundedYear < 5) year++;
  return { year, years: year - input.foundedYear };
}

/** Moet er vandaag een taak klaarstaan? Vanaf een week vooraf tot en met de dag zelf. */
export function isDue(m: ClientMoment, today: string): boolean {
  return today >= m.taskOn && today <= m.date;
}

export function momentLabel(m: Pick<ClientMoment, "kind" | "years">): string {
  return m.kind === "samenwerking" ? `${m.years} jaar samenwerking` : `${m.years} jaar bestaan`;
}

/** Groot moment: 25, 50, 75, 100 jaar bestaan, of 5 jaar samenwerking en meer. */
export function isBigMoment(m: Pick<ClientMoment, "kind" | "years">): boolean {
  return m.kind === "bedrijf" ? m.years % 25 === 0 : m.years >= 5;
}

/** Voorstel voor de attentie. Bij een groot moment beslist Jarno mee. */
export function attentionProposal(m: Pick<ClientMoment, "kind" | "years">): string {
  if (m.kind === "samenwerking") {
    if (m.years === 1) return "persoonlijk kaartje";
    if (m.years < 5) return "kaartje met een klein cadeau";
    return "cadeau op maat, in overleg met Jarno";
  }
  if (m.years % 25 === 0) return "groot jubileum: cadeau op maat, in overleg met Jarno";
  return "felicitatie met kaartje of bloemen";
}

export function momentDedupeKey(clientId: string, m: Pick<ClientMoment, "kind" | "years" | "date">): string {
  return `${KLANTMOMENT_PREFIX}${clientId}:${m.kind}:${m.years}:${m.date}`;
}

export function isKlantmomentKey(key: string | null | undefined): boolean {
  return !!key && key.startsWith(KLANTMOMENT_PREFIX);
}

const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

/** "18 november 2026". */
export function longDate(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Omschrijving van de taak; de regels "Moment:" en "Voorstel:" leest de takenpagina terug. */
export function taskDescription(m: ClientMoment): string {
  const lines = [
    `Moment: ${momentLabel(m)} op ${longDate(m.date)}`,
    `Voorstel: ${attentionProposal(m)}`,
    "",
  ];
  if (m.status === "indicatie") {
    lines.push("Let op: deze datum is een indicatie. Controleer eerst de juiste datum bij de klant.");
  }
  lines.push("Regel de attentie vóór de datum en vink deze taak af zodra het geregeld is.");
  return lines.join("\n");
}
