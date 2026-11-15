/**
 * Editor Meetings: pure regels (geen database), gedeeld door server, pagina's en
 * tests. Alles wat met maanden, statussen, herinneringen en terugkerende
 * feedback te maken heeft staat hier, zodat het rond maandwisselingen op één
 * plek klopt.
 */

/** De content creators die editor meetings voeren. Uitbreiden = e-mail toevoegen. */
export const EDITOR_MEETING_OWNER_EMAILS = ["milou@shortclips.nl", "jiska@shortclips.nl"] as const;

export function isMeetingOwnerEmail(email: string | null | undefined): boolean {
  return !!email && (EDITOR_MEETING_OWNER_EMAILS as readonly string[]).includes(email.toLowerCase());
}

/* ------------------------------- maanden ------------------------------- */

const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

/** YYYY-MM van een datum (YYYY-MM-DD). */
export function periodOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function addPeriods(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export const nextPeriod = (p: string) => addPeriods(p, 1);
export const prevPeriod = (p: string) => addPeriods(p, -1);

export function isPeriod(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** "december 2026". */
export function monthLabel(period: string): string {
  const [y, m] = period.split("-");
  return `${MONTHS[Number(m) - 1] ?? period} ${y}`;
}

/** "December 2026" (voor koppen en lijsten). */
export function monthTitle(period: string): string {
  const s = monthLabel(period);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Laatste dag van de maand, als YYYY-MM-DD. */
export function lastDayOfPeriod(period: string): string {
  const first = utc(`${nextPeriod(period)}-01`);
  return new Date(first - DAY).toISOString().slice(0, 10);
}

/** Aantal dagen tot en met de laatste dag van de maand (0 op de laatste dag). */
export function daysUntilMonthEnd(today: string): number {
  return Math.round((utc(lastDayOfPeriod(periodOf(today))) - utc(today)) / DAY);
}

/** De periodes tussen twee maanden, oplopend, grenzen inbegrepen. */
export function periodRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let p = from; p <= to && out.length < 240; p = nextPeriod(p)) out.push(p);
  return out;
}

/* ------------------------- maandelijkse plantaak ------------------------- */

/** Vanaf zeven dagen voor het einde van de maand wordt de volgende maand gepland. */
export const PLAN_DAYS_BEFORE_MONTH_END = 7;
/** De meetings horen in de eerste week van de maand. */
export const MEETING_WEEK_LAST_DAY = 7;

/**
 * Voor welke maanden loopt er vandaag een plantaak?
 *  - `create`: de maand waarvoor vandaag een nieuwe taak mag ontstaan (de
 *    volgende maand, vanaf zeven dagen voor het maandeinde).
 *  - `maintain`: maanden waarvan een bestaande taak wordt bijgehouden. De
 *    lopende maand hoort daarbij, zodat een taak die eind vorige maand ontstond
 *    zichtbaar blijft tot alles is ingepland. Voor de lopende maand ontstaat
 *    nooit een nieuwe taak.
 */
export function planningPeriods(today: string): { create: string | null; maintain: string[] } {
  const current = periodOf(today);
  const create = daysUntilMonthEnd(today) <= PLAN_DAYS_BEFORE_MONTH_END ? nextPeriod(current) : null;
  return { create, maintain: create ? [current, create] : [current] };
}

/**
 * Herinneringsmoment voor de plantaak van `period`. Elk moment levert hooguit
 * één melding op (de sleutel zit in de ontdubbeling), en alleen zolang er nog
 * meetings ontbreken.
 */
export function reminderStage(today: string, period: string): "start" | "laatste-dagen" | "maand-gestart" | "eerste-week-voorbij" | null {
  const before = prevPeriod(period);
  const end = lastDayOfPeriod(before);
  const startOn = new Date(utc(end) - PLAN_DAYS_BEFORE_MONTH_END * DAY).toISOString().slice(0, 10);
  if (today < startOn) return null;
  if (today >= `${period}-${String(MEETING_WEEK_LAST_DAY + 1).padStart(2, "0")}`) return "eerste-week-voorbij";
  if (today >= `${period}-01`) return "maand-gestart";
  if (today >= new Date(utc(end) - 2 * DAY).toISOString().slice(0, 10)) return "laatste-dagen";
  return "start";
}

export const PLAN_TASK_PREFIX = "editormeetings:plan:";
export const ACTION_TASK_PREFIX = "editormeeting:actie:";

export function planTaskKey(period: string, ownerId: string): string {
  return `${PLAN_TASK_PREFIX}${period}:${ownerId}`;
}

export function parsePlanTaskKey(key: string | null | undefined): { period: string; ownerId: string } | null {
  if (!key?.startsWith(PLAN_TASK_PREFIX)) return null;
  const [period, ownerId] = key.slice(PLAN_TASK_PREFIX.length).split(":");
  return isPeriod(period) && ownerId ? { period, ownerId } : null;
}

export function planTaskTitle(period: string): string {
  return `Plan de editor meetings voor ${monthLabel(period)}`;
}

export type PlanLine = { editorName: string; state: "gepland" | "ontbreekt" | "opnieuw"; when?: string | null };

/** Tekst in de plantaak: wat staat er al, wat ontbreekt en wat moet opnieuw. */
export function planTaskDescription(lines: PlanLine[]): string {
  const planned = lines.filter((l) => l.state === "gepland");
  const missing = lines.filter((l) => l.state === "ontbreekt");
  const again = lines.filter((l) => l.state === "opnieuw");
  const out: string[] = [];
  out.push(`Jouw editors: ${lines.map((l) => l.editorName).join(", ") || "geen"}`);
  out.push(`Ingepland: ${planned.length ? planned.map((l) => (l.when ? `${l.editorName} (${l.when})` : l.editorName)).join(", ") : "nog geen"}`);
  out.push(`Nog te plannen: ${missing.length ? missing.map((l) => l.editorName).join(", ") : "geen"}`);
  if (again.length) out.push(`Opnieuw plannen: ${again.map((l) => l.editorName).join(", ")}`);
  return out.join("\n");
}

/* ------------------------------- status ------------------------------- */

export type MeetingState = {
  status: string;
  scheduledAt: Date | string | null;
  reportStatus: string;
} | null;

export type DisplayStatus =
  | "te_plannen"
  | "opnieuw_plannen"
  | "gepland"
  | "verslag_nodig"
  | "verslag_concept"
  | "afgerond"
  | "niet_gehouden";

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  te_plannen: "Nog te plannen",
  opnieuw_plannen: "Opnieuw plannen",
  gepland: "Gepland",
  verslag_nodig: "Verslag ontbreekt",
  verslag_concept: "Verslag in concept",
  afgerond: "Afgerond",
  niet_gehouden: "Niet gehouden",
};

