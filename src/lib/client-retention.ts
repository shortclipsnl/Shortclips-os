/**
 * Klantbehoud: de regels achter de automatische signalering van teruglopende
 * resultaten, klantfeedback en contractmomenten, en de klantgezondheid die
 * daaruit volgt. Alles hier is puur (geen database), zodat elke regel los te
 * testen is en overal precies hetzelfde werkt (Aandachtspunten, Klanten,
 * klantpagina, nachtelijke taken).
 *
 * Uitgangspunten:
 *  - Liever geen signaal dan een onbetrouwbaar signaal. Bij te weinig data wordt
 *    er niet gewaarschuwd, maar wel zichtbaar gemaakt dát de data ontbreekt.
 *  - Eén losse slechte video is nooit genoeg: we vergelijken de mediaan per video
 *    (ongevoelig voor uitschieters) en eisen een minimum aantal video's.
 *  - Tevredenheidsrisico en commerciële opvolging blijven gescheiden. Een
 *    naderend contractmoment maakt een klant niet "ontevreden".
 *  - Contractgegevens die niet gecontroleerd zijn, gelden als onzeker. We gaan
 *    nooit stilzwijgend uit van een automatische verlenging.
 */

/* ------------------------------------------------------------------ *
 * Instellingen
 * ------------------------------------------------------------------ */

export const RETENTION_DEFAULTS = {
  /** Daling (in %) vanaf waar een resultaat als significant geldt. Configureerbaar. */
  dropPct: 25,
  /** Vergelijkingsvenster in dagen (laatste N vs. de N daarvoor). */
  windowDays: 30,
  /** Minimaal aantal meetdagen per venster per platform. */
  minMeasuredDays: 20,
  /** Minimaal aantal gepubliceerde video's per venster. */
  minVideos: 3,
  /** Minimaal aantal weergaven in de vorige periode (anders zijn procenten ruis). */
  minPrevViews: 1000,
  /** Na zoveel dagen zonder nieuwe meting geldt de data als verouderd. */
  staleDays: 5,
  /** Een video is "opvallend slecht" onder dit aandeel van de mediaan (en ≥ 7 dagen oud). */
  weakVideoShare: 0.25,
  /** Contractsignalen: zoveel dagen vóór het beslismoment. */
  contractStages: [60, 30, 14] as const,
} as const;

export type RetentionSettings = { dropPct: number };

/* ------------------------------------------------------------------ *
 * Resultaten
 * ------------------------------------------------------------------ */

export type DailyRow = {
  platform: string;
  measuredOn: string; // YYYY-MM-DD
  views: number;
  reach: number;
  engagements: number;
  followerDelta: number;
};

export type VideoRow = {
  platform: string;
  publishedOn: string; // YYYY-MM-DD
  views: number | null; // laatst gemeten weergaven, null = nog geen meting
  title: string;
  href?: string;
};

export type MetricChange = {
  key: "bereik" | "weergaven" | "engagement" | "volgers";
  label: string;
  cur: number;
  prev: number;
  /** Verandering in procenten (negatief = daling). */
  pct: number;
};

export type PlatformResult = {
  platform: string;
  state: "ok" | "daling" | "onvoldoende_data";
  /** Waarom er (nog) geen oordeel is, bij onvoldoende data. */
  note?: string;
  changes: MetricChange[];
  /** De metrics die de grens overschrijden. */
  declined: MetricChange[];
  videosCur: number;
  videosPrev: number;
};

export type ResultsVerdict = {
  /** geen_koppeling = er komt voor deze klant geen resultatendata binnen. */
  state: "ok" | "daling" | "onvoldoende_data" | "verouderd" | "geen_koppeling";
  platforms: PlatformResult[];
  lastMeasured: string | null;
  /** Perioden waartegen vergeleken is, voor in de melding. */
  period: { curFrom: string; curTo: string; prevFrom: string; prevTo: string };
  weakVideos: VideoRow[];
  /** Korte, leesbare samenvatting voor de melding. */
  summary: string;
};

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook", linkedin: "LinkedIn",
};
export const platformLabel = (p: string) => PLATFORM_LABEL[p] ?? p;

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0);

