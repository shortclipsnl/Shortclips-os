/**
 * Klantonderzoek: gedeelde types, labels en rekenregels.
 * Importeerbaar door server en client (geen "server-only").
 */

/* ------------------------------- Modules ------------------------------- */

export const RESEARCH_MODULES = [
  { key: "bedrijfsprofiel", nr: 1, title: "Bedrijfsprofiel", hint: "Branche, aanbod, vestigingen, positionering, merk en doelen" },
  { key: "doelgroep", nr: 2, title: "Doelgroepanalyse", hint: "B2B of B2C, beslissers, koopmotieven, pijnpunten en bezwaren" },
  { key: "social", nr: 3, title: "Socialmediaonderzoek", hint: "Kanalen, volgers, frequentie, formats en zichtbare trends" },
  { key: "nulmeting", nr: 4, title: "Nulmeting", hint: "Cijfers op de startdatum, per herkomst" },
  { key: "contentanalyse", nr: 5, title: "Contentanalyse", hint: "Bestaande video's, onderwerpen, openingszinnen en formats" },
  { key: "marketing_software", nr: 6, title: "Marketing en software", hint: "Zichtbare systemen; niet bevestigd blijft onbekend" },
  { key: "concurrenten", nr: 7, title: "Concurrentieonderzoek", hint: "Drie tot vijf relevante concurrenten en hun aanpak" },
  { key: "reviews", nr: 8, title: "Reviews en klantbehoeften", hint: "Openbare reviews, klachten, complimenten en vragen" },
  { key: "kansen", nr: 9, title: "Commerciële kansen", hint: "Waar short video bijdraagt aan bereik, vertrouwen en aanvragen" },
  { key: "strategie", nr: 10, title: "AI contentstrategie", hint: "Eerste advies: pijlers, formats, hooks, scripts en opnames" },
] as const;

export type ModuleKey = (typeof RESEARCH_MODULES)[number]["key"];
/** Modules die het onderzoek als tekst met bevindingen vult (nulmeting is een cijfertabel). */
export const TEXT_MODULES = RESEARCH_MODULES.filter((m) => m.key !== "nulmeting").map((m) => m.key) as Exclude<ModuleKey, "nulmeting">[];
export type TextModuleKey = Exclude<ModuleKey, "nulmeting">;

/* ------------------------------ Bevindingen ----------------------------- */

export const FINDING_KINDS = ["feit", "berekening", "aanname", "aanbeveling"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];
export const FINDING_KIND_LABEL: Record<FindingKind | "handmatig", string> = {
  feit: "Feit",
  berekening: "Berekening",
  aanname: "Aanname",
  aanbeveling: "AI aanbeveling",
  handmatig: "Aangevuld door team",
};

export const CONFIDENCES = ["hoog", "middel", "laag"] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const CONFIDENCE_LABEL: Record<Confidence, string> = { hoog: "Hoog", middel: "Middel", laag: "Laag" };

export type Finding = {
  id: string;
  tekst: string;
  soort: FindingKind;
  betrouwbaarheid: Confidence;
  /** Naam van de bron (pagina, profiel, reviewsite, "Klantgegevens Shortclips"). */
  bron: string | null;
  bronUrl: string | null;
};

export type DossierModule = {
  conclusie: string;
  bevindingen: Finding[];
  /** Wat het onderzoek niet kon vinden of niet openbaar is. */
  ontbreekt: string[];
};

export type DossierChannel = {
  platform: string;
  gevonden: boolean;
  url: string | null;
  /** Alleen als het getal openbaar zichtbaar was; anders null. Nooit geschat. */
  volgers: number | null;
  frequentie: string | null;
  opmerking: string | null;
};

export type DossierCompetitor = {
  naam: string;
  url: string | null;
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
  aanpak: string;
  watWerkt: string;
  kansVoorKlant: string;
};

export type DossierSoftware = {
  categorie: string;
  naam: string;
  /** 'zichtbaar' = aantoonbaar gevonden; 'onbekend' = niet openbaar, nog te bevestigen. */
  status: "zichtbaar" | "onbekend";
  bewijs: string | null;
};

export type DossierStrategy = {
  pijlers: { naam: string; waarom: string }[];
  formats: { naam: string; waarom: string }[];
  hooks: string[];
  scriptideeen: { titel: string; hook: string; kern: string }[];
  opnames: string[];
  verbeterpunten: string[];
};