export const STATUS_TONE: Record<DisplayStatus, "neutral" | "info" | "good" | "warn" | "bad"> = {
  te_plannen: "neutral",
  opnieuw_plannen: "warn",
  gepland: "info",
  verslag_nodig: "warn",
  verslag_concept: "warn",
  afgerond: "good",
  niet_gehouden: "bad",
};

/** Voor de editor: geen interne tussenstanden, alleen wat voor hem telt. */
export function editorStatusLabel(status: DisplayStatus): string {
  if (status === "afgerond") return "Afgerond";
  if (status === "gepland") return "Gepland";
  if (status === "verslag_nodig" || status === "verslag_concept") return "Geweest, verslag volgt";
  if (status === "niet_gehouden") return "Niet gehouden";
  return "Nog te plannen";
}

/**
 * De status van de meeting van één editor in één maand.
 * Een geplande meeting waarvan het moment voorbij is geldt als gehouden; wie
 * hem verplaatst of annuleert past dat aan in het portaal.
 */
export function displayStatus(meeting: MeetingState, period: string, now: Date, today: string): DisplayStatus {
  const current = periodOf(today);
  if (meeting?.reportStatus === "gepubliceerd") return "afgerond";
  const at = meeting?.scheduledAt ? new Date(meeting.scheduledAt) : null;
  const planned = !!meeting && meeting.status === "gepland" && !!at;
  if (!planned) {
    if (period < current) return "niet_gehouden";
    return meeting ? "opnieuw_plannen" : "te_plannen";
  }
  if (at!.getTime() > now.getTime()) return "gepland";
  return meeting!.reportStatus === "concept" ? "verslag_concept" : "verslag_nodig";
}

/**
 * De eerste maand waarin editor meetings via het portaal lopen. Maanden daarvoor
 * tellen nooit als achterstand: toen bestond dit onderdeel nog niet.
 */
export const FIRST_MEETING_PERIOD = "2026-12";

/** Dagen na de meeting waarna een ontbrekend verslag als "over tijd" telt. */
export const REPORT_GRACE_DAYS = 3;