/**
 * Beoordeelt de resultaten van één klant: laatste `windowDays` tegenover de
 * periode daarvoor, per platform. Een daling telt alleen als:
 *  - er per venster genoeg meetdagen en video's zijn;
 *  - de vorige periode genoeg weergaven had om procenten betekenis te geven;
 *  - het gemiddelde bereik per video óf de mediaan-weergaven per video minstens
 *    `dropPct` daalt. De mediaan maakt het ongevoelig voor één uitschieter.
 * Engagement en volgersgroei worden meegemeld als ze óók dalen, maar zijn
 * alleen geen reden voor een signaal (te gevoelig bij kleine aantallen).
 */
export function evaluateResults(input: {
  today: string;
  daily: DailyRow[];
  videos: VideoRow[];
  hasIntegration: boolean;
  settings?: Partial<RetentionSettings>;
}): ResultsVerdict {
  const cfg = { ...RETENTION_DEFAULTS, ...(input.settings ?? {}) };
  const W = cfg.windowDays;
  const curFrom = addDays(input.today, -W);
  const prevFrom = addDays(input.today, -2 * W);
  const period = { curFrom, curTo: addDays(input.today, -1), prevFrom, prevTo: addDays(curFrom, -1) };

  const lastMeasured = input.daily.reduce<string | null>((m, r) => (!m || r.measuredOn > m ? r.measuredOn : m), null);

  const base = { platforms: [] as PlatformResult[], lastMeasured, period, weakVideos: [] as VideoRow[] };
  if (!input.hasIntegration && !input.daily.length) {
    return { ...base, state: "geen_koppeling", summary: "Er komen voor deze klant geen resultaten binnen via een koppeling." };
  }
  if (!lastMeasured || dayDiff(input.today, lastMeasured) > cfg.staleDays) {
    const ago = lastMeasured ? dayDiff(input.today, lastMeasured) : null;
    return {
      ...base, state: "verouderd",
      summary: ago === null ? "De resultatenkoppeling heeft nog geen gegevens geleverd." : `Laatste resultaten zijn ${ago} dagen oud; de koppeling levert geen nieuwe gegevens.`,
    };
  }

  const inCur = (d: string) => d >= curFrom && d < input.today;
  const inPrev = (d: string) => d >= prevFrom && d < curFrom;
  const platforms = [...new Set([...input.daily.map((r) => r.platform), ...input.videos.map((v) => v.platform)])].sort();

  const results: PlatformResult[] = [];
  for (const p of platforms) {
    const rows = input.daily.filter((r) => r.platform === p);
    const cur = rows.filter((r) => inCur(r.measuredOn));
    const prev = rows.filter((r) => inPrev(r.measuredOn));
    const vids = input.videos.filter((v) => v.platform === p);
    const vCur = vids.filter((v) => inCur(v.publishedOn));
    const vPrev = vids.filter((v) => inPrev(v.publishedOn));
    const sum = (list: DailyRow[], k: keyof DailyRow) => list.reduce((s, r) => s + Number(r[k] ?? 0), 0);

    const viewsCur = sum(cur, "views"), viewsPrev = sum(prev, "views");
    const reachCur = sum(cur, "reach"), reachPrev = sum(prev, "reach");
    const engCur = sum(cur, "engagements"), engPrev = sum(prev, "engagements");
    const folCur = sum(cur, "followerDelta"), folPrev = sum(prev, "followerDelta");

    const out: PlatformResult = { platform: p, state: "ok", changes: [], declined: [], videosCur: vCur.length, videosPrev: vPrev.length };

    // Platforms zonder weergaven (bijv. Facebook met alleen interacties) beoordelen we niet.
    if (viewsCur === 0 && viewsPrev === 0) continue;

    const missing: string[] = [];
    if (cur.length < cfg.minMeasuredDays || prev.length < cfg.minMeasuredDays) missing.push(`te weinig meetdagen (${prev.length}/${cur.length})`);
    if (vCur.length < cfg.minVideos || vPrev.length < cfg.minVideos) missing.push(`te weinig video's (${vPrev.length} → ${vCur.length})`);
    if (viewsPrev < cfg.minPrevViews) missing.push("te weinig weergaven om te vergelijken");
    if (missing.length) {
      results.push({ ...out, state: "onvoldoende_data", note: missing.join(", ") });
      continue;
    }

    // Bereik per video: totaal bereik gedeeld door het aantal video's in die periode.
    const reachPerCur = reachCur / vCur.length, reachPerPrev = reachPrev / vPrev.length;
    // Weergaven per video: mediaan van de video's met een meting, anders het gemiddelde.
    const medCur = median(vCur.map((v) => v.views).filter((v): v is number => v != null));
    const medPrev = median(vPrev.map((v) => v.views).filter((v): v is number => v != null));
    const useMedian = medCur != null && medPrev != null && medPrev > 0
      && vCur.filter((v) => v.views != null).length >= cfg.minVideos && vPrev.filter((v) => v.views != null).length >= cfg.minVideos;
    const viewsPerCur = useMedian ? medCur! : viewsCur / vCur.length;
    const viewsPerPrev = useMedian ? medPrev! : viewsPrev / vPrev.length;
    const engRateCur = reachCur > 0 ? engCur / reachCur : 0, engRatePrev = reachPrev > 0 ? engPrev / reachPrev : 0;

    const changes: MetricChange[] = [];
    if (reachPrev > 0) changes.push({ key: "bereik", label: "Gemiddeld bereik per video", cur: Math.round(reachPerCur), prev: Math.round(reachPerPrev), pct: pctChange(reachPerCur, reachPerPrev) });
    changes.push({ key: "weergaven", label: useMedian ? "Mediaan weergaven per video" : "Gemiddelde weergaven per video", cur: Math.round(viewsPerCur), prev: Math.round(viewsPerPrev), pct: pctChange(viewsPerCur, viewsPerPrev) });
    if (engRatePrev > 0) changes.push({ key: "engagement", label: "Engagement (interacties / bereik)", cur: Math.round(engRateCur * 1000) / 10, prev: Math.round(engRatePrev * 1000) / 10, pct: pctChange(engRateCur, engRatePrev) });
    // Volgersgroei pas meewegen bij een betekenisvolle basis (≥ 10 nieuwe volgers).
    if (folPrev >= 10) changes.push({ key: "volgers", label: "Nieuwe volgers", cur: folCur, prev: folPrev, pct: pctChange(folCur, folPrev) });

    const declined = changes.filter((c) => c.pct <= -cfg.dropPct);
    // Een daling telt alleen als de andere kernstatistiek niet tegelijk stijgt:
    // minder bereik maar meer weergaven per video is geen achteruitgang.
    const reachC = changes.find((c) => c.key === "bereik");
    const viewsC = changes.find((c) => c.key === "weergaven");
    const core = declined.some((c) =>
      (c.key === "bereik" && !(viewsC && viewsC.pct > 0)) || (c.key === "weergaven" && !(reachC && reachC.pct > 0)));
    // Veel meer video's geplaatst? Dan daalt het gemiddelde per video vanzelf.
    // Alleen een signaal als ook het totale bereik/de totale weergaven dalen.
    const moreVideos = vCur.length >= vPrev.length * 1.5;
    const totalDrop = Math.min(pctChange(reachCur, reachPrev || 1), pctChange(viewsCur, viewsPrev)) <= -cfg.dropPct;
    if (core && moreVideos && !totalDrop) {
      results.push({ ...out, state: "ok", changes, declined: [], note: `meer video's geplaatst (${vPrev.length} → ${vCur.length}); totaal bereik en weergaven dalen niet significant` });
      continue;
    }
    results.push({ ...out, state: core ? "daling" : "ok", changes, declined: core ? declined : [] });
  }

  // Opvallend slechte video's: alleen ter info binnen het signaal, nooit los.
  const weakVideos: VideoRow[] = [];
  for (const p of platforms) {
    const recent = input.videos.filter((v) => v.platform === p && v.views != null && v.publishedOn >= prevFrom && dayDiff(input.today, v.publishedOn) >= 7);
    const med = median(recent.map((v) => v.views!));
    if (!med || recent.length < 5) continue;
    for (const v of recent) if (v.publishedOn >= curFrom && v.views! < med * cfg.weakVideoShare) weakVideos.push(v);
  }

  const dropping = results.filter((r) => r.state === "daling");
  const judged = results.filter((r) => r.state !== "onvoldoende_data");
  const state: ResultsVerdict["state"] = dropping.length ? "daling" : judged.length ? "ok" : results.length ? "onvoldoende_data" : "geen_koppeling";

  let summary: string;
  if (state === "daling") {
    const lead = dropping[0].declined.find((c) => c.key === "bereik") ?? dropping[0].declined[0];
    summary = `${lead.label.replace(" per video", "")} is de afgelopen ${W} dagen met ${Math.abs(lead.pct)}% gedaald ten opzichte van de ${W} dagen daarvoor (${platformLabel(dropping[0].platform)}).`;
  } else if (state === "onvoldoende_data") {
    summary = `Nog geen betrouwbaar oordeel: ${results.map((r) => `${platformLabel(r.platform)} ${r.note}`).join("; ")}.`;
  } else if (state === "geen_koppeling") {
    summary = "Er komen voor deze klant geen bruikbare resultaten binnen via een koppeling.";
  } else summary = "Geen significante daling.";

  return { ...base, state, platforms: results, weakVideos, summary };
}

