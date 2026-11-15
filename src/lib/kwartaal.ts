/**
 * Kwartaalrapportages: periodes, statussen, planning en taaksleutels.
 *
 * Puur (zonder database), zodat de planner, de pagina's, de taken en de tests
 * exact dezelfde regels gebruiken. Alle datums zijn Amsterdamse kalenderdagen
 * als "YYYY-MM-DD"; er wordt nooit met tijdstippen gerekend, zodat een periode
 * niet een dag kan verschuiven door een tijdzone.
 */
import { addWorkingDays } from "./workdays";

type Holidays = ReadonlySet<string> | undefined;

/* ------------------------------------------------------------------ *
 * Datumhulp
 * ------------------------------------------------------------------ */

const parse = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

/**
 * `n` maanden na een ankerdatum, op dezelfde dag van de maand. Bestaat die dag
 * niet (31 → februari), dan de laatste dag van die maand. Altijd vanaf het
 * anker gerekend, zodat een startdatum op de 31e niet langzaam verschuift.
 */
export function addMonthsClamped(anchor: string, n: number): string {
  const [y, m, d] = anchor.slice(0, 10).split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d!, last));
  return fmt(first);
}

export function daysInRange(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;
}

const dag = (d: string, opts: Intl.DateTimeFormatOptions) => parse(d).toLocaleDateString("nl-NL", { timeZone: "UTC", ...opts });
export const kortDatum = (d: string) => dag(d, { day: "numeric", month: "short" }).replace(".", "");
export const langDatum = (d: string) => dag(d, { day: "numeric", month: "long", year: "numeric" });

/* ------------------------------------------------------------------ *
 * Periodes
 * ------------------------------------------------------------------ */

export type QuarterMode = "kalender" | "contract";

export type QuarterSegment = { from: string; to: string; label: string };

export type Quarter = {
  /** Kalender: "2026-Q4". Contract: "C2026-02-15" (startdag van het contractkwartaal). */
  key: string;
  mode: QuarterMode;
  from: string;
  to: string;
  /** "Q4 2026" of "15 feb t/m 14 mei 2026". */
  label: string;
  /** Jaar waarin het kwartaal eindigt (voor het jaarfilter). */
  year: number;
  /** Kalender: 1 t/m 4. Contract: volgnummer sinds de startdatum (1 = eerste kwartaal). */
  index: number;
  /** De drie maanden van het kwartaal (bij contractkwartalen: drie contractmaanden). */
  segments: [QuarterSegment, QuarterSegment, QuarterSegment];
};

const KEY_CAL = /^(\d{4})-Q([1-4])$/;
const KEY_CON = /^C(\d{4}-\d{2}-\d{2})$/;

export function isQuarterKey(key: string): boolean {
  return KEY_CAL.test(key) || KEY_CON.test(key);
}

function segmentsFrom(from: string, kalender: boolean): Quarter["segments"] {
  const seg = (i: number): QuarterSegment => {
    const a = addMonthsClamped(from, i);
    const b = addDays(addMonthsClamped(from, i + 1), -1);
    return { from: a, to: b, label: kalender ? dag(a, { month: "long" }) : `${kortDatum(a)} t/m ${kortDatum(b)}` };
  };
  return [seg(0), seg(1), seg(2)];
}