/**
 * Is deze meeting over tijd? Dat is zo als:
 *  - de eerste week van de maand voorbij is en er nog niets (geldigs) gepland staat;
 *  - de meeting is geweest en het verslag na drie dagen nog niet is gepubliceerd;
 *  - de maand voorbij is zonder meeting.
 */
export function isOverdue(meeting: MeetingState, period: string, now: Date, today: string): boolean {
  const status = displayStatus(meeting, period, now, today);
  if (status === "afgerond" || status === "gepland") return false;
  if (!meeting && period < FIRST_MEETING_PERIOD) return false;
  if (status === "niet_gehouden") return true;
  if (status === "te_plannen" || status === "opnieuw_plannen") {
    return period === periodOf(today) && Number(today.slice(8, 10)) > MEETING_WEEK_LAST_DAY;
  }
  const at = new Date(meeting!.scheduledAt!);
  return now.getTime() - at.getTime() > REPORT_GRACE_DAYS * DAY;
}

/* ------------------------------- thema's ------------------------------- */

export const EDITOR_THEMES: Record<string, string> = {
  montage: "Montage en storytelling",
  hook: "Eerste seconden",
  ondertiteling: "Ondertiteling en tekst",
  audio: "Muziek en geluidseffecten",
  kleur: "Kleurcorrectie",
  tempo: "Tempo en kijkersbehoud",
  editing_guide: "Editing guide van de klant",
  consistentie: "Consistentie tussen video's",
  nauwkeurigheid: "Zelfstandigheid en nauwkeurigheid",
  deadlines: "Deadlines",
  communicatie: "Communicatie",
  feedback: "Feedback verwerken",
  overig: "Overig",
};

export const SHORTCLIPS_THEMES: Record<string, string> = {
  briefings: "Briefings",
  planning: "Planning en deadlines",
  communicatie: "Communicatie",
  feedback: "Feedback vanuit Shortclips",
  materiaal: "Aangeleverd materiaal",
  ondersteuning: "Ondersteuning",
  overig: "Overig",
};

export const POINT_KINDS = ["sterk", "verbeterpunt", "vaardigheid", "shortclips"] as const;
export type PointKind = (typeof POINT_KINDS)[number];

export function themeLabel(kind: string, theme: string): string {
  const map = kind === "shortclips" ? SHORTCLIPS_THEMES : EDITOR_THEMES;
  return map[theme] ?? map.overig!;
}

export function cleanTheme(kind: string, theme: string | null | undefined): string {
  const map = kind === "shortclips" ? SHORTCLIPS_THEMES : EDITOR_THEMES;
  return theme && theme in map ? theme : "overig";
}

export const OWNER_TYPES = ["editor", "content_creator", "shortclips"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];
export const OWNER_TYPE_LABEL: Record<OwnerType, string> = {
  editor: "Editor",
  content_creator: "Content creator",
  shortclips: "Shortclips",
};

/* ------------------------- terugkerende feedback ------------------------- */

export type ThemeHit = { theme: string; period: string };
export type RecurringTheme = { theme: string; months: number; periods: string[] };

/**
 * Thema's die in minstens `minMonths` verschillende maanden terugkomen binnen
 * de laatste `window` maanden (gerekend vanaf de recentste maand in de lijst).
 * "Overig" telt niet mee: dat zegt niets over herhaling.
 */
export function recurringThemes(hits: ThemeHit[], minMonths = 2, window = 4): RecurringTheme[] {
  if (hits.length === 0) return [];
  const latest = hits.reduce((a, h) => (h.period > a ? h.period : a), hits[0]!.period);
  const from = addPeriods(latest, -(window - 1));
  const byTheme = new Map<string, Set<string>>();
  for (const h of hits) {
    if (h.theme === "overig" || h.period < from) continue;
    if (!byTheme.has(h.theme)) byTheme.set(h.theme, new Set());
    byTheme.get(h.theme)!.add(h.period);
  }
  return [...byTheme.entries()]
    .filter(([, periods]) => periods.size >= minMonths)
    .map(([theme, periods]) => ({ theme, months: periods.size, periods: [...periods].sort() }))
    .sort((a, b) => b.months - a.months || a.theme.localeCompare(b.theme));
}

export type SharedTheme = { theme: string; editors: number; editorIds: string[] };

/**
 * Feedback op Shortclips die door minstens `minEditors` verschillende editors is
 * gegeven: een intern verbeterpunt, geen probleem van één editor.
 */