/* ------------------------------------------------------------------ *
 * Klantfeedback
 * ------------------------------------------------------------------ */

/** correctie = normale aanpassing, aandacht = signaal van ontevredenheid, ernstig = klantbehoud in gevaar. */
export type FeedbackKind = "correctie" | "aandacht" | "ernstig";
export type FeedbackCategory = "kwaliteit" | "techniek" | "resultaten" | "samenwerking" | "communicatie" | "overig";

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  correctie: "Normale correctie",
  aandacht: "Ontevredenheid",
  ernstig: "Klantbehoud in gevaar",
};
export const FEEDBACK_CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  kwaliteit: "Kwaliteit content",
  techniek: "Video- of opnamekwaliteit",
  resultaten: "Resultaten",
  samenwerking: "Samenwerking",
  communicatie: "Communicatie",
  overig: "Overig",
};
export const FEEDBACK_SOURCES = ["frame", "script", "portaal", "whatsapp", "mail", "telefoon", "meeting", "overig"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];
export const FEEDBACK_SOURCE_LABEL: Record<FeedbackSource, string> = {
  frame: "Frame.io", script: "Script", portaal: "Klantportaal", whatsapp: "WhatsApp", mail: "E-mail",
  telefoon: "Telefoon", meeting: "Gesprek", overig: "Overig",
};

