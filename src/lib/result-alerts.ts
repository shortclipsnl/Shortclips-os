/**
 * Slim alertsysteem "Klanten die aandacht nodig hebben" (Resultatenpagina).
 *
 * Pure analyse, zonder database: vergelijkt per klant en per platform de laatste
 * video's met de eigen historische prestaties van die klant. Bron is het
 * Contentgeheugen, dat per video al een score berekent t.o.v. het normale
 * niveau van dezelfde klant op hetzelfde platform (1 = normaal). Daardoor telt
 * een klant met 500 weergaven per video net zo eerlijk mee als een klant met
 * 50.000.
 *
 * Uitgangspunten:
 *  - Alleen echte cijfers. Ontbreekt iets, dan valt dat signaal weg in plaats
 *    van dat het geschat wordt; bij te weinig data volgt "onvoldoende data".
 *  - Video's jonger dan 7 dagen tellen niet mee (zit al in het Contentgeheugen).
 *  - Eén tegenvallende video geeft nooit een alert: een signaal vraagt een
 *    venster van 4 recente video's waarvan de meerderheid onder het eigen
 *    niveau zit, of een reeks van minimaal 4.
 *  - Oorzaken zijn "onderbouwd" (de data laat het verband bij deze klant zien)
 *    of "hypothese" (een feitelijke verandering waarvan het effect nog getest
 *    moet worden). Nooit als bewezen presenteren wat een aanname is.
 */

/* ------------------------------------------------------------------ *
 * Drempels (op één plek, zodat ze te verantwoorden en bij te stellen zijn)
 * ------------------------------------------------------------------ */

export const RECENT_N = 4;
export const BASELINE_MIN = 6;
export const BASELINE_MAX = 12;
/** Een platform telt mee als het minstens zoveel video's heeft. */
export const MIN_PLATFORM_VIDEOS = RECENT_N + BASELINE_MIN;
/** Recente video's moeten echt recent zijn, anders is er niets actueels te melden. */
export const MAX_RECENT_AGE_DAYS = 45;
/** Platforms met een klein aandeel in het bereik geven geen eigen alert (ruis). */
export const MIN_PLATFORM_WEIGHT = 0.15;

const VIEWS_ORANJE = -0.25;
const VIEWS_ROOD = -0.4;
const RET_ORANJE = -0.2;
const RET_ROOD = -0.35;
const ENG_ORANJE = -0.35;
const ENG_ROOD = -0.55;
const STREAK_ORANJE = 4;
const STREAK_ROOD = 5;
const STREAK_PERF = 0.8;
const GROWTH_GROEN = 0.4;
const ENG_GROEN = 0.5;
const FOLLOW_MIN_PREV = 30;

/* ------------------------------------------------------------------ *
 * Typen
 * ------------------------------------------------------------------ */

export type Level = "rood" | "oranje" | "groen";
export type Evidence = "een_video" | "verkennend" | "gemengd" | "aannemelijk" | "sterk";

/** Wat de analyse van een video nodig heeft (structureel gelijk aan MemoryVideo). */
export type AlertVideo = {
  id: string;
  platform: string;
  publishedOn: string | null;
  title: string;
  hook: string;
  hookTypes: string[];
  cta: string;
  ctaText: string | null;
  format: string | null;
  durationSeconds: number | null;
  views: number;
  interactions: number;
  retention: number | null;
  viewScore: number;
  engScore: number;
  perf: number;
};

export type AlertGroup = {
  dimension: "format" | "hook" | "cta" | "lengte";
  label: string;
  n: number;
  medianPerf: number;
  verdict: "beter" | "slechter" | "neutraal";
  evidence: Evidence;
  trend: "sterker" | "zwakker" | "stabiel" | null;
  examples: Array<{ hook: string; title: string; ctaText: string | null }>;
};

export type AlertInput = {
  videos: AlertVideo[];
  formats: AlertGroup[];
  hooks: AlertGroup[];
  ctas: AlertGroup[];
  lengths: AlertGroup[];
  /** Volgersgroei (som follower_delta) laatste 30 dagen en de 30 dagen daarvoor; null = niet geleverd. */
  followers: { cur: number; prev: number } | null;
  /** Gepubliceerde posts laatste 30 dagen en de 30 dagen daarvoor. */
  posts: { cur: number; prev: number };
  /** Totaal aantal publicaties, ook te jonge en niet-video's (voor de "onvoldoende data"-uitleg). */
  publicationCount: number;
  now?: Date;
};

export type FindingKey = "bereik" | "retentie" | "interactie" | "reeks" | "volgers" | "platform" | "format" | "groei" | "succes";

export type Finding = {
  key: FindingKey;
  level: Level;
  platform: string | null;
  /** Korte kop voor de kaart, bijvoorbeeld "Bereik daalt met 32%". */
  headline: string;
  /** Concreet: welke statistiek wijkt af, t.o.v. wat. */
  detail: string;
  /** Korte cijfer-onderbouwing voor de lijst, bijvoorbeeld "4 van 4 onder niveau". */
  metric: string;
  deltaPct: number | null;
};

export type Cause = { kind: "onderbouwd" | "hypothese"; text: string; /** Twee à drie woorden voor de lijst. */ label: string };

export type MemoryInsight = {
  key: "hooks" | "formats" | "lengte" | "onderwerpen" | "filmstijl" | "cta" | "verschil";
  label: string;
  /** Leeg = (nog) niet vast te stellen uit de data. */
  items: string[];
  note?: string;
};

export type PlatformStats = {
  platform: string;
  weight: number;
  recentN: number;
  baselineN: number;
  recentFrom: string | null;
  recentTo: string | null;
  /** Mediaan score t.o.v. normaal (1 = normaal) in het recente venster en de basis. */
  viewScoreRecent: number;
  viewScoreBase: number;
  engScoreRecent: number;
  engScoreBase: number;
  retentionRecent: number | null;
  retentionBase: number | null;
  medianViewsRecent: number;
  medianViewsBase: number;
  belowCount: number;
  aboveCount: number;
  streak: number;
};

