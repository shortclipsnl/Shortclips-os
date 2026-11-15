/**
 * Inhoud van een kwartaalrapportage (klantversie en interne verdieping) en de
 * controles daarop. Puur (zonder database of AI), zodat het normaliseren van
 * het AI-antwoord, de cijfercontrole en de controlepunten los te testen zijn.
 */

export type Zekerheid = "bewezen" | "waarschijnlijk" | "hypothese";
export type Inzicht = { punt: string; onderbouwing: string; zekerheid: Zekerheid };

export type QuarterKlant = {
  /** Directieoverzicht: in twee minuten te lezen. */
  directie: { bereikt: string; opgeleverd: string; geleerd: string; volgend: string };
  /** A. Managementsamenvatting. */
  samenvatting: {
    kern: string;
    resultaten: string[];
    positief: string;
    inzichten: string[];
    tegenvallers: Array<{ wat: string; oorzaak: string; zekerheid: Zekerheid }>;
    verbeterd: string[];
    kans: string;
    advies: string;
  };
  /** C. Wat heeft Shortclips opgeleverd (de aantallen komen uit de cijfers). */
  opgeleverd: { tekst: string; diensten: string[] };
  /** D. Opvallende trends, met verklaring. */
  trends: Array<{ titel: string; beschrijving: string; verklaring: string; zekerheid: Zekerheid }>;
  /** E. Best presterende content: sleutel uit de cijfers plus duiding. */
  topVideos: Array<{ key: string; waarom: string; meenemen: string; zekerheid: Zekerheid }>;
  /** F. Wat hebben we geleerd. */
  geleerd: {
    onderwerpen: Inzicht[]; hooks: Inzicht[]; formats: Inzicht[]; lengtes: Inzicht[]; presentatoren: Inzicht[]; doelgroep: Inzicht[];
    vaker: string[]; minder: string[];
  };
  /** G. Zakelijke impact. */
  impact: { direct: string[]; indirect: string[]; kwalitatief: string[]; nietMeetbaar: string };
  /** H. Verbeterpunten (maximaal vijf). */
  verbeterpunten: Array<{ constatering: string; belang: string; actie: string; verwachtResultaat: string; verantwoordelijke: string }>;
  /** I. Plan voor het volgende kwartaal. */
  plan: { binnenPakket: Array<{ titel: string; toelichting: string }>; aanvullend: Array<{ titel: string; toelichting: string }> };
  /** J. Conclusie en vervolg. */
  conclusie: { kern: string; bereikt: string; kansen: string; verbeteringen: string; prioriteiten: string[] };
};

export type QuarterIntern = {
  kern: string;
  risicos: Array<{ titel: string; toelichting: string }>;
  kritisch: string[];
  /** Adviezen voor het klantgesprek. */
  gesprek: string[];
  /** Commerciële kansen (nooit in de klantversie). */
  commercieel: Array<{ kans: string; onderbouwing: string }>;
  acties: Array<{ actie: string; rol: string; waarom: string }>;
  /** Oordeel over de opvolging van de verbeterpunten uit het vorige kwartaal. */
  opvolging: string;
  /** Interne toelichting van de controleur. */
  toelichting?: string;
  /** Bevestigde controlepunten (ids). */
  akkoord?: string[];
};

const str = (v: unknown, max = 600) => String(v ?? "").trim().slice(0, max);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown, max: number, len = 400) => arr(v).map((x) => str(x, len)).filter(Boolean).slice(0, max);
const zek = (v: unknown): Zekerheid => {
  const s = str(v, 20).toLowerCase();
  return s === "bewezen" || s === "waarschijnlijk" ? s : "hypothese";
};
const inzichten = (v: unknown, max = 4): Inzicht[] =>
  arr(v).map((x) => ({ punt: str(obj(x).punt, 240), onderbouwing: str(obj(x).onderbouwing, 300), zekerheid: zek(obj(x).zekerheid) })).filter((x) => x.punt).slice(0, max);