export type Dossier = {
  modules: Record<TextModuleKey, DossierModule>;
  kanalen: DossierChannel[];
  concurrenten: DossierCompetitor[];
  software: DossierSoftware[];
  strategie: DossierStrategy;
  topInzichten: string[];
  topKansen: string[];
};

export type ResearchSource = { label: string; url: string };

/* ------------------------------- Nulmeting ------------------------------ */

export const BASELINE_ORIGINS = ["openbaar", "gekoppeld", "handmatig"] as const;
export type BaselineOrigin = (typeof BASELINE_ORIGINS)[number];
export const BASELINE_ORIGIN_LABEL: Record<BaselineOrigin, string> = {
  openbaar: "Openbaar cijfer",
  gekoppeld: "Gekoppeld account",
  handmatig: "Handmatige invoer",
};

export const BASELINE_METRICS = {
  volgers: "Volgers",
  weergaven_30d: "Weergaven, laatste 30 dagen",
  bereik_30d: "Bereik, laatste 30 dagen",
  interacties_30d: "Interacties, laatste 30 dagen",
  posts_30d: "Geplaatste posts, laatste 30 dagen",
  anders: "Overig",
} as const;
export type BaselineMetric = keyof typeof BASELINE_METRICS;

export type BaselineRow = {
  id: string;
  platform: string;
  metric: BaselineMetric;
  /** Eigen omschrijving bij metric 'anders'. */
  label?: string | null;
  value: number;
  herkomst: BaselineOrigin;
  bron: string;
  /** Meetdatum (YYYY-MM-DD). */
  gemetenOp: string;
  door?: string | null;
};

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  website: "Website",
  google: "Google",
  overig: "Overig",
};
export const platformLabel = (p: string) => PLATFORM_LABEL[p.toLowerCase()] ?? p;

/* --------------------------- Correcties van team ------------------------ */

export type Correction = { tekst?: string; verborgen?: boolean; door: string; op: string };
export type Corrections = Record<string, Correction>;
export type Addition = { id: string; module: ModuleKey; tekst: string; door: string; op: string };

export type ViewFinding = Finding & {
  /** Oorspronkelijke tekst van het onderzoek als het team de bevinding heeft aangepast. */
  origineel: string | null;
  gecorrigeerdDoor: string | null;
};

/**
 * Bevindingen zoals het team ze ziet: het onderzoek plus de correcties.
 * Verborgen bevindingen vallen weg, aangepaste tonen de nieuwe tekst en
 * onthouden de oorspronkelijke. Het dossier zelf wordt nooit gewijzigd.
 */
export function applyCorrections(findings: Finding[], corrections: Corrections): ViewFinding[] {
  const out: ViewFinding[] = [];
  for (const f of findings) {
    const c = corrections[f.id];
    if (c?.verborgen) continue;
    const changed = Boolean(c?.tekst && c.tekst.trim() && c.tekst.trim() !== f.tekst);
    out.push({
      ...f,
      tekst: changed ? c!.tekst!.trim() : f.tekst,
      origineel: changed ? f.tekst : null,
      gecorrigeerdDoor: changed ? c!.door : null,
    });
  }
  return out;
}

/* ----------------------- Opschonen van AI-uitvoer ----------------------- */

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const strOrNull = (v: unknown, max = 500): string | null => str(v, max) || null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function httpUrl(v: unknown): string | null {
  const s = str(v, 600);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Leest een aantal uit AI-uitvoer. Alleen een kaal getal telt ("12400", "12.400");
 * afrondingen als "12K", "ca. 12.000" of "meer dan 10.000" zijn geen exact
 * openbaar cijfer en worden dus niet als meting vastgelegd.
 */
export function wholeNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{1,3}([.\s]\d{3})*$|^\d+$/.test(s)) return null;
  return Number(s.replace(/[.\s]/g, ""));
}

/** Gedachtestreepjes horen niet in Shortclips-teksten. */
const tidy = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

const ADVICE_MODULES = ["kansen", "strategie"];