export function calendarQuarter(year: number, q: number): Quarter {
  const from = `${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
  const to = addDays(addMonthsClamped(from, 3), -1);
  return { key: `${year}-Q${q}`, mode: "kalender", from, to, label: `Q${q} ${year}`, year, index: q, segments: segmentsFrom(from, true) };
}

/** Het kalenderkwartaal waarin een dag valt. */
export function calendarQuarterOf(day: string): Quarter {
  const [y, m] = day.split("-").map(Number);
  return calendarQuarter(y!, Math.floor((m! - 1) / 3) + 1);
}

/** Het n-de contractkwartaal (1 = eerste) vanaf de startdatum van de samenwerking. */
export function contractQuarter(startedOn: string, n: number): Quarter {
  const start = startedOn.slice(0, 10);
  const from = addMonthsClamped(start, 3 * (n - 1));
  const to = addDays(addMonthsClamped(start, 3 * n), -1);
  // De drie contractmaanden, steeds vanaf de oorspronkelijke startdatum gerekend.
  const seg = (i: number): QuarterSegment => {
    const a = addMonthsClamped(start, 3 * (n - 1) + i);
    const b = addDays(addMonthsClamped(start, 3 * (n - 1) + i + 1), -1);
    return { from: a, to: b, label: `${kortDatum(a)} t/m ${kortDatum(b)}` };
  };
  return {
    key: `C${from}`, mode: "contract", from, to,
    label: `${kortDatum(from)} t/m ${langDatum(to)}`,
    year: Number(to.slice(0, 4)), index: n, segments: [seg(0), seg(1), seg(2)],
  };
}

/** Het contractkwartaal waarin een dag valt; null als de dag vóór de startdatum ligt. */
export function contractQuarterOf(startedOn: string, day: string): Quarter | null {
  const start = startedOn.slice(0, 10);
  if (day < start) return null;
  const [sy, sm] = start.split("-").map(Number);
  const [dy, dm] = day.split("-").map(Number);
  // Schatting op basis van maanden, daarna één stap corrigeren.
  let n = Math.max(1, Math.floor(((dy! - sy!) * 12 + (dm! - sm!)) / 3) + 1);
  while (n > 1 && contractQuarter(start, n).from > day) n--;
  while (contractQuarter(start, n).to < day) n++;
  return contractQuarter(start, n);
}

/**
 * Het kwartaal waarin een dag valt volgens de indeling van de klant. Contract
 * zonder (bruikbare) startdatum valt terug op het kalenderkwartaal; de aanroeper
 * meldt dat dan als ontbrekend gegeven.
 */
export function quarterOf(mode: QuarterMode, startedOn: string | null | undefined, day: string): Quarter {
  if (mode === "contract" && startedOn) return contractQuarterOf(startedOn, day) ?? calendarQuarterOf(day);
  return calendarQuarterOf(day);
}

/** Periode terug uit de sleutel. Voor contractkwartalen is de startdatum nodig voor het volgnummer. */
export function quarterFromKey(key: string, startedOn?: string | null): Quarter | null {
  const cal = KEY_CAL.exec(key);
  if (cal) return calendarQuarter(Number(cal[1]), Number(cal[2]));
  const con = KEY_CON.exec(key);
  if (!con) return null;
  const from = con[1]!;
  if (startedOn) {
    const q = contractQuarterOf(startedOn, from);
    if (q && q.from === from) return q;
  }
  // Zonder (passende) startdatum: het kwartaal vanaf zijn eigen startdag.
  const q = contractQuarter(from, 1);
  return { ...q, index: 0 };
}

/** Het kwartaal ervoor. Null bij het eerste contractkwartaal (er is geen eerder). */
export function previousQuarter(q: Quarter, startedOn?: string | null): Quarter | null {
  if (q.mode === "kalender") return q.index === 1 ? calendarQuarter(q.year - 1, 4) : calendarQuarter(q.year, q.index - 1);
  if (!startedOn || q.index <= 1) return null;
  return contractQuarter(startedOn, q.index - 1);
}

export function nextQuarter(q: Quarter, startedOn?: string | null): Quarter {
  if (q.mode === "kalender") return q.index === 4 ? calendarQuarter(q.year + 1, 1) : calendarQuarter(q.year, q.index + 1);
  return contractQuarter(startedOn ?? q.from, startedOn ? q.index + 1 : 2);
}

/** Titel van het rapport: "Kwartaalrapportage Q4 2026". */
export function quarterTitle(q: Pick<Quarter, "label">): string {
  return `Kwartaalrapportage ${q.label}`;
}

/* ------------------------------------------------------------------ *
 * Statussen (goedkeuringsproces)
 * ------------------------------------------------------------------ */

export const QUARTER_STATUSES = [
  "gepland",
  "in_voorbereiding",
  "concept_gegenereerd",
  "wachten_op_data",
  "klaar_voor_controle",
  "aanpassingen_nodig",
  "goedgekeurd",
  "gepubliceerd",
] as const;
export type QuarterStatus = (typeof QUARTER_STATUSES)[number];

export type QuarterTone = "neutral" | "info" | "violet" | "warn" | "good" | "lime" | "bad";

export const QUARTER_STATUS_META: Record<QuarterStatus, { label: string; tone: QuarterTone; uitleg: string }> = {
  gepland: { label: "Gepland", tone: "neutral", uitleg: "Het kwartaal loopt. De voorbereiding start op de eerste dag van de derde maand." },
  in_voorbereiding: { label: "In voorbereiding", tone: "info", uitleg: "De rapportagetaak staat klaar. Het voorlopige concept volgt halverwege de derde maand." },
  concept_gegenereerd: { label: "Concept gegenereerd", tone: "violet", uitleg: "Er is een voorlopig concept met de cijfers tot nu toe. Nog niet definitief." },
  wachten_op_data: { label: "Wachten op volledige data", tone: "warn", uitleg: "Het kwartaal is voorbij, maar nog niet alle cijfers zijn binnen." },
  klaar_voor_controle: { label: "Klaar voor interne controle", tone: "violet", uitleg: "De definitieve rapportage staat klaar om te controleren." },
  aanpassingen_nodig: { label: "Aanpassingen nodig", tone: "warn", uitleg: "De rapportage is teruggezet. Verwerk de opmerkingen en bied opnieuw aan." },
  goedgekeurd: { label: "Goedgekeurd", tone: "good", uitleg: "Goedgekeurd. De klantversie kan naar het klantportaal." },
  gepubliceerd: { label: "Gepubliceerd", tone: "lime", uitleg: "De klantversie staat in het klantportaal." },
};

export function isQuarterStatus(v: unknown): v is QuarterStatus {
  return typeof v === "string" && (QUARTER_STATUSES as readonly string[]).includes(v);
}

/** Statussen waarin de inhoud nog bewerkt mag worden. */
export const EDITABLE_STATUSES: QuarterStatus[] = ["concept_gegenereerd", "wachten_op_data", "klaar_voor_controle", "aanpassingen_nodig"];
/** Statussen waarin de rapportage intern is goedgekeurd. */
export const APPROVED_QUARTER_STATUSES: QuarterStatus[] = ["goedgekeurd", "gepubliceerd"];

/**
 * Of een rapportage goedgekeurd mag worden. Nooit met voorlopige cijfers en
 * alleen vanuit de controle. Geeft de reden terug als het niet kan.
 */
export function approveBlocker(r: { status: QuarterStatus; voorlopig: boolean; hasAnalysis: boolean; bezig: boolean }): string | null {
  if (r.bezig) return "De rapportage wordt nog gegenereerd.";
  if (!r.hasAnalysis) return "Er is nog geen rapportage gegenereerd.";
  if (r.voorlopig) return "Dit is een voorlopig concept. Goedkeuren kan pas met de definitieve cijfers van het volledige kwartaal.";
  if (r.status !== "klaar_voor_controle" && r.status !== "aanpassingen_nodig") return "Goedkeuren kan alleen vanuit de interne controle.";
  return null;
}

/* ------------------------------------------------------------------ *
 * Planning (automatische workflow)
 * ------------------------------------------------------------------ */

export type QuarterSchedule = {
  /** Dag 1 van de derde maand: taak aanmaken voor de verantwoordelijke. */
  voorbereiden: string;
  /** Rond het midden van de derde maand: voorlopig concept genereren. */
  concept: string;
  /** Start van de laatste week: controle op ontbrekende gegevens. */
  laatsteWeek: string;
  /** Eerste dag na het kwartaal: de volledige cijfers ophalen. */
  naAfloop: string;
  /** Uiterlijk vijf werkdagen na afloop: klaar voor interne controle. */
  controleDeadline: string;
  /** Uiterlijk zeven werkdagen na afloop: gepubliceerd in het klantportaal. */
  publicatieDeadline: string;
};

export function quarterSchedule(q: Pick<Quarter, "segments" | "to">, holidays?: Holidays): QuarterSchedule {
  const derde = q.segments[2];
  return {
    voorbereiden: derde.from,
    concept: addDays(derde.from, Math.floor((daysInRange(derde.from, derde.to) - 1) / 2)),
    laatsteWeek: addDays(q.to, -6),
    naAfloop: addDays(q.to, 1),
    controleDeadline: addWorkingDays(q.to, 5, holidays),
    publicatieDeadline: addWorkingDays(q.to, 7, holidays),
  };
}

export type QuarterPhase = "lopend" | "voorbereiding" | "concept" | "laatste_week" | "na_afloop";

/** In welke fase van de planning het kwartaal vandaag zit. */
export function quarterPhase(q: Pick<Quarter, "segments" | "to">, today: string): QuarterPhase {
  const s = quarterSchedule(q);
  if (today >= s.naAfloop) return "na_afloop";
  if (today >= s.laatsteWeek) return "laatste_week";
  if (today >= s.concept) return "concept";
  if (today >= s.voorbereiden) return "voorbereiding";
  return "lopend";
}

/**
 * De eerstvolgende deadline van een rapportage en of die verstreken is.
 * Gepubliceerde rapportages hebben geen deadline meer.
 */
export function nextDeadline(
  r: { status: QuarterStatus },
  q: Pick<Quarter, "segments" | "to">,
  today: string,
  holidays?: Holidays,
): { datum: string; label: string; teLaat: boolean } | null {
  const s = quarterSchedule(q, holidays);
  const mk = (datum: string, label: string) => ({ datum, label, teLaat: today > datum });
  switch (r.status) {
    case "gepland": return mk(s.voorbereiden, "Voorbereiding start");
    case "in_voorbereiding": return mk(s.concept, "Voorlopig concept");
    case "concept_gegenereerd": return mk(s.controleDeadline, "Definitieve cijfers en controle");
    case "wachten_op_data":
    case "klaar_voor_controle":
    case "aanpassingen_nodig": return mk(s.controleDeadline, "Interne controle afgerond");
    case "goedgekeurd": return mk(s.publicatieDeadline, "Publiceren naar klantportaal");
    default: return null;
  }
}

/** Achterstand: een deadline is verstreken terwijl de rapportage nog niet gepubliceerd is. */
export function isAchterstallig(r: { status: QuarterStatus }, q: Pick<Quarter, "segments" | "to">, today: string, holidays?: Holidays): boolean {
  if (r.status === "gepubliceerd") return false;
  if (today <= q.to) return false;
  const s = quarterSchedule(q, holidays);
  return r.status === "goedgekeurd" ? today > s.publicatieDeadline : today > s.controleDeadline;
}

/* ------------------------------------------------------------------ *
 * Taken per processtap
 * ------------------------------------------------------------------ */

/** Sleutel van een stap-taak: `kwartaalrapport:<clientId>:<periodKey>:<stap>`. Eén per klant, kwartaal en stap. */
export const QUARTER_TASK_PREFIX = "kwartaalrapport:";
export type QuarterStap = "voorbereiden" | "controleren" | "goedkeuren" | "publiceren";
export const QUARTER_STAPPEN: QuarterStap[] = ["voorbereiden", "controleren", "goedkeuren", "publiceren"];

export const quarterTaskKey = (clientId: string, periodKey: string, stap: QuarterStap) => `${QUARTER_TASK_PREFIX}${clientId}:${periodKey}:${stap}`;

export function parseQuarterTaskKey(key: string | null | undefined): { clientId: string; periodKey: string; stap: QuarterStap } | null {
  if (!key?.startsWith(QUARTER_TASK_PREFIX)) return null;
  const rest = key.slice(QUARTER_TASK_PREFIX.length);
  const first = rest.indexOf(":");
  const last = rest.lastIndexOf(":");
  if (first < 0 || last <= first) return null;
  const clientId = rest.slice(0, first);
  const periodKey = rest.slice(first + 1, last);
  const stap = rest.slice(last + 1) as QuarterStap;
  if (!clientId || !isQuarterKey(periodKey) || !QUARTER_STAPPEN.includes(stap)) return null;
  return { clientId, periodKey, stap };
}

export function quarterTaskTitle(label: string, stap: QuarterStap, ookGoedkeuren = false): string {
  const wat = stap === "voorbereiden"
    ? "Voorbereiden en ontbrekende gegevens aanvullen"
    : stap === "controleren"
      ? (ookGoedkeuren ? "Interne en klantversie controleren en goedkeuren" : "Interne en klantversie controleren")
      : stap === "goedkeuren"
        ? "Controleren en goedkeuren"
        : "Klantversie publiceren naar klantportaal";
  return `Kwartaalrapportage ${label} • ${wat}`;
}

type Wens = { open: boolean; afgerond: boolean; assignee: string | null; status: string; due: string };

/**
 * Welke taken bij een rapportage horen, gegeven de status. Puur, zodat de regels
 * los te testen zijn. `controller` = de verantwoordelijke van de klant,
 * `approver` = wie goedkeurt. Is dat dezelfde persoon, dan is controleren en
 * goedkeuren één taak.
 */
export function gewensteKwartaalTaken(
  r: { status: QuarterStatus; controller: string | null; gecontroleerd: boolean },
  q: Pick<Quarter, "segments" | "to">,
  approver: string | null,
  holidays?: Holidays,
): Partial<Record<QuarterStap, Wens>> {
  const s = quarterSchedule(q, holidays);
  const eigen = Boolean(r.controller && approver && r.controller === approver);
  const out: Partial<Record<QuarterStap, Wens>> = {};
  const off = (assignee: string | null, due: string): Wens => ({ open: false, afgerond: false, assignee, status: "", due });
  const done = (assignee: string | null, due: string): Wens => ({ open: false, afgerond: true, assignee, status: "", due });
  const open = (assignee: string | null, due: string, status: string): Wens => ({ open: true, afgerond: false, assignee, status, due });

  switch (r.status) {
    case "gepland":
      break;
    case "in_voorbereiding":
      out.voorbereiden = open(r.controller, q.to, "Kwartaal loopt af · concept volgt halverwege de maand");
      break;
    case "concept_gegenereerd":
      out.voorbereiden = open(r.controller, q.to, "Voorlopig concept staat klaar · loop de ontbrekende gegevens na");
      break;
    case "wachten_op_data":
      out.voorbereiden = open(r.controller, s.controleDeadline, "Wacht op volledige cijfers · zie wat er ontbreekt");
      break;
    case "klaar_voor_controle":
    case "aanpassingen_nodig":
      out.voorbereiden = done(r.controller, q.to);
      if (r.status === "klaar_voor_controle" && r.gecontroleerd && !eigen) {
        // De verantwoordelijke is klaar: de bal ligt bij wie goedkeurt.
        out.controleren = done(r.controller, s.controleDeadline);
        out.goedkeuren = open(approver, s.controleDeadline, "Gecontroleerd · wacht op goedkeuring");
      } else {
        out.controleren = open(r.controller, s.controleDeadline, r.status === "aanpassingen_nodig" ? "Aanpassingen gevraagd" : "Definitieve rapportage wacht op controle");
        if (!eigen) out.goedkeuren = off(approver, s.controleDeadline);
      }
      out.publiceren = off(r.controller, s.publicatieDeadline);
      break;
    case "goedgekeurd":
      out.voorbereiden = done(r.controller, q.to);
      out.controleren = done(r.controller, s.controleDeadline);
      if (!eigen) out.goedkeuren = done(approver, s.controleDeadline);
      out.publiceren = open(r.controller, s.publicatieDeadline, "Goedgekeurd · klantversie nog publiceren");
      break;
    case "gepubliceerd":
      out.voorbereiden = done(r.controller, q.to);
      out.controleren = done(r.controller, s.controleDeadline);
      if (!eigen) out.goedkeuren = done(approver, s.controleDeadline);
      out.publiceren = done(r.controller, s.publicatieDeadline);
      break;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Pakket (soort samenwerking)
 * ------------------------------------------------------------------ */

export type PakketType = "organisch" | "advertentie" | "beide" | "onbekend";

export const PAKKET_LABEL: Record<PakketType, string> = {
  organisch: "Organische content",
  advertentie: "Advertentiecontent",
  beide: "Organisch en advertenties",
  onbekend: "Niet ingesteld",
};

export function pakketTypeOf(contentFocus: string | null | undefined): PakketType {
  const v = (contentFocus ?? "").trim().toLowerCase();
  if (v === "organisch") return "organisch";
  if (v === "advertentie" || v === "advertenties" || v === "ads") return "advertentie";
  if (v === "beide" || v === "combinatie") return "beide";
  return "onbekend";
}

/* ------------------------------------------------------------------ *
 * Vergelijking met het vorige kwartaal
 * ------------------------------------------------------------------ */

export function pctChange(cur: number, was: number | null | undefined): number | null {
  if (was === null || was === undefined || was <= 0) return null;
  return Math.round(((cur - was) / was) * 1000) / 10;
}

export type Vergelijkbaarheid = { vergelijkbaar: boolean; redenen: string[] };

/**
 * Of twee kwartalen eerlijk te vergelijken zijn: beide moeten vrijwel volledig
 * gemeten zijn en op dezelfde kanalen. Zo niet, dan geen groeipercentages.
 */
export function vergelijkbaarheid(
  cur: { dagen: number; meetdagen: number; platforms: string[] },
  prev: { dagen: number; meetdagen: number; platforms: string[] } | null,
): Vergelijkbaarheid {
  if (!prev) return { vergelijkbaar: false, redenen: ["Er is geen eerder kwartaal om mee te vergelijken."] };
  const redenen: string[] = [];
  if (prev.meetdagen === 0) redenen.push("In het vorige kwartaal zijn geen cijfers gemeten.");
  else if (prev.meetdagen < prev.dagen * 0.8) redenen.push(`Het vorige kwartaal is maar voor ${prev.meetdagen} van de ${prev.dagen} dagen gemeten.`);
  if (cur.meetdagen < cur.dagen * 0.8) redenen.push(`Dit kwartaal is maar voor ${cur.meetdagen} van de ${cur.dagen} dagen gemeten.`);
  const a = [...cur.platforms].sort().join(",");
  const b = [...prev.platforms].sort().join(",");
  if (prev.meetdagen > 0 && a !== b) redenen.push("De gemeten kanalen verschillen tussen de twee kwartalen.");
  return { vergelijkbaar: redenen.length === 0, redenen };
}

/* ------------------------------------------------------------------ *
 * Kwartaalgezondheid (intern, met zichtbare criteria)
 * ------------------------------------------------------------------ */

export type HealthLevel = "goed" | "aandacht" | "zorg" | "onbekend";
export type HealthCriterium = { key: string; label: string; niveau: HealthLevel; toelichting: string };

export type HealthInput = {
  /** Groei van weergaven t.o.v. vorig kwartaal (null = niet vergelijkbaar). */
  viewsPct: number | null;
  /** Doelen: aantal vastgelegd en behaald (0 vastgelegd = onbekend). */
  doelen: { totaal: number; behaald: number };
  /** Aandeel van het kwartaal met cijfers (0-1). */
  dekking: number;
  ontbrekend: number;
  /** Gepubliceerde video's t.o.v. de afspraak (null = geen afspraak bekend). */
  afspraak: { verwacht: number; gepubliceerd: number } | null;
  /** Verbeterpunten uit het vorige kwartaal: totaal en uitgevoerd (null = geen vorige rapportage). */
  verbeteringen: { totaal: number; uitgevoerd: number } | null;
  /** Geregistreerde klantfeedback in het kwartaal (null = niets geregistreerd). */
  feedback: { signalen: number; ernstig: number } | null;
};

/**
 * Beoordeling per criterium, elk met de onderbouwing erbij. Bewust geen
 * opgetelde score: het team ziet per onderdeel waarom het goed gaat of niet.
 */
export function quarterHealth(i: HealthInput): HealthCriterium[] {
  const out: HealthCriterium[] = [];
  out.push(i.viewsPct === null
    ? { key: "resultaten", label: "Resultaten", niveau: "onbekend", toelichting: "Geen eerlijke vergelijking met het vorige kwartaal mogelijk." }
    : { key: "resultaten", label: "Resultaten", niveau: i.viewsPct >= 0 ? "goed" : i.viewsPct > -20 ? "aandacht" : "zorg", toelichting: `Weergaven ${i.viewsPct > 0 ? "+" : ""}${i.viewsPct.toLocaleString("nl-NL")}% ten opzichte van het vorige kwartaal.` });
  out.push(i.doelen.totaal === 0
    ? { key: "doelen", label: "Doelrealisatie", niveau: "onbekend", toelichting: "Er zijn voor dit kwartaal geen doelen vastgelegd." }
    : { key: "doelen", label: "Doelrealisatie", niveau: i.doelen.behaald === i.doelen.totaal ? "goed" : i.doelen.behaald > 0 ? "aandacht" : "zorg", toelichting: `${i.doelen.behaald} van de ${i.doelen.totaal} doelen behaald.` });
  out.push({
    key: "data", label: "Betrouwbaarheid van de data",
    niveau: i.dekking >= 0.95 && i.ontbrekend === 0 ? "goed" : i.dekking >= 0.8 ? "aandacht" : "zorg",
    toelichting: `${Math.round(i.dekking * 100)}% van het kwartaal is gemeten${i.ontbrekend ? `, ${i.ontbrekend} ${i.ontbrekend === 1 ? "gegeven ontbreekt" : "gegevens ontbreken"}` : ""}.`,
  });
  out.push(!i.afspraak || i.afspraak.verwacht <= 0
    ? { key: "pakket", label: "Voortgang van het pakket", niveau: "onbekend", toelichting: "Er is geen afgesproken aantal video's per maand vastgelegd." }
    : { key: "pakket", label: "Voortgang van het pakket", niveau: i.afspraak.gepubliceerd >= i.afspraak.verwacht ? "goed" : i.afspraak.gepubliceerd >= i.afspraak.verwacht * 0.8 ? "aandacht" : "zorg", toelichting: `${i.afspraak.gepubliceerd} video's gepubliceerd, ${i.afspraak.verwacht} afgesproken voor dit kwartaal.` });
  out.push(!i.verbeteringen
    ? { key: "verbeteringen", label: "Uitgevoerde verbeteringen", niveau: "onbekend", toelichting: "Er is geen vorige kwartaalrapportage met verbeterpunten." }
    : i.verbeteringen.totaal === 0
      ? { key: "verbeteringen", label: "Uitgevoerde verbeteringen", niveau: "onbekend", toelichting: "De vorige rapportage had geen verbeterpunten." }
      : { key: "verbeteringen", label: "Uitgevoerde verbeteringen", niveau: i.verbeteringen.uitgevoerd === i.verbeteringen.totaal ? "goed" : i.verbeteringen.uitgevoerd > 0 ? "aandacht" : "zorg", toelichting: `${i.verbeteringen.uitgevoerd} van de ${i.verbeteringen.totaal} verbeterpunten uit het vorige kwartaal uitgevoerd.` });
  out.push(!i.feedback
    ? { key: "feedback", label: "Klantfeedback", niveau: "onbekend", toelichting: "Er is dit kwartaal geen klantfeedback geregistreerd." }
    : { key: "feedback", label: "Klantfeedback", niveau: i.feedback.ernstig > 0 ? "zorg" : i.feedback.signalen > 0 ? "aandacht" : "goed", toelichting: i.feedback.signalen === 0 ? "Alleen kleine correcties geregistreerd, geen aandachtspunten." : `${i.feedback.signalen} ${i.feedback.signalen === 1 ? "aandachtspunt" : "aandachtspunten"} uit klantfeedback geregistreerd${i.feedback.ernstig ? `, waarvan ${i.feedback.ernstig} ernstig` : ""}.` });
  return out;
}