export type AlertDraft = {
  kind: "negatief" | "positief";
  level: Level;
  headline: string;
  findings: Finding[];
  causes: Cause[];
  advice: string;
  /** Actie in één korte zin voor de lijst. */
  adviceShort: string;
  actions: string[];
  memory: MemoryInsight[];
  platforms: string[];
  /** Momentopname waartegen het effect van een verbeteractie later gemeten wordt. */
  snapshot: Snapshot;
};

export type Snapshot = {
  measuredAt: string;
  platforms: Array<Pick<PlatformStats, "platform" | "viewScoreRecent" | "viewScoreBase" | "engScoreRecent" | "engScoreBase" | "retentionRecent" | "retentionBase" | "medianViewsRecent" | "medianViewsBase" | "recentTo">>;
};

export type Analysis =
  | { status: "onvoldoende"; reason: string; videoCount: number; stats: PlatformStats[] }
  | { status: "ok"; stats: PlatformStats[]; negative: AlertDraft | null; positive: AlertDraft | null; videoCount: number };

/* ------------------------------------------------------------------ *
 * Hulpfuncties
 * ------------------------------------------------------------------ */

const PLATFORM_NAME: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube Shorts", linkedin: "LinkedIn" };
export const platformName = (p: string) => PLATFORM_NAME[p] ?? p;