function normalizeModule(key: string, raw: unknown): DossierModule {
  const m = rec(raw);
  const bevindingen: Finding[] = [];
  arr(m.bevindingen).forEach((x, i) => {
    const f = rec(x);
    const tekst = tidy(str(f.tekst, 900));
    if (!tekst) return;
    let soort = (FINDING_KINDS as readonly string[]).includes(String(f.soort)) ? (f.soort as FindingKind) : "aanname";
    // Kansen en strategie zijn per definitie advies: daar bestaat geen "feit".
    if (ADVICE_MODULES.includes(key) && (soort === "feit" || soort === "berekening")) soort = "aanbeveling";
    const bronUrl = httpUrl(f.bronUrl);
    const bron = strOrNull(f.bron, 200);
    let betrouwbaarheid = (CONFIDENCES as readonly string[]).includes(String(f.betrouwbaarheid)) ? (f.betrouwbaarheid as Confidence) : "laag";
    // Een feit zonder bron is niet controleerbaar: dan nooit "hoog".
    if (soort === "feit" && !bron && !bronUrl && betrouwbaarheid === "hoog") betrouwbaarheid = "middel";
    bevindingen.push({ id: `${key}-${i + 1}`, tekst, soort, betrouwbaarheid, bron, bronUrl });
  });
  return {
    conclusie: tidy(str(m.conclusie, 700)),
    bevindingen: bevindingen.slice(0, 14),
    ontbreekt: arr(m.ontbreekt).map((x) => tidy(str(x, 300))).filter(Boolean).slice(0, 10),
  };
}

const pairs = (v: unknown, a: string, b: string, max: number) =>
  arr(v)
    .map((x) => ({ [a]: tidy(str(rec(x)[a], 160)), [b]: tidy(str(rec(x)[b], 500)) }))
    .filter((x) => x[a])
    .slice(0, max);

/**
 * Maakt van ruwe AI-uitvoer een geldig dossier. Alles wat niet klopt met het
 * formaat valt weg in plaats van half te worden getoond; ontbrekende modules
 * worden leeg aangemaakt, zodat de pagina altijd alle tien modules kan tonen.
 */
export function normalizeDossier(raw: unknown): Dossier {
  const r = rec(raw);
  const mods = rec(r.modules);
  const modules = {} as Record<TextModuleKey, DossierModule>;
  for (const key of TEXT_MODULES) modules[key] = normalizeModule(key, mods[key]);

  const kanalen: DossierChannel[] = arr(r.kanalen)
    .map((x) => {
      const c = rec(x);
      const platform = str(c.platform, 40).toLowerCase();
      const url = httpUrl(c.url);
      return {
        platform,
        gevonden: (c.gevonden === true || /^(ja|true)$/i.test(String(c.gevonden).trim())) && Boolean(url),
        url,
        volgers: wholeNumber(c.volgers),
        frequentie: strOrNull(c.frequentie, 200),
        opmerking: strOrNull(c.opmerking, 400),
      };
    })
    .filter((c) => c.platform)
    .slice(0, 8);

  const concurrenten: DossierCompetitor[] = arr(r.concurrenten)
    .map((x) => {
      const c = rec(x);
      return {
        naam: str(c.naam, 160),
        url: httpUrl(c.url),
        instagram: strOrNull(c.instagram, 160),
        tiktok: strOrNull(c.tiktok, 160),
        youtube: strOrNull(c.youtube, 160),
        aanpak: tidy(str(c.aanpak, 500)),
        watWerkt: tidy(str(c.watWerkt, 500)),
        kansVoorKlant: tidy(str(c.kansVoorKlant, 500)),
      };
    })
    .filter((c) => c.naam)
    .slice(0, 5);

  const software: DossierSoftware[] = arr(r.software)
    .map((x) => {
      const s = rec(x);
      const bewijs = strOrNull(s.bewijs, 300);
      // Zonder bewijs is een systeem nooit "zichtbaar": dan blijft het onbekend.
      const status: DossierSoftware["status"] = s.status === "zichtbaar" && bewijs ? "zichtbaar" : "onbekend";
      return { categorie: str(s.categorie, 80), naam: status === "zichtbaar" ? str(s.naam, 120) : str(s.naam, 120) || "Onbekend", status, bewijs };
    })
    .filter((s) => s.categorie)
    .slice(0, 14);

  const st = rec(r.strategie);
  const strategie: DossierStrategy = {
    pijlers: pairs(st.pijlers, "naam", "waarom", 5) as DossierStrategy["pijlers"],
    formats: pairs(st.formats, "naam", "waarom", 5) as DossierStrategy["formats"],
    hooks: arr(st.hooks).map((x) => tidy(str(x, 220))).filter(Boolean).slice(0, 8),
    scriptideeen: arr(st.scriptideeen)
      .map((x) => ({ titel: tidy(str(rec(x).titel, 160)), hook: tidy(str(rec(x).hook, 220)), kern: tidy(str(rec(x).kern, 500)) }))
      .filter((x) => x.titel)
      .slice(0, 5),
    opnames: arr(st.opnames).map((x) => tidy(str(x, 300))).filter(Boolean).slice(0, 8),
    verbeterpunten: arr(st.verbeterpunten).map((x) => tidy(str(x, 300))).filter(Boolean).slice(0, 8),
  };

  return {
    modules,
    kanalen,
    concurrenten,
    software,
    strategie,
    topInzichten: arr(r.topInzichten).map((x) => tidy(str(x, 260))).filter(Boolean).slice(0, 5),
    topKansen: arr(r.topKansen).map((x) => tidy(str(x, 260))).filter(Boolean).slice(0, 5),
  };
}