const RULES: { kind: FeedbackKind; category: FeedbackCategory; re: RegExp }[] = [
  // Klantbehoud in gevaar
  { kind: "ernstig", category: "samenwerking", re: /\b(opzeggen|opzegging|stoppen met|willen stoppen|wil stoppen|beëindigen|beeindigen|samenwerking (heroverwegen|evalueren|stopzetten)|twijfel(en|s)? over (de )?samenwerking|andere partij|ander bureau|niet verlengen|contract (opzeggen|niet verlengen))\b/i },
  { kind: "ernstig", category: "resultaten", re: /\b(levert (ons )?(niks|niets) op|geen resultaat|zonde van (het|ons) geld|weggegooid geld)\b/i },
  // Ontevredenheid
  { kind: "aandacht", category: "techniek", re: /\b(onscherp|wazig|slecht(e)? (geluid|audio|beeld|licht|belichting)|ruis|overbelicht|onderbelicht|beeld(kwaliteit)? (valt tegen|is slecht)|geluid (valt tegen|is slecht))\b/i },
  { kind: "aandacht", category: "resultaten", re: /\b(resultaten (vallen tegen|zijn (niet|slecht|teleurstellend))|te weinig (views|weergaven|bereik)|weinig (views|weergaven|bereik)|(views|weergaven|bereik) (dalen|valt|vallen))\b/i },
  { kind: "aandacht", category: "kwaliteit", re: /\b(valt\b[^.?!]{0,30}\btegen|vallen\b[^.?!]{0,30}\btegen|tegenvallen|tegenvalt|teleurgesteld|teleurstellend|niet tevreden|ontevreden|niet wat we (verwacht|bedoeld)|niet goed genoeg|kwaliteit (is|was) (niet|slecht|minder)|amateuristisch|niet professioneel|weer (dezelfde|hetzelfde) fout|nog steeds niet|alweer)\b/i },
  { kind: "aandacht", category: "communicatie", re: /\b(geen reactie|niks gehoord|niets gehoord|te laat|steeds te laat|niet nagekomen|afspraak niet)\b/i },
];

/**
 * Doet een voorstel voor de soort en het onderwerp van een stuk feedback, op
 * basis van herkenbare formuleringen. Dit is uitdrukkelijk een voorstel: de
 * medewerker bevestigt of corrigeert het bij het registreren. Zonder treffer is
 * het voorstel "correctie" (een gewone aanpassing zoals een ondertitel).
 */
export function suggestFeedback(text: string): { kind: FeedbackKind; category: FeedbackCategory; matched: string[] } {
  const matched: { kind: FeedbackKind; category: FeedbackCategory; hit: string }[] = [];
  for (const r of RULES) {
    const m = text.match(r.re);
    if (m) matched.push({ kind: r.kind, category: r.category, hit: m[0] });
  }
  if (!matched.length) return { kind: "correctie", category: "overig", matched: [] };
  const top = matched.find((m) => m.kind === "ernstig") ?? matched[0];
  return { kind: top.kind, category: top.category, matched: matched.map((m) => m.hit) };
}