export function sharedShortclipsThemes(hits: (ThemeHit & { editorId: string })[], minEditors = 2): SharedTheme[] {
  const byTheme = new Map<string, Set<string>>();
  for (const h of hits) {
    if (h.theme === "overig") continue;
    if (!byTheme.has(h.theme)) byTheme.set(h.theme, new Set());
    byTheme.get(h.theme)!.add(h.editorId);
  }
  return [...byTheme.entries()]
    .filter(([, ids]) => ids.size >= minEditors)
    .map(([theme, ids]) => ({ theme, editors: ids.size, editorIds: [...ids] }))
    .sort((a, b) => b.editors - a.editors || a.theme.localeCompare(b.theme));
}

/* ----------------------------- conceptagenda ----------------------------- */

export type AgendaInput = {
  reviewPeriod: string;
  delivered: number | null;
  missedDeadlines: number | null;
  openFeedback: number | null;
  openActions: string[];
  openPoints: { theme: string; body: string }[];
  recurring: RecurringTheme[];
};

/**
 * Conceptagenda op basis van wat er al in het portaal staat. Alleen feiten:
 * een regel verschijnt pas als het bijbehorende gegeven er echt is.
 */
export function draftAgenda(input: AgendaInput): string[] {
  const out: string[] = [];
  const month = monthLabel(input.reviewPeriod);
  out.push(
    input.delivered != null && input.delivered > 0
      ? `Terugblik ${month}: ${input.delivered} ${input.delivered === 1 ? "opgeleverd project" : "opgeleverde projecten"} doorlopen`
      : `Terugblik ${month}`,
  );
  if (input.missedDeadlines) out.push(`Deadlines: ${input.missedDeadlines} ${input.missedDeadlines === 1 ? "gemiste deadline" : "gemiste deadlines"} bespreken`);
  if (input.openFeedback) out.push(`Openstaande feedback: ${input.openFeedback} ${input.openFeedback === 1 ? "project wacht" : "projecten wachten"} op verwerking`);
  for (const r of input.recurring) out.push(`Terugkerend punt (${r.months} maanden): ${EDITOR_THEMES[r.theme] ?? r.theme}`);
  const recurringKeys = new Set(input.recurring.map((r) => r.theme));
  for (const p of input.openPoints.filter((x) => !recurringKeys.has(x.theme)).slice(0, 4)) out.push(`Verbeterpunt vorige keer: ${p.body}`);
  if (input.openActions.length) out.push(`Openstaande actiepunten (${input.openActions.length}) nalopen`);
  out.push("Samenwerking: wat kan de editor beter, wat kan Shortclips beter");
  out.push(`Vooruitblik ${monthLabel(nextPeriod(input.reviewPeriod))}: klanten, planning en verbeterdoelen`);
  return out;
}

/* ------------------------------- agenda ------------------------------- */

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Link waarmee de meeting met één klik in Google Agenda gezet kan worden. */
export function googleCalendarUrl(input: { title: string; start: Date; minutes: number; details?: string; location?: string | null }): string {
  const end = new Date(input.start.getTime() + input.minutes * 60_000);
  const q = new URLSearchParams({ action: "TEMPLATE", text: input.title, dates: `${stamp(input.start)}/${stamp(end)}`, ctz: "Europe/Amsterdam" });
  if (input.details) q.set("details", input.details);
  if (input.location) q.set("location", input.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** Hoe ver Europe/Amsterdam voor UTC ligt op een moment, in ms (ook bij zomertijd). */
function amsterdamOffsetMs(at: Date): number {
  const asUtc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  const asAms = new Date(at.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  return asAms.getTime() - asUtc.getTime();
}

/**
 * Datum en tijd zoals ingevuld in het formulier (Nederlandse tijd, YYYY-MM-DD en
 * HH:MM) naar het juiste moment. Onafhankelijk van de tijdzone van de server.
 */
export function amsterdamToDate(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const guess = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(guess)) return null;
  return new Date(guess - amsterdamOffsetMs(new Date(guess)));
}

/** Het moment terug naar de formuliervelden (Nederlandse tijd). */
export function dateToAmsterdam(at: Date | string): { date: string; time: string } {
  const d = new Date(at);
  const date = d.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const time = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { date, time };
}

/** "Woensdag 2 december 2026 om 10:00". */
export function meetingMoment(at: Date | string): string {
  const d = new Date(at);
  const day = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} om ${dateToAmsterdam(d).time}`;
}

/** "2 dec 10:00" (kort, voor lijsten en taken). */
export function meetingMomentShort(at: Date | string): string {
  const d = new Date(at);
  const day = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short" }).format(d).replace(".", "");
  return `${day} ${dateToAmsterdam(d).time}`;
}