export function normalizeSources(raw: unknown): ResearchSource[] {
  const seen = new Set<string>();
  const out: ResearchSource[] = [];
  for (const x of arr(raw)) {
    const url = httpUrl(rec(x).url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ label: str(rec(x).label, 160) || new URL(url).hostname, url });
  }
  return out.slice(0, 60);
}

/* --------------------------- Ontbrekende gegevens ----------------------- */

export type InternalBasis = {
  website: string | null;
  kanalen: { platform: string; handle: string; url: string | null }[];
  briefingVelden: number;
  gekoppeldeCijfers: boolean;
  contactpersoon: boolean;
};

/**
 * Wat het team zelf nog kan aanleveren. Staat bovenaan de pagina, zodat direct
 * duidelijk is waarom een deel van het dossier dun is.
 */
export function missingInfo(basis: InternalBasis, dossier: Dossier | null, baseline: BaselineRow[]): string[] {
  const out: string[] = [];
  if (!basis.website) out.push("Website van de klant ontbreekt in de klantgegevens");
  if (basis.kanalen.length === 0 && !(dossier?.kanalen ?? []).some((k) => k.gevonden)) out.push("Geen socialmediakanalen bekend of gevonden");
  if (basis.briefingVelden === 0) out.push("Klantbriefing uit het kennismakingsgesprek is nog niet ingevuld");
  if (!basis.gekoppeldeCijfers) out.push("Geen gekoppelde accountcijfers (Metricool): bereik en weergaven zijn niet openbaar");
  if (baseline.length === 0) out.push("Nulmeting bevat nog geen cijfers");
  if (dossier) {
    const onbekend = dossier.software.filter((s) => s.status === "onbekend").length;
    if (onbekend > 0) out.push(`${onbekend} ${onbekend === 1 ? "systeem" : "systemen"} bij Marketing en software nog te bevestigen bij de klant`);
    for (const key of TEXT_MODULES) {
      const m = dossier.modules[key];
      if (m.bevindingen.length === 0) out.push(`${RESEARCH_MODULES.find((x) => x.key === key)!.title}: geen aantoonbare informatie gevonden`);
    }
  }
  return out;
}

/* ------------------------------- Hercontrole ---------------------------- */

export const RECHECK_DAYS = 90;