/* ------------------------------------------------------------------ *
 * Contractmomenten
 * ------------------------------------------------------------------ */

export type ContractInput = {
  startsOn: string | null;
  endsOn: string | null;
  noticePeriodDays: number | null;
  autoRenew: boolean | null;
  /** Gecontroleerd door een medewerker? Zo niet, dan zijn de gegevens onzeker. */
  verified: boolean;
};

export type ContractMoment = {
  /** Eerste moment waarop een besluit nodig is: de opzegdeadline, anders de einddatum. */
  decisionDate: string | null;
  decisionLabel: "opzegdeadline" | "einddatum" | null;
  daysToDecision: number | null;
  /** 60, 30 of 14 dagen vóór het beslismoment; "voorbij" als het al gepasseerd is. */
  stage: 60 | 30 | 14 | "voorbij" | null;
  /** Wat ontbreekt of onzeker is: dit vraagt eerst om controle. */
  issues: string[];
};

/**
 * Bepaalt het beslismoment van een contract en in welke fase het zit. De
 * opzegdeadline (einddatum min opzegtermijn) ligt vaak eerder dan de einddatum
 * en is dan leidend. Ontbrekende of ongecontroleerde gegevens worden benoemd in
 * plaats van aangevuld met aannames.
 */
export function contractMoment(c: ContractInput | null, today: string): ContractMoment {
  const empty = { decisionDate: null, decisionLabel: null, daysToDecision: null, stage: null };
  if (!c) return { ...empty, issues: ["Geen actief contract vastgelegd"] };

  const issues: string[] = [];
  if (!c.verified) issues.push("Contractgegevens nog niet gecontroleerd");
  if (!c.startsOn) issues.push("Startdatum ontbreekt");
  if (!c.endsOn) issues.push(c.autoRenew ? "Geen einddatum: verlengmoment onbekend" : "Einddatum ontbreekt");
  if (c.noticePeriodDays == null) issues.push("Opzegtermijn ontbreekt");
  if (c.autoRenew == null) issues.push("Onbekend of het contract automatisch verlengt");
  if (!c.endsOn) return { ...empty, issues };

  const notice = c.noticePeriodDays ?? 0;
  const decisionDate = notice > 0 ? addDays(c.endsOn, -notice) : c.endsOn;
  const daysToDecision = dayDiff(decisionDate, today);
  const [s60, s30, s14] = RETENTION_DEFAULTS.contractStages;
  let stage: ContractMoment["stage"] = null;
  if (daysToDecision < 0) stage = dayDiff(c.endsOn, today) >= 0 ? "voorbij" : null;
  else if (daysToDecision <= s14) stage = 14;
  else if (daysToDecision <= s30) stage = 30;
  else if (daysToDecision <= s60) stage = 60;

  return { decisionDate, decisionLabel: notice > 0 ? "opzegdeadline" : "einddatum", daysToDecision, stage, issues };
}

/* ------------------------------------------------------------------ *
 * Klantgezondheid
 * ------------------------------------------------------------------ */

export type HealthStatus = "gezond" | "aandacht" | "direct";
export const HEALTH_LABEL: Record<HealthStatus, string> = {
  gezond: "Gezond",
  aandacht: "Aandacht nodig",
  direct: "Directe aandacht nodig",
};

export type OpenFeedback = { kind: FeedbackKind; category: FeedbackCategory; createdOn: string; summary: string };

/**
 * Tevredenheidsrisico per klant, met de redenen erbij. Bewust zonder
 * contractmoment (dat is commerciële opvolging, zie `commercialFollowUp`).
 *
 *  Direct:   een open ernstig signaal (bijv. twijfel over de samenwerking), of
 *            ≥ 3 open ontevredenheidssignalen, of resultaten dalen én er is een
 *            open ontevredenheidssignaal.
 *  Aandacht: resultaten dalen significant, of ≥ 1 open ontevredenheidssignaal,
 *            of resultaten/contractgegevens ontbreken of zijn verouderd.
 *  Gezond:   geen van beide.
 */