const paren = (v: unknown, max: number) =>
  arr(v).map((x) => ({ titel: str(obj(x).titel, 160), toelichting: str(obj(x).toelichting, 400) })).filter((x) => x.titel).slice(0, max);

export const EMPTY_KLANT: QuarterKlant = {
  directie: { bereikt: "", opgeleverd: "", geleerd: "", volgend: "" },
  samenvatting: { kern: "", resultaten: [], positief: "", inzichten: [], tegenvallers: [], verbeterd: [], kans: "", advies: "" },
  opgeleverd: { tekst: "", diensten: [] },
  trends: [], topVideos: [],
  geleerd: { onderwerpen: [], hooks: [], formats: [], lengtes: [], presentatoren: [], doelgroep: [], vaker: [], minder: [] },
  impact: { direct: [], indirect: [], kwalitatief: [], nietMeetbaar: "" },
  verbeterpunten: [],
  plan: { binnenPakket: [], aanvullend: [] },
  conclusie: { kern: "", bereikt: "", kansen: "", verbeteringen: "", prioriteiten: [] },
};

export const EMPTY_INTERN: QuarterIntern = { kern: "", risicos: [], kritisch: [], gesprek: [], commercieel: [], acties: [], opvolging: "" };

/** Maakt van een (mogelijk onvolledig) AI-antwoord of opgeslagen inhoud altijd een volledige klantversie. */
export function normalizeKlant(v: unknown): QuarterKlant {
  const o = obj(v);
  const d = obj(o.directie); const s = obj(o.samenvatting); const g = obj(o.geleerd); const i = obj(o.impact); const p = obj(o.plan); const c = obj(o.conclusie); const op = obj(o.opgeleverd);
  return {
    directie: { bereikt: str(d.bereikt), opgeleverd: str(d.opgeleverd), geleerd: str(d.geleerd), volgend: str(d.volgend) },
    samenvatting: {
      kern: str(s.kern, 900), resultaten: strs(s.resultaten, 5), positief: str(s.positief), inzichten: strs(s.inzichten, 4),
      tegenvallers: arr(s.tegenvallers).map((x) => ({ wat: str(obj(x).wat, 300), oorzaak: str(obj(x).oorzaak, 300), zekerheid: zek(obj(x).zekerheid) })).filter((x) => x.wat).slice(0, 3),
      verbeterd: strs(s.verbeterd, 4), kans: str(s.kans), advies: str(s.advies),
    },
    opgeleverd: { tekst: str(op.tekst, 900), diensten: strs(op.diensten, 8, 120) },
    trends: arr(o.trends).map((x) => ({ titel: str(obj(x).titel, 160), beschrijving: str(obj(x).beschrijving, 400), verklaring: str(obj(x).verklaring, 400), zekerheid: zek(obj(x).zekerheid) })).filter((x) => x.titel).slice(0, 5),
    topVideos: arr(o.topVideos).map((x) => ({ key: str(obj(x).key, 8), waarom: str(obj(x).waarom, 400), meenemen: str(obj(x).meenemen, 400), zekerheid: zek(obj(x).zekerheid) })).filter((x) => /^v\d+$/.test(x.key)).slice(0, 5),
    geleerd: {
      onderwerpen: inzichten(g.onderwerpen), hooks: inzichten(g.hooks), formats: inzichten(g.formats), lengtes: inzichten(g.lengtes),
      presentatoren: inzichten(g.presentatoren), doelgroep: inzichten(g.doelgroep), vaker: strs(g.vaker, 5, 240), minder: strs(g.minder, 5, 240),
    },
    impact: { direct: strs(i.direct, 5), indirect: strs(i.indirect, 5), kwalitatief: strs(i.kwalitatief, 5), nietMeetbaar: str(i.nietMeetbaar) },
    verbeterpunten: arr(o.verbeterpunten).map((x) => ({
      constatering: str(obj(x).constatering, 300), belang: str(obj(x).belang, 300), actie: str(obj(x).actie, 300),
      verwachtResultaat: str(obj(x).verwachtResultaat, 300), verantwoordelijke: str(obj(x).verantwoordelijke, 80),
    })).filter((x) => x.constatering && x.actie).slice(0, 5),
    plan: { binnenPakket: paren(p.binnenPakket, 7), aanvullend: paren(p.aanvullend, 3) },
    conclusie: { kern: str(c.kern, 900), bereikt: str(c.bereikt), kansen: str(c.kansen), verbeteringen: str(c.verbeteringen), prioriteiten: strs(c.prioriteiten, 5, 240) },
  };
}