/** Datum (YYYY-MM-DD) waarop de volgende hercontrole mag starten. */
export function nextCheckDate(approvedOn: string, days = RECHECK_DAYS): string {
  const d = new Date(`${approvedOn.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type BaselineChange = {
  platform: string;
  metric: BaselineMetric;
  label: string;
  herkomst: BaselineOrigin;
  was: number;
  nu: number;
  verschil: number;
  /** Procentuele verandering; null als de startwaarde 0 was. */
  pct: number | null;
};

const rowKey = (r: BaselineRow) => `${r.platform.toLowerCase()}|${r.metric}|${r.herkomst}|${r.metric === "anders" ? (r.label ?? "").toLowerCase() : ""}`;

/**
 * Vergelijkt de cijfers van nu met de nulmeting. Alleen cijfers met dezelfde
 * herkomst worden vergeleken: een openbaar volgersaantal wordt nooit naast een
 * handmatig ingevoerd getal gezet.
 */
export function compareBaselines(start: BaselineRow[], now: BaselineRow[]): BaselineChange[] {
  const first = new Map(start.map((r) => [rowKey(r), r]));
  const out: BaselineChange[] = [];
  for (const r of now) {
    const was = first.get(rowKey(r));
    if (!was) continue;
    const verschil = r.value - was.value;
    out.push({
      platform: r.platform,
      metric: r.metric,
      label: r.metric === "anders" ? r.label || "Overig" : BASELINE_METRICS[r.metric],
      herkomst: r.herkomst,
      was: was.value,
      nu: r.value,
      verschil,
      pct: was.value > 0 ? Math.round((verschil / was.value) * 1000) / 10 : null,
    });
  }
  return out;
}

/* --------------------------------- Status ------------------------------- */

export const RESEARCH_STATUS_LABEL: Record<string, string> = {
  bezig: "Onderzoek loopt",
  controle: "Wacht op controle",
  goedgekeurd: "Goedgekeurd",
  mislukt: "Mislukt",
};

export const RESEARCH_PHASES = ["intern", "bedrijf", "social", "dossier", "strategie"] as const;
export type ResearchPhase = (typeof RESEARCH_PHASES)[number];
export const RESEARCH_PHASE_LABEL: Record<ResearchPhase, string> = {
  intern: "Klantgegevens ophalen",
  bedrijf: "Bedrijf, doelgroep en reviews onderzoeken",
  social: "Social media en concurrenten onderzoeken",
  dossier: "Dossier opbouwen",
  strategie: "Kansen en contentstrategie uitwerken",
};

/** Opgeslagen fase ("wacht_social") naar de fase die als volgende draait. */
export function resumePhase(stored: string): ResearchPhase {
  const p = stored.startsWith("wacht_") ? stored.slice(6) : stored;
  return (RESEARCH_PHASES as readonly string[]).includes(p) ? (p as ResearchPhase) : "intern";
}

/* ------------------------- Koppeling Contentgeheugen -------------------- */

export const RESEARCH_KNOWLEDGE_SOURCE = "klantonderzoek";

export type KnowledgeDraft = { category: string; title: string; body: string };

const join = (items: string[], max: number) => items.filter(Boolean).slice(0, max).join(" ");

/**
 * Wat na goedkeuring naar de klantkennis gaat (de bron voor Script Engine,
 * captions, briefings en Content Research). Aannames gaan niet mee: alleen
 * feiten, berekeningen en de goedgekeurde aanbevelingen, na correcties van
 * het team.
 */
export function knowledgeFromDossier(dossier: Dossier, corrections: Corrections, additions: Addition[]): KnowledgeDraft[] {
  const solid = (key: TextModuleKey, kinds: FindingKind[]) =>
    applyCorrections(dossier.modules[key].bevindingen, corrections)
      .filter((f) => kinds.includes(f.soort))
      .map((f) => f.tekst);
  const extra = (key: ModuleKey) => additions.filter((a) => a.module === key).map((a) => a.tekst);
  const out: KnowledgeDraft[] = [];
  const push = (category: string, title: string, parts: string[], max = 6) => {
    const body = join(parts, max).slice(0, 1400);
    if (body) out.push({ category, title, body });
  };

  push("fact", "Bedrijfsprofiel (klantonderzoek)", [...solid("bedrijfsprofiel", ["feit", "berekening"]), ...extra("bedrijfsprofiel")]);
  push("audience", "Doelgroep (klantonderzoek)", [...solid("doelgroep", ["feit", "berekening"]), ...extra("doelgroep")]);
  push("fact", "Klantbehoeften uit reviews (klantonderzoek)", [...solid("reviews", ["feit", "berekening"]), ...extra("reviews")]);
  push("fact", "Wat tot nu toe werkt op social (klantonderzoek)", [...solid("contentanalyse", ["feit", "berekening"]), ...extra("contentanalyse")]);
  if (dossier.concurrenten.length) {
    push("competitor", "Concurrenten (klantonderzoek)", dossier.concurrenten.map((c) => `${c.naam}: ${c.aanpak}${c.kansVoorKlant ? ` Kans: ${c.kansVoorKlant}` : ""}`), 5);
  }
  push("content_pillar", "Contentpijlers, eerste advies (klantonderzoek)", dossier.strategie.pijlers.map((p) => `${p.naam}: ${p.waarom}`), 5);
  push("hook_style", "Formats en hooks, eerste advies (klantonderzoek)", [
    ...dossier.strategie.formats.map((f) => `Format ${f.naam}: ${f.waarom}`),
    ...dossier.strategie.hooks.slice(0, 4).map((h) => `Hook: ${h}`),
  ], 8);
  push("fact", "Kansen voor short video (klantonderzoek)", [...dossier.topKansen, ...extra("kansen")], 5);
  return out;
}