export function clientHealth(input: {
  results: Pick<ResultsVerdict, "state" | "summary">;
  openFeedback: OpenFeedback[];
  dataIssues: string[];
}): { status: HealthStatus; reasons: string[] } {
  const serious = input.openFeedback.filter((f) => f.kind === "ernstig");
  const unhappy = input.openFeedback.filter((f) => f.kind === "aandacht");
  const dropping = input.results.state === "daling";
  const reasons: string[] = [];

  for (const f of serious) reasons.push(`Ernstig signaal: ${f.summary}`);
  if (unhappy.length) reasons.push(unhappy.length === 1 ? `Open klacht: ${unhappy[0].summary}` : `${unhappy.length} open klachten (${[...new Set(unhappy.map((f) => FEEDBACK_CATEGORY_LABEL[f.category].toLowerCase()))].join(", ")})`);
  if (dropping) reasons.push(input.results.summary);

  let status: HealthStatus = "gezond";
  if (serious.length || unhappy.length >= 3 || (dropping && unhappy.length >= 1)) status = "direct";
  else if (dropping || unhappy.length) status = "aandacht";

  // Ontbrekende of verouderde resultaten: nooit rood, wel aandacht (we weten het niet).
  if (input.results.state === "verouderd") reasons.push(input.results.summary);
  for (const d of input.dataIssues) reasons.push(d);
  if (status === "gezond" && (input.results.state === "verouderd" || input.dataIssues.length)) status = "aandacht";

  if (!reasons.length) reasons.push(input.results.state === "ok" ? "Geen negatieve signalen; resultaten stabiel." : "Geen negatieve signalen vastgesteld.");
  return { status, reasons };
}

/** Commerciële opvolging, los van tevredenheid. */
export function commercialFollowUp(m: ContractMoment): { label: string; tone: "neutraal" | "aandacht" | "urgent" } | null {
  if (m.stage === null || m.decisionDate === null) return null;
  const when = m.decisionLabel === "opzegdeadline" ? "Opzegdeadline" : "Einddatum";
  const unsure = m.issues.includes("Contractgegevens nog niet gecontroleerd");
  // Op ongecontroleerde gegevens geen rood: eerst controleren.
  if (m.stage === "voorbij") return unsure ? { label: `${when} gepasseerd? Contract controleren`, tone: "neutraal" } : { label: `${when} gepasseerd`, tone: "urgent" };
  return { label: `${when} over ${m.daysToDecision} dagen${unsure ? " (niet gecontroleerd)" : ""}`, tone: m.stage === 14 ? "urgent" : m.stage === 30 ? "aandacht" : "neutraal" };
}

/* ------------------------------------------------------------------ *
 * Verantwoordelijke en vervanging
 * ------------------------------------------------------------------ */

export type StaffKey = "jarno" | "milou" | "jiska" | "rutger";

/**
 * Wie pakt welk soort signaal op:
 *  - resultaten, klachten en contractmomenten → de verantwoordelijke van de klant
 *    (Klantbeheer), want die kent de klant;
 *  - klachten over video- of opnamekwaliteit → Rutger;
 *  - ontbrekende gegevens (contract, koppeling) → Jiska;
 *  - geen verantwoordelijke ingesteld → Milou.
 * Is de eigenaar afwezig, dan neemt de vervanger het over (zie `coverFor`).
 */
export function routeSignal(kind: "resultaten" | "feedback" | "techniek" | "contract" | "gegevens", coordinator: StaffKey | null): StaffKey {
  if (kind === "techniek") return "rutger";
  if (kind === "gegevens") return "jiska";
  return coordinator ?? "milou";
}

/**
 * Vervanger voor klantbehoud-signalen. Bewust een eigen regel en níet de
 * algemene vervangingskoppels: die sturen ook andere meldingen door (bijv.
 * financiële meldingen van Jarno), en dat mag niet.
 *  - Milou ↔ Jiska vervangen elkaar;
 *  - Jarno en Rutger worden vervangen door Milou, of Jiska als Milou ook weg is.
 */
export function coverFor(owner: StaffKey, absent: ReadonlySet<StaffKey>): StaffKey {
  if (!absent.has(owner)) return owner;
  const order: StaffKey[] = owner === "milou" ? ["jiska"] : owner === "jiska" ? ["milou"] : ["milou", "jiska"];
  return order.find((k) => !absent.has(k)) ?? owner;
}

/** Wie krijgt een escalatie als een kritiek punt niet wordt opgepakt. */
export function escalationTarget(owner: StaffKey, absent: ReadonlySet<StaffKey>): StaffKey | null {
  const candidates: StaffKey[] = ["milou", "jiska"];
  return candidates.find((k) => k !== owner && !absent.has(k)) ?? null;
}