export function normalizeIntern(v: unknown): QuarterIntern {
  const o = obj(v);
  return {
    kern: str(o.kern, 900),
    risicos: paren(o.risicos, 5),
    kritisch: strs(o.kritisch, 6),
    gesprek: strs(o.gesprek, 6),
    commercieel: arr(o.commercieel).map((x) => ({ kans: str(obj(x).kans, 240), onderbouwing: str(obj(x).onderbouwing, 400) })).filter((x) => x.kans).slice(0, 4),
    acties: arr(o.acties).map((x) => ({ actie: str(obj(x).actie, 300), rol: str(obj(x).rol, 40) || "pm", waarom: str(obj(x).waarom, 300) })).filter((x) => x.actie).slice(0, 8),
    opvolging: str(o.opvolging, 900),
    toelichting: str(o.toelichting, 4000) || undefined,
    akkoord: arr(o.akkoord).map((x) => str(x, 80)).filter(Boolean),
  };
}

export function hasKlantInhoud(k: QuarterKlant | null | undefined): boolean {
  return Boolean(k && (k.samenvatting.kern || k.conclusie.kern || k.verbeterpunten.length));
}

/* ------------------------------------------------------------------ *
 * Cijfercontrole: elk getal in de tekst moet herleidbaar zijn
 * ------------------------------------------------------------------ */

function collectNumbers(v: unknown, out: Set<number>): void {
  if (typeof v === "number" && Number.isFinite(v)) { out.add(Math.abs(v)); return; }
  if (typeof v === "string") { for (const m of v.matchAll(/\d[\d.]*(?:,\d+)?/g)) { const x = parseNl(m[0]); if (x !== null) out.add(x); } return; }
  if (Array.isArray(v)) { for (const x of v) collectNumbers(x, out); return; }
  if (v && typeof v === "object") for (const x of Object.values(v)) collectNumbers(x, out);
}

function parseNl(raw: string): number | null {
  const s = raw.replace(/\.$/, "");
  // Nederlands: punt als duizendtal, komma als decimaal.
  const clean = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
  const x = Number(clean);
  return Number.isFinite(x) ? x : null;
}

/** Alle teksten uit een object (recursief). */
function texts(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => texts(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => texts(x, out));
}

/**
 * Getallen in de rapportteksten die niet in de berekende cijfers voorkomen.
 * Kleine getallen (aantallen, rangnummers), jaartallen en afrondingen van een
 * bekend cijfer zijn toegestaan. Wat overblijft moet een mens controleren
 * voordat de rapportage goedgekeurd kan worden.
 */