export function median(xs: number[]): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const pct = (r: number) => Math.round(r * 100);
const rel = (cur: number, base: number) => (base > 0 ? cur / base - 1 : 0);
const pctTxt = (x: number) => `${Math.abs(pct(x))}%`;
const solid = (e: Evidence) => e === "aannemelijk" || e === "sterk";
const rank = (l: Level) => (l === "rood" ? 2 : l === "oranje" ? 1 : 0);
const worst = (ls: Level[]): Level | null => (ls.length ? ls.reduce((a, b) => (rank(b) > rank(a) ? b : a)) : null);
const nl = (n: number) => new Intl.NumberFormat("nl-NL").format(Math.round(n));
const sec = (s: number) => `${Math.round(s)} sec`;
const days = (a: string, b: Date) => (b.getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000;

function lengthBucket(s: number | null | undefined): string | null {
  if (!s || s <= 0) return null;
  if (s < 20) return "Korter dan 20 sec";
  if (s < 35) return "20 tot 35 sec";
  if (s < 50) return "35 tot 50 sec";
  if (s < 75) return "50 tot 75 sec";
  return "Langer dan 75 sec";
}

/** Video's per platform, nieuwste eerst. */
function byPlatform(videos: AlertVideo[]): Map<string, AlertVideo[]> {
  const map = new Map<string, AlertVideo[]>();
  for (const v of videos) {
    if (!v.publishedOn) continue;
    map.set(v.platform, [...(map.get(v.platform) ?? []), v]);
  }
  for (const list of map.values()) list.sort((a, b) => (b.publishedOn! < a.publishedOn! ? -1 : b.publishedOn! > a.publishedOn! ? 1 : 0));
  return map;
}

/** Venster-statistieken per platform met voldoende video's. */
export function platformStats(videos: AlertVideo[]): PlatformStats[] {
  const groups = byPlatform(videos);
  const out: PlatformStats[] = [];
  for (const [platform, list] of groups) {
    if (list.length < MIN_PLATFORM_VIDEOS) continue;
    const recent = list.slice(0, RECENT_N);
    const base = list.slice(RECENT_N, RECENT_N + BASELINE_MAX);
    const vBase = median(base.map((v) => v.viewScore)) ?? 1;
    const eBase = median(base.map((v) => v.engScore)) ?? 1;
    const rRecent = recent.map((v) => v.retention).filter((x): x is number => x != null && x > 0);
    const rBase = base.map((v) => v.retention).filter((x): x is number => x != null && x > 0);
    let streak = 0;
    for (const v of list) {
      if (v.perf < STREAK_PERF) streak++;
      else break;
    }
    out.push({
      platform,
      weight: 0,
      recentN: recent.length,
      baselineN: base.length,
      recentFrom: recent[recent.length - 1]?.publishedOn ?? null,
      recentTo: recent[0]?.publishedOn ?? null,
      viewScoreRecent: median(recent.map((v) => v.viewScore)) ?? 0,
      viewScoreBase: vBase,
      engScoreRecent: median(recent.map((v) => v.engScore)) ?? 0,
      engScoreBase: eBase,
      retentionRecent: rRecent.length >= 3 ? median(rRecent) : null,
      retentionBase: rBase.length >= 4 ? median(rBase) : null,
      medianViewsRecent: median(recent.map((v) => v.views)) ?? 0,
      medianViewsBase: median(base.map((v) => v.views)) ?? 0,
      belowCount: recent.filter((v) => v.viewScore < vBase).length,
      aboveCount: recent.filter((v) => v.viewScore > vBase).length,
      streak,
    });
    // Gewicht = aandeel in de weergaven van de basisperiode.
    (out[out.length - 1] as PlatformStats & { _baseViews?: number })._baseViews = base.reduce((a, v) => a + v.views, 0);
  }
  const total = out.reduce((a, s) => a + ((s as PlatformStats & { _baseViews?: number })._baseViews ?? 0), 0);
  for (const s of out) {
    const bv = (s as PlatformStats & { _baseViews?: number })._baseViews ?? 0;
    s.weight = total > 0 ? Math.round((bv / total) * 100) / 100 : 1 / out.length;
    delete (s as PlatformStats & { _baseViews?: number })._baseViews;
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/* ------------------------------------------------------------------ *
 * Signalen
 * ------------------------------------------------------------------ */

function platformFindings(s: PlatformStats): Finding[] {
  const f: Finding[] = [];
  const pl = platformName(s.platform);
  const window = `De laatste ${s.recentN} video's op ${pl}`;
  const vs = `de ${s.baselineN} video's daarvoor`;

  const dv = rel(s.viewScoreRecent, s.viewScoreBase);
  if (dv <= VIEWS_ORANJE && s.belowCount >= 3) {
    f.push({
      key: "bereik",
      level: dv <= VIEWS_ROOD ? "rood" : "oranje",
      platform: s.platform,
      headline: `Bereik daalt met ${pctTxt(dv)}`,
      metric: `${s.belowCount} van ${s.recentN} video's onder niveau`,
      detail: `${window} behalen doorgaans ${pctTxt(dv)} minder weergaven dan ${vs} (${nl(s.medianViewsRecent)} tegenover ${nl(s.medianViewsBase)} per video). ${s.belowCount} van de ${s.recentN} zitten onder het eigen niveau.`,
      deltaPct: pct(dv),
    });
  } else if (dv >= GROWTH_GROEN && s.aboveCount >= 3) {
    f.push({
      key: "groei",
      level: "groen",
      platform: s.platform,
      headline: `Bereik stijgt met ${pctTxt(dv)}`,
      metric: `${nl(s.medianViewsRecent)} i.p.v. ${nl(s.medianViewsBase)} weergaven per video`,
      detail: `${window} behalen doorgaans ${pctTxt(dv)} meer weergaven dan ${vs} (${nl(s.medianViewsRecent)} tegenover ${nl(s.medianViewsBase)} per video). ${s.aboveCount} van de ${s.recentN} zitten boven het eigen niveau.`,
      deltaPct: pct(dv),
    });
  }

  if (s.streak >= STREAK_ORANJE) {
    f.push({
      key: "reeks",
      level: s.streak >= STREAK_ROOD ? "rood" : "oranje",
      platform: s.platform,
      headline: `${s.streak} video's op rij onder niveau`,
      metric: `laatste ${s.streak} video's`,
      detail: `De laatste ${s.streak} video's op ${pl} presteren allemaal duidelijk onder het gebruikelijke niveau van deze klant (weergaven en interactie samen minder dan 80% van normaal).`,
      deltaPct: null,
    });
  }

  if (s.retentionRecent != null && s.retentionBase != null && s.retentionBase > 0) {
    const dr = rel(s.retentionRecent, s.retentionBase);
    if (dr <= RET_ORANJE) {
      f.push({
        key: "retentie",
        level: dr <= RET_ROOD ? "rood" : "oranje",
        platform: s.platform,
        headline: `Kijkretentie daalt met ${pctTxt(dr)}`,
        metric: `${pct(s.retentionRecent)}% i.p.v. ${pct(s.retentionBase)}% bekeken`,
        detail: `Kijkers zien op ${pl} recent gemiddeld ${pct(s.retentionRecent)}% van de video, tegenover ${pct(s.retentionBase)}% bij ${vs}. Ze haken dus eerder af.`,
        deltaPct: pct(dr),
      });
    }
  }

  const de = rel(s.engScoreRecent, s.engScoreBase);
  if (de <= ENG_ORANJE && s.engScoreBase > 0) {
    f.push({
      key: "interactie",
      level: de <= ENG_ROOD ? "rood" : "oranje",
      platform: s.platform,
      headline: `Interactie daalt met ${pctTxt(de)}`,
      metric: `per weergave, laatste ${s.recentN} video's`,
      detail: `${window} krijgen naar verhouding ${pctTxt(de)} minder likes, reacties, shares en saves per weergave dan ${vs}.`,
      deltaPct: pct(de),
    });
  } else if (de >= ENG_GROEN && s.aboveCount >= 2) {
    f.push({
      key: "groei",
      level: "groen",
      platform: s.platform,
      headline: `Interactie stijgt met ${pctTxt(de)}`,
      metric: `per weergave, laatste ${s.recentN} video's`,
      detail: `${window} krijgen naar verhouding ${pctTxt(de)} meer likes, reacties, shares en saves per weergave dan ${vs}.`,
      deltaPct: pct(de),
    });
  }
  return f;
}

/* ------------------------------------------------------------------ *
 * Contentgeheugen: wat werkte eerder het best?
 * ------------------------------------------------------------------ */

type Best = {
  format: AlertGroup | null;
  weakFormat: AlertGroup | null;
  hook: AlertGroup | null;
  cta: AlertGroup | null;
  length: AlertGroup | null;
  topHooks: string[];
  topTopics: string[];
  /** Meest voorkomende format onder de 5 best presterende video's (zonder bewijsniveau). */
  topFormat: string | null;
};

function bestOf(input: AlertInput): Best {
  const better = (gs: AlertGroup[]) => gs.filter((g) => g.verdict === "beter" && solid(g.evidence) && g.n >= 3).sort((a, b) => b.medianPerf - a.medianPerf)[0] ?? null;
  const sortedPerf = [...input.videos].sort((a, b) => b.perf - a.perf);
  const seen = new Set<string>();
  const topHooks: string[] = [];
  for (const v of sortedPerf) {
    const h = v.hook?.trim();
    if (!h || h.length < 12 || seen.has(h.toLowerCase())) continue;
    seen.add(h.toLowerCase());
    topHooks.push(h);
    if (topHooks.length === 3) break;
  }
  const seenT = new Set<string>();
  const topTopics: string[] = [];
  for (const v of [...input.videos].sort((a, b) => b.engScore * Math.max(1, b.interactions) - a.engScore * Math.max(1, a.interactions))) {
    const t = v.title?.trim();
    if (!t || seenT.has(t.toLowerCase())) continue;
    seenT.add(t.toLowerCase());
    topTopics.push(t);
    if (topTopics.length === 3) break;
  }
  const fc = new Map<string, number>();
  for (const v of sortedPerf.slice(0, 5)) if (v.format) fc.set(v.format, (fc.get(v.format) ?? 0) + 1);
  const topFormat = [...fc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    topFormat,
    format: better(input.formats),
    weakFormat: input.formats.filter((g) => g.verdict === "slechter" && solid(g.evidence) && g.n >= 3).sort((a, b) => a.medianPerf - b.medianPerf)[0] ?? null,
    hook: better(input.hooks),
    cta: better(input.ctas),
    length: better(input.lengths),
    topHooks,
    topTopics,
  };
}

const x = (n: number) => `${n.toFixed(1).replace(".", ",")}x`;

/** Hooktype als leesbare zinsnede: "openen met een vraag". */
const HOOK_PHRASE: Record<string, string> = {
  Vraag: "een vraag",
  Prijs: "een prijs",
  Getal: "een getal",
  Nieuwsgierigheid: "nieuwsgierigheid",
  "Spreekt kijker aan": "een directe aanspreking van de kijker",
  Rondleiding: "een rondleiding",
  Stelling: "een stelling",
};
export const hookPhrase = (t: string) => HOOK_PHRASE[t] ?? t.toLowerCase();

/** De vaste contentgeheugen-blokken bij elke alert. */
function memoryInsights(input: AlertInput, best: Best, differences: string[]): MemoryInsight[] {
  const goodFormats = input.formats.filter((g) => g.verdict === "beter" && g.n >= 2).slice(0, 3);
  return [
    { key: "hooks", label: "Hooks die eerder het best werkten", items: best.topHooks.map((h) => `"${h}"`) },
    {
      key: "formats",
      label: "Formats met structureel goede resultaten",
      items: goodFormats.map((g) => `${g.label} (${x(g.medianPerf)} normaal, ${g.n} video's${solid(g.evidence) ? "" : ", nog verkennend"})`),
      note: goodFormats.length ? undefined : input.formats.length ? "Nog geen format dat aantoonbaar beter werkt." : "Formats worden nog herkend door het Contentgeheugen.",
    },
    {
      key: "lengte",
      label: "Ideale videolengte",
      items: best.length ? [`${best.length.label} (${x(best.length.medianPerf)} normaal, ${best.length.n} video's)`] : [],
      note: best.length ? undefined : "Nog geen lengte die aantoonbaar beter werkt.",
    },
    { key: "onderwerpen", label: "Onderwerpen met de meeste interactie", items: best.topTopics },
    {
      key: "cta",
      label: "Call to actions die beter presteerden",
      items: best.cta ? [`${best.cta.label}${best.cta.examples[0]?.ctaText ? `, bijvoorbeeld: "${best.cta.examples[0].ctaText}"` : ""}`] : [],
      note: best.cta ? undefined : "Nog geen call to action die aantoonbaar beter werkt.",
    },
    { key: "filmstijl", label: "Manieren van filmen", items: [], note: "Filmstijl wordt nog niet per video vastgelegd, dus hier is geen data voor." },
    { key: "verschil", label: "Wat doen we nu anders dan bij succesvolle video's?", items: differences, note: differences.length ? undefined : "Geen duidelijk verschil gevonden in format, lengte, hook of call to action." },
  ];
}

/* ------------------------------------------------------------------ *
 * Oorzaken, advies en acties
 * ------------------------------------------------------------------ */

function diagnose(input: AlertInput, affected: PlatformStats[], findings: Finding[], best: Best) {
  const causes: Cause[] = [];
  const differences: string[] = [];
  /** Formats die bij deze klant aantoonbaar minder (gaan) werken: niet opnieuw adviseren. */
  const weak: string[] = [];
  const recentAll = affected.flatMap((s) => byPlatform(input.videos).get(s.platform)?.slice(0, RECENT_N) ?? []);
  const baseAll = affected.flatMap((s) => byPlatform(input.videos).get(s.platform)?.slice(RECENT_N, RECENT_N + BASELINE_MAX) ?? []);
  const has = (k: FindingKey) => findings.some((f) => f.key === k);
  let focus: "hook" | "lengte" | "format" | "cta" | "frequentie" | "platform" | "algemeen" = "algemeen";

  // 1. Retentie: kijkers haken eerder af → opening/hook.
  const ret = findings.find((f) => f.key === "retentie");
  if (ret) {
    const pl = ret.platform ? affected.find((s) => s.platform === ret.platform) : null;
    causes.push({
      kind: "onderbouwd",
      label: "Kijkers haken eerder af",
      text: pl && pl.retentionRecent != null && pl.retentionBase != null
        ? `Lagere kijkretentie: kijkers zien recent ${pct(pl.retentionRecent)}% van de video, eerder ${pct(pl.retentionBase)}%. Afhaken begint meestal bij een zwakkere opening in de eerste seconden.`
        : "Lagere kijkretentie: kijkers haken eerder af. Dat begint meestal bij een zwakkere opening in de eerste seconden.",
    });
    focus = "hook";
  }

  // 2. Videolengte.
  const dRecent = median(recentAll.map((v) => v.durationSeconds ?? NaN).filter((n) => n > 0));
  const dBase = median(baseAll.map((v) => v.durationSeconds ?? NaN).filter((n) => n > 0));
  if (dRecent != null && dBase != null && dBase > 0 && Math.abs(rel(dRecent, dBase)) >= 0.25) {
    const bucket = lengthBucket(dRecent);
    const g = input.lengths.find((l) => l.label === bucket);
    const longer = dRecent > dBase;
    const txt = `Recente video's zijn ${longer ? "langer" : "korter"} dan voorheen: ${sec(dRecent)} tegenover ${sec(dBase)}.`;
    if (g && g.verdict === "slechter" && solid(g.evidence)) {
      causes.push({ kind: "onderbouwd", label: longer ? "Te lange video's" : "Te korte video's", text: `${txt} Video's van ${g.label.toLowerCase()} presteren bij deze klant aantoonbaar minder (${x(g.medianPerf)} normaal, ${g.n} video's).` });
      if (focus === "algemeen") focus = "lengte";
    } else {
      causes.push({ kind: "hypothese", label: longer ? "Langere video's" : "Kortere video's", text: `${txt} Nog niet bewezen dat dit het verschil maakt; test het door de lengte weer gelijk te trekken.` });
    }
    if (best.length && best.length.label !== bucket) differences.push(`Lengte: nu ${bucket?.toLowerCase() ?? sec(dRecent)}, het best werkt ${best.length.label.toLowerCase()}.`);
  }

  // 3. Format.
  const recentFormats = recentAll.map((v) => v.format).filter((f): f is string => !!f);
  if (recentFormats.length >= 2) {
    const counts = new Map<string, number>();
    for (const f of recentFormats) counts.set(f, (counts.get(f) ?? 0) + 1);
    const [dominant] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const g = input.formats.find((f) => f.label === dominant);
    if (g && g.verdict === "slechter" && solid(g.evidence)) {
      weak.push(dominant);
      causes.push({ kind: "onderbouwd", label: "Zwak format", text: `Minder succesvol format: de recente video's zijn vooral "${dominant}", en dat format presteert bij deze klant onder het normale niveau (${x(g.medianPerf)} normaal, ${g.n} video's).` });
      if (focus === "algemeen") focus = "format";
    } else if (g && g.trend === "zwakker" && solid(g.evidence)) {
      weak.push(dominant);
      causes.push({ kind: "onderbouwd", label: "Format slijt", text: `Het format "${dominant}" werkt minder goed dan eerder: de laatste helft van deze video's presteert duidelijk zwakker dan de eerste helft.` });
      if (focus === "algemeen") focus = "format";
    }
    if (best.format && !recentFormats.includes(best.format.label)) {
      differences.push(`Format: het best presterende format "${best.format.label}" zat niet in de laatste video's.`);
      causes.push({ kind: "hypothese", label: "Topformat niet gebruikt", text: `Het best presterende format "${best.format.label}" (${x(best.format.medianPerf)} normaal) is in de laatste video's niet gebruikt. Of dat de daling verklaart moet een test uitwijzen.` });
      if (focus === "algemeen") focus = "format";
    }
  }

  // 4. Hooktype.
  if (best.hook) {
    const share = (vs: AlertVideo[]) => (vs.length ? vs.filter((v) => v.hookTypes.includes(best.hook!.label)).length / vs.length : 0);
    const sR = share(recentAll), sB = share(baseAll);
    if (sB >= 0.3 && sR <= sB / 2) {
      const lbl = hookPhrase(best.hook.label);
      differences.push(`Hook: eerder opende ${pct(sB)}% van de video's met ${lbl}, recent ${pct(sR)}%.`);
      causes.push({ kind: "hypothese", label: "Andere openingen", text: `Minder video's openen met ${lbl}, terwijl dat bij deze klant het best werkt (${x(best.hook.medianPerf)} normaal). Eerder ${pct(sB)}% van de video's, recent ${pct(sR)}%.` });
      if (focus === "algemeen") focus = "hook";
    }
  }

  // 5. Call to action bij dalende interactie.
  if (has("interactie") && best.cta) {
    const sR = recentAll.filter((v) => v.cta === best.cta!.label).length;
    if (sR === 0) {
      differences.push(`Call to action: "${best.cta.label}" werkt het best maar zat niet in de laatste video's.`);
      causes.push({ kind: "hypothese", label: "Andere call to action", text: `Minder interactie terwijl de best werkende call to action ("${best.cta.label}") recent niet is gebruikt.` });
      if (focus === "algemeen") focus = "cta";
    }
  }

  // 6. Publicatiefrequentie.
  if (input.posts.prev >= 4 && input.posts.cur < input.posts.prev * 0.6) {
    causes.push({ kind: "onderbouwd", label: "Minder gepubliceerd", text: `Er is minder gepubliceerd: ${input.posts.cur} posts in de afgelopen 30 dagen tegenover ${input.posts.prev} in de 30 dagen daarvoor. Minder video's betekent minder kansen op bereik.` });
    if (focus === "algemeen") focus = "frequentie";
  }

  // 7. Alleen één platform zakt.
  if (has("platform") && focus === "algemeen") focus = "platform";

  if (!causes.length) {
    causes.push({ kind: "hypothese", label: "Geen duidelijke oorzaak", text: "De eigen data wijst geen duidelijke oorzaak aan (format, lengte, hook, call to action en frequentie zijn vergelijkbaar). Mogelijk spelen onderwerpkeuze, seizoen of het algoritme mee." });
  }
  return { causes, differences, focus, weak };
}

function adviceAndActions(focus: string, best: Best, findings: Finding[], affected: PlatformStats[], weak: string[] = []): { advice: string; adviceShort: string; actions: string[] } {
  const okFormat = best.format && !weak.includes(best.format.label) ? best.format.label : null;
  const okTop = best.topFormat && !weak.includes(best.topFormat) ? best.topFormat : null;
  const fmt = okFormat
    ? `het format "${okFormat}"`
    : okTop
      ? `het format "${okTop}" van de best presterende video's`
      : weak.length
        ? "een ander format dat eerder aantoonbaar goed werkte (zie Contentgeheugen)"
        : "het format van de best presterende video's (zie Contentgeheugen)";
  const hookEx = best.topHooks[0] ? ` in de stijl van ${best.topHooks[0].startsWith('"') ? best.topHooks[0] : `"${best.topHooks[0]}"`}` : "";
  let advice: string;
  const fmtShort = okFormat ?? okTop;
  const pf = findings.find((f) => f.key === "platform")?.platform;
  const shortMap: Record<string, string> = {
    hook: `3 hooks${best.hook ? ` met ${hookPhrase(best.hook.label)}` : ""} testen`,
    lengte: best.length ? `Video's ${best.length.label.toLowerCase()}` : "Video's korter maken",
    format: fmtShort ? `2x ${fmtShort} plannen` : "Bewezen format terug",
    cta: best.cta ? `Afsluiten: ${best.cta.label.toLowerCase()}` : "Afsluiten met een vraag",
    frequentie: "Weer vaker posten",
    platform: pf ? `${platformName(pf)} checken` : "Publicatie checken",
    algemeen: fmtShort ? `${fmtShort} + 3 hooks` : "Bewezen format + 3 hooks",
  };
  const adviceShort = shortMap[focus] ?? shortMap.algemeen;
  switch (focus) {
    case "hook":
      advice = best.hook
        ? `Zet bij de volgende opnamesessie ${fmt} in en test drie nieuwe openingshooks die openen met ${hookPhrase(best.hook.label)}${hookEx}.`
        : `Zet bij de volgende opnamesessie ${fmt} in en test drie nieuwe, directere openingshooks${hookEx}.`;
      break;
    case "lengte":
      advice = best.length
        ? `Houd de volgende video's ${best.length.label.toLowerCase()}; dat werkt bij deze klant aantoonbaar het best.`
        : "Trek de videolengte weer gelijk met de video's van voor de daling en kort de middenstukken in.";
      break;
    case "format":
      advice = `Plan voor de volgende opnamedag minimaal twee video's in ${fmt} en test daarnaast drie nieuwe openingshooks.`;
      break;
    case "cta":
      advice = best.cta
        ? `Sluit de volgende video's af met een call to action van het type "${best.cta.label}"${best.cta.examples[0]?.ctaText ? `, zoals: "${best.cta.examples[0].ctaText}"` : ""}.`
        : "Sluit de volgende video's af met één duidelijke vraag aan de kijker, zodat reageren laagdrempelig is.";
      break;
    case "frequentie":
      advice = `Breng de publicatiefrequentie terug op het oude niveau en vul de contentplanning met video's in ${fmt}.`;
      break;
    case "platform": {
      const pf = findings.find((f) => f.key === "platform")?.platform;
      advice = `Controleer de publicatie op ${pf ? platformName(pf) : "het dalende platform"} (tijdstip, cover en caption) en test daar ${fmt} met een nieuwe openingshook.`;
      break;
    }
    default:
      advice = `Herhaal ${fmt} bij de volgende opnamesessie en test drie nieuwe openingshooks${hookEx}.`;
  }

  const actions = ["Bespreek de tegenvallende resultaten tijdens het scriptingoverleg."];
  if (focus === "hook" || findings.some((f) => f.key === "retentie")) actions.push(`Analyseer de eerste drie seconden van de laatste ${RECENT_N} video's.`);
  actions.push("Ontwikkel drie alternatieve hooks (zie de hooks in het Contentgeheugen).");
  actions.push(`Plan voor de volgende opnamedag twee video's ${okFormat ? `in het format "${okFormat}"` : "met een bewezen succesvol format"}.`);
  if (focus === "lengte" || best.length) actions.push(`Vergelijk de videolengte met de best presterende video's${best.length ? ` (ideaal: ${best.length.label.toLowerCase()})` : ""}.`);
  if (focus === "platform") {
    const pf = findings.find((f) => f.key === "platform")?.platform;
    if (pf) actions.push(`Controleer tijdstip, cover en caption van de laatste posts op ${platformName(pf)}.`);
  }
  if (affected.length > 1) actions.push("Kijk per platform welke video's het meest achterblijven (Bekijk resultaten).");
  actions.push("Stem de bevindingen af met de verantwoordelijke projectmanager.");
  return { advice, adviceShort, actions: [...new Set(actions)].slice(0, 6) };
}

/* ------------------------------------------------------------------ *
 * Hoofdfunctie
 * ------------------------------------------------------------------ */

export function analyzeClient(input: AlertInput): Analysis {
  const now = input.now ?? new Date();
  const all = platformStats(input.videos);
  // Alleen platforms met echt recente video's.
  const stats = all.filter((s) => s.recentTo && days(s.recentTo, now) <= MAX_RECENT_AGE_DAYS);
  const videoCount = input.videos.length;

  if (!stats.length) {
    const why = all.length
      ? `Geen video's gepubliceerd in de afgelopen ${MAX_RECENT_AGE_DAYS} dagen.`
      : videoCount
        ? `${videoCount} gemeten video's; per platform zijn er minimaal ${MIN_PLATFORM_VIDEOS} nodig (video's jonger dan 7 dagen tellen nog niet mee).`
        : input.publicationCount
          ? "Nog geen video's met bruikbare cijfers (te jong of geen video)."
          : "Nog geen gepubliceerde video's met cijfers uit Metricool.";
    return { status: "onvoldoende", reason: why, videoCount, stats: all };
  }

  const best = bestOf(input);
  const relevant = stats.filter((s) => s.weight >= MIN_PLATFORM_WEIGHT || stats.length === 1);
  const perPlatform = relevant.flatMap(platformFindings);
  const negatives = perPlatform.filter((f) => f.level !== "groen");
  const positives = perPlatform.filter((f) => f.level === "groen");

  // Verschil tussen platformen: één platform zakt terwijl een ander het goed doet.
  if (relevant.length >= 2) {
    const drops = relevant.filter((s) => rel(s.viewScoreRecent, s.viewScoreBase) <= -0.3 && s.belowCount >= 3);
    const fine = relevant.filter((s) => rel(s.viewScoreRecent, s.viewScoreBase) >= 0);
    if (drops.length === 1 && fine.length >= 1) {
      const d = drops[0];
      negatives.push({
        key: "platform",
        level: "oranje",
        platform: d.platform,
        headline: `Alleen ${platformName(d.platform)} zakt`,
        metric: `${platformName(d.platform)} ${pct(rel(d.viewScoreRecent, d.viewScoreBase))}%, rest stabiel`,
        detail: `Op ${platformName(d.platform)} dalen de weergaven met ${pctTxt(rel(d.viewScoreRecent, d.viewScoreBase))}, terwijl ${fine.map((s) => platformName(s.platform)).join(" en ")} stabiel of beter presteert. Het probleem zit dus waarschijnlijk niet in de video zelf maar in het platform.`,
        deltaPct: pct(rel(d.viewScoreRecent, d.viewScoreBase)),
      });
    }
  }

  // Volgersgroei.
  if (input.followers && input.followers.prev >= FOLLOW_MIN_PREV && input.followers.cur <= input.followers.prev * 0.5) {
    const d = rel(input.followers.cur, input.followers.prev);
    negatives.push({
      key: "volgers",
      level: "oranje",
      platform: null,
      headline: `Volgersgroei ${input.followers.cur < 0 ? "negatief" : `daalt met ${pctTxt(d)}`}`,
      metric: `${input.followers.cur >= 0 ? "+" : ""}${nl(input.followers.cur)} i.p.v. +${nl(input.followers.prev)} in 30 dagen`,
      detail: `Afgelopen 30 dagen ${input.followers.cur >= 0 ? "+" : ""}${nl(input.followers.cur)} volgers, tegenover +${nl(input.followers.prev)} in de 30 dagen daarvoor.`,
      deltaPct: pct(d),
    });
  }

  // Format of hook dat zwakker werkt dan voorheen (en recent nog gebruikt wordt).
  const recentVideos = relevant.flatMap((s) => byPlatform(input.videos).get(s.platform)?.slice(0, RECENT_N) ?? []);
  for (const g of [...input.formats, ...input.hooks]) {
    if (g.trend !== "zwakker" || !solid(g.evidence) || g.n < 4) continue;
    const usedVideos = recentVideos.filter((v) => (g.dimension === "format" ? v.format === g.label : v.hookTypes.includes(g.label)));
    const used = usedVideos.length;
    // Alleen als het recente gebruik ook echt tegenvalt.
    if (used < 2 || (median(usedVideos.map((v) => v.perf)) ?? 1) >= 0.9) continue;
    negatives.push({
      key: "format",
      level: "oranje",
      platform: null,
      headline: g.dimension === "format" ? `Format "${g.label}" werkt minder` : `Openen met ${hookPhrase(g.label)} werkt minder`,
      metric: `recent ${used}x gebruikt`,
      detail: `${g.dimension === "format" ? `Het format "${g.label}"` : `Openen met ${hookPhrase(g.label)}`} presteerde eerder goed, maar de recentere video's ermee scoren duidelijk lager. In de laatste video's is het nog ${used} keer gebruikt.`,
      deltaPct: null,
    });
    break;
  }

  /* ---------- Negatieve alert ---------- */
  // Zachte signalen (volgers, een format dat zwakker wordt) geven geen eigen
  // waarschuwing als het bereik tegelijk duidelijk groeit: dan gaan ze als
  // aandachtspunt mee in de analyse, niet als tegenstrijdige alert.
  const HARD: FindingKey[] = ["bereik", "reeks", "retentie", "interactie", "platform"];
  const growing = positives.some((f) => f.key === "groei");
  const hasHard = negatives.some((f) => HARD.includes(f.key));
  let negative: AlertDraft | null = null;
  if (negatives.length && (hasHard || !growing)) {
    // Bepaal het niveau. Rood als het aanzienlijk is op een belangrijk platform,
    // of als meerdere platforms tegelijk achterblijven.
    const weightOf = (p: string | null) => (p ? stats.find((s) => s.platform === p)?.weight ?? 0 : 1);
    const hardPlatforms = new Set(negatives.filter((f) => f.platform && ["bereik", "reeks", "retentie", "interactie"].includes(f.key)).map((f) => f.platform!));
    let level: Level = worst(negatives.map((f) => f.level)) ?? "oranje";
    if (level === "rood" && !negatives.some((f) => f.level === "rood" && weightOf(f.platform) >= 0.35) && hardPlatforms.size < 2) level = "oranje";
    if (level === "oranje" && hardPlatforms.size >= 2 && negatives.some((f) => f.key === "bereik" || f.key === "reeks")) level = "rood";
    // Eén losse oranje bijzaak (alleen volgers) is geen alert waard.
    if (negatives.length === 1 && negatives[0].key === "volgers") level = "oranje";

    const ordered = [...negatives].sort((a, b) => rank(b.level) - rank(a.level) || weightOf(b.platform) - weightOf(a.platform));
    const head = ordered[0];
    const affected = relevant.filter((s) => hardPlatforms.has(s.platform));
    const { causes, differences, focus, weak } = diagnose(input, affected.length ? affected : relevant.slice(0, 1), ordered, best);
    const { advice, adviceShort, actions } = adviceAndActions(focus, best, ordered, affected, weak);
    negative = {
      kind: "negatief",
      level,
      headline: head.headline + (head.platform && relevant.length > 1 ? ` op ${platformName(head.platform)}` : ""),
      findings: ordered,
      causes: [...causes].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "onderbouwd" ? -1 : 1)),
      advice,
      adviceShort,
      actions,
      memory: memoryInsights(input, best, differences),
      platforms: [...new Set(ordered.map((f) => f.platform).filter((p): p is string => !!p))],
      snapshot: snapshotOf(relevant, now),
    };
  }

  /* ---------- Positieve alert ---------- */
  let positive: AlertDraft | null = null;
  const pos = [...positives];
  // Succesvol format dat we vaker kunnen inzetten: sterk onderbouwd, maar recent niet gebruikt.
  if (best.format && best.format.evidence === "sterk") {
    const usedRecently = input.videos
      .filter((v) => v.publishedOn)
      .sort((a, b) => (b.publishedOn! > a.publishedOn! ? 1 : -1))
      .slice(0, 8)
      .some((v) => v.format === best.format!.label);
    if (!usedRecently) {
      pos.push({
        key: "succes",
        level: "groen",
        platform: null,
        headline: `Succesvol format vaker inzetten`,
        metric: `${x(best.format.medianPerf)} normaal, niet in laatste 8 posts`,
        detail: `"${best.format.label}" presteert structureel ${x(best.format.medianPerf)} boven normaal (${best.format.n} video's, sterk onderbouwd), maar zat niet in de laatste 8 publicaties.`,
        deltaPct: null,
      });
    }
  }
  if (pos.length && !(negative && negative.level === "rood")) {
    const head = pos.find((f) => f.key === "groei") ?? pos[0];
    const growthPlatforms = relevant.filter((s) => pos.some((f) => f.platform === s.platform));
    const recentTop = growthPlatforms.flatMap((s) => byPlatform(input.videos).get(s.platform)?.slice(0, RECENT_N) ?? []).sort((a, b) => b.perf - a.perf);
    const driver = recentTop[0];
    const causes: Cause[] = [];
    if (driver) {
      const what = [driver.format ? `format "${driver.format}"` : null, driver.hookTypes[0] ? `opening met ${hookPhrase(driver.hookTypes[0])}` : null].filter(Boolean).join(" en ");
      causes.push({ kind: "onderbouwd", label: "Sterke recente video", text: `Sterkste recente video: "${driver.title}" (${x(driver.perf)} normaal)${what ? `, ${what}` : ""}.` });
      if (driver.format) causes.push({ kind: "hypothese", label: "Format draagt groei", text: `Het format "${driver.format}" draagt mogelijk de groei. Bevestig dat door het de komende sessie vaker in te zetten.` });
    }
    if (head.key === "succes" && best.format) causes.push({ kind: "onderbouwd", label: "Topformat onbenut", text: head.detail });
    const fmt = head.key === "succes" && best.format ? best.format.label : driver?.format ?? best.format?.label ?? null;
    positive = {
      kind: "positief",
      level: "groen",
      headline: head.headline + (head.platform && relevant.length > 1 ? ` op ${platformName(head.platform)}` : ""),
      findings: pos,
      causes,
      advice: fmt ? `Zet het format "${fmt}" vaker in: plan bij de volgende opnamesessie minimaal twee video's in dit format.` : "Houd vast aan de huidige aanpak en leg vast wat er in de recente video's anders was.",
      adviceShort: fmt ? `Vaker: ${fmt}` : "Aanpak vasthouden",
      actions: [
        "Leg in het scriptingoverleg vast wat de recente video's anders deden.",
        fmt ? `Plan twee nieuwe video's in het format "${fmt}".` : "Plan twee nieuwe video's in dezelfde stijl als de recente toppers.",
        "Deel het resultaat met de klant bij het volgende contactmoment.",
      ],
      memory: memoryInsights(input, best, []),
      platforms: [...new Set(pos.map((f) => f.platform).filter((p): p is string => !!p))],
      snapshot: snapshotOf(relevant, now),
    };
  }

  // Onderdrukte zachte signalen gaan als aandachtspunt mee in de positieve alert.
  if (positive && !negative && negatives.length) positive.findings.push(...negatives);

  return { status: "ok", stats, negative, positive, videoCount };
}

function snapshotOf(stats: PlatformStats[], now: Date): Snapshot {
  return {
    measuredAt: now.toISOString(),
    platforms: stats.map((s) => ({
      platform: s.platform,
      viewScoreRecent: s.viewScoreRecent,
      viewScoreBase: s.viewScoreBase,
      engScoreRecent: s.engScoreRecent,
      engScoreBase: s.engScoreBase,
      retentionRecent: s.retentionRecent,
      retentionBase: s.retentionBase,
      medianViewsRecent: s.medianViewsRecent,
      medianViewsBase: s.medianViewsBase,
      recentTo: s.recentTo,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Effectmeting na een verbeteractie
 * ------------------------------------------------------------------ */

export const EFFECT_MIN_VIDEOS = 3;

export type Effect = {
  status: "wachten" | "gemeten";
  /** Aantal gemeten video's na de actie (op de betrokken platforms). */
  videosAfter: number;
  needed: number;
  verdict: "verbeterd" | "gelijk" | "verslechterd" | null;
  /** Mediaan score t.o.v. normaal: tijdens het probleem en na de actie. */
  before: number | null;
  after: number | null;
  changePct: number | null;
  retentionBefore: number | null;
  retentionAfter: number | null;
  videos: Array<{ id: string; title: string; platform: string; publishedOn: string; perf: number; views: number }>;
  measuredAt: string;
};

/**
 * Vergelijkt de video's die ná de actiedatum zijn gepubliceerd met het niveau
 * tijdens het probleem (snapshot). Telt alle nieuwe video's op de betrokken
 * platforms; het systeem kan niet zien welke video specifiek voor de actie is
 * gemaakt, dat staat er eerlijk bij.
 */
export function measureEffect(videos: AlertVideo[], snapshot: Snapshot, platforms: string[], actionAt: Date, now: Date = new Date()): Effect {
  const pls = platforms.length ? platforms : snapshot.platforms.map((p) => p.platform);
  const from = actionAt.toISOString().slice(0, 10);
  const after = videos
    .filter((v) => v.publishedOn && v.publishedOn > from && pls.includes(v.platform))
    .sort((a, b) => (a.publishedOn! < b.publishedOn! ? -1 : 1));
  const snaps = snapshot.platforms.filter((p) => pls.includes(p.platform));
  const before = median(snaps.map((p) => p.viewScoreRecent));
  const base = {
    videosAfter: after.length,
    needed: EFFECT_MIN_VIDEOS,
    videos: after.slice(0, 12).map((v) => ({ id: v.id, title: v.title, platform: v.platform, publishedOn: v.publishedOn!, perf: v.perf, views: v.views })),
    measuredAt: now.toISOString(),
    retentionBefore: median(snaps.map((p) => p.retentionRecent).filter((r): r is number => r != null)),
  };
  if (after.length < EFFECT_MIN_VIDEOS || before == null) {
    return { ...base, status: "wachten", verdict: null, before, after: null, changePct: null, retentionAfter: null };
  }
  const a = median(after.map((v) => v.viewScore)) ?? 0;
  const ch = before > 0 ? a / before - 1 : 0;
  const rA = after.map((v) => v.retention).filter((r): r is number => r != null && r > 0);
  return {
    ...base,
    status: "gemeten",
    before,
    after: a,
    changePct: pct(ch),
    retentionAfter: rA.length >= 2 ? median(rA) : null,
    verdict: ch >= 0.2 ? "verbeterd" : ch <= -0.2 ? "verslechterd" : "gelijk",
  };
}

export const EFFECT_LABEL: Record<NonNullable<Effect["verdict"]>, string> = {
  verbeterd: "Verbeterd",
  gelijk: "Geen duidelijk effect",
  verslechterd: "Verslechterd",
};