export function unverifiedNumbers(content: unknown, metrics: unknown): string[] {
  const known = new Set<number>();
  collectNumbers(metrics, known);
  const knownList = [...known];
  const isKnown = (x: number): boolean => {
    if (known.has(x)) return true;
    // Afronding van een bekend cijfer (op 1 decimaal, heel getal, tiental, honderdtal of duizendtal).
    return knownList.some((k) => {
      if (k === 0) return false;
      if (Math.round(k * 10) / 10 === x || Math.round(k) === x) return true;
      if (k >= 100 && (Math.round(k / 10) * 10 === x || Math.round(k / 100) * 100 === x)) return true;
      if (k >= 1000 && Math.round(k / 1000) * 1000 === x) return true;
      return false;
    });
  };
  const all: string[] = [];
  texts(content, all);
  const out = new Set<string>();
  for (const t of all) {
    for (const m of t.matchAll(/(?<![\w-])\d[\d.]*(?:,\d+)?(?:\s?%)?/g)) {
      const raw = m[0].replace(/\.$/, "");
      const isPct = raw.includes("%");
      const x = parseNl(raw.replace(/\s?%/, ""));
      if (x === null) continue;
      if (!isPct && x < 100) continue; // aantallen, top 5, 3 maanden, seconden
      if (!isPct && x >= 1990 && x <= 2100 && Number.isInteger(x)) continue; // jaartal
      if (isPct && x === 100) continue;
      if (!isKnown(x)) out.add(raw.trim());
    }
  }
  return [...out].slice(0, 12);
}

/* ------------------------------------------------------------------ *
 * Controlepunten (blokkeren goedkeuren tot ze zijn opgelost of bevestigd)
 * ------------------------------------------------------------------ */

export type QuarterCheck = { id: string; severity: "blok" | "let_op"; label: string; bevestigbaar: boolean };

export function quarterChecks(input: {
  klant: QuarterKlant;
  intern: QuarterIntern;
  metrics: unknown;
  conversiesGemeten: boolean;
  ontbrekend: string[];
  dataCompleet: boolean;
  dataOverride: boolean;
  openFeedback: number;
}): QuarterCheck[] {
  const out: QuarterCheck[] = [];
  const akkoord = new Set(input.intern.akkoord ?? []);
  const add = (c: QuarterCheck) => { if (!(c.bevestigbaar && akkoord.has(c.id))) out.push(c); };
  if (!hasKlantInhoud(input.klant)) add({ id: "inhoud", severity: "blok", label: "De managementsamenvatting of conclusie ontbreekt. Genereer de rapportage opnieuw.", bevestigbaar: false });
  if (!input.dataCompleet && !input.dataOverride) add({ id: "data", severity: "blok", label: "Nog niet alle cijfers van het kwartaal zijn binnen. Wacht op de volledige data of rond bewust af met onvolledige data.", bevestigbaar: false });
  if (input.openFeedback > 0) add({ id: "feedback", severity: "blok", label: `Er ${input.openFeedback === 1 ? "staat 1 opmerking" : `staan ${input.openFeedback} opmerkingen`} open. Verwerk ze of genereer opnieuw.`, bevestigbaar: false });
  for (const nr of unverifiedNumbers(input.klant, input.metrics)) {
    add({ id: `cijfer:${nr}`, severity: "blok", label: `Het cijfer "${nr}" in de klanttekst komt niet voor in de berekende resultaten. Pas de tekst aan of bevestig dat het klopt.`, bevestigbaar: true });
  }
  if (!input.conversiesGemeten && input.klant.impact.direct.length > 0) {
    add({ id: "impact", severity: "blok", label: "Er is geen conversiemeting, maar de rapportage noemt direct meetbare zakelijke resultaten. Verwijder ze of bevestig de bron.", bevestigbaar: true });
  }
  if (input.ontbrekend.length > 0) add({ id: "ontbrekend", severity: "let_op", label: `${input.ontbrekend.length} ${input.ontbrekend.length === 1 ? "gegeven ontbreekt" : "gegevens ontbreken"}. Controleer of de klantversie daar eerlijk over is.`, bevestigbaar: true });
  if (input.klant.verbeterpunten.length === 0) add({ id: "verbeterpunten", severity: "let_op", label: "Er zijn geen verbeterpunten geformuleerd.", bevestigbaar: true });
  return out;
}

export const blockingChecks = (checks: QuarterCheck[]) => checks.filter((c) => c.severity === "blok");
