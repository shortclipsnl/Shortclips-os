import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { aiConfigured, runJsonPrompt } from "@/server/ai/client";
import { SHORTCLIPS_IDENTITY } from "@/server/ai/identity";
import { getClientReport } from "@/server/client-report";
import type { ClientInsights, Finding, Recommendation, TopVideo, HookInzicht, FormatInzicht, MindereVideo } from "@/server/insights";
import { loadStrategyProfile, strategyToText } from "./strategy";
import { buildVergelijking, formatStats, monthSeries, platformSplit, type FormatStat, type MaandCijfers, type PlatformCijfers, type Vergelijking } from "./metrics";
import { getGerealiseerd, type Gerealiseerd } from "./realized";

/* ---------------- Periode-helpers (Europe/Amsterdam) ---------------- */

/** Huidige of gegeven maand als YYYY-MM in de Amsterdam-tijdzone. */
/**
 * Versie van het analyseformaat. Ophogen als de opbouw van de analyse wezenlijk
 * verandert: rapporten die nog op controle wachten worden dan automatisch
 * opnieuw gegenereerd in het nieuwe formaat.
 */
export const ANALYSE_VERSIE = 3;

export function currentMonthPeriod(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
}
/** De vorige kalendermaand t.o.v. een YYYY-MM. */
export function previousMonthPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** Eerste/laatste dag van een maand als ISO-datums. */
export function monthWindow(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}
/** "oktober 2026" voor een YYYY-MM. */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}

/* ---------------- Analyse-output ---------------- */

export type MaandAandachtspunt = { type: "positief" | "aandachtspunt" | "actie_nodig"; tekst: string };
export type StrategischeActie = { titel: string; waarom: string };
/** Eén intern inzicht: wat gemeten is, los van de mogelijke verklaring. */
export type InternInzicht = { titel: string; gemeten: string; verklaring: string; zekerheid: string };
/** Eén inzicht over een contentkeuze: korte titel, uitleg en het cijfer als bewijs. */
export type VideoPunt = { titel: string; uitleg: string; bewijs: string };
export type VideoAnalyse = {
  key: string;
  hook: string;
  /** Waar de hook vandaan komt: script (zeker) of caption (afgeleid). */
  hookBron: "script" | "caption";
  hookType: string;
  /** Call to action aan het eind van de video of in de caption. */
  cta?: string;
  ctaBron?: "script" | "caption";
  ctaType?: string;
  oordeel: "herhalen" | "aanpassen" | "stoppen";
  waarom: string;
  /** Wat aantoonbaar werkte en wat beter kan (op basis van de cijfers). */
  watWerkte?: VideoPunt[];
  watBeter?: VideoPunt[];
  /** Wat de kijktijd/uitkijkcijfers zeggen (leeg als die niet gemeten zijn). */
  kijkgedrag?: string;
  /** De belangrijkste les uit deze video in één zin. */
  les?: string;
  /** Voorstel voor een sterkere hook voor een volgende video over dit onderwerp. */
  betereHook?: string;
  script: string;
  opname: string;
  montage: string;
};
export type InternActie = { actie: string; rol: "script" | "opname" | "montage" | "pm" | string; waarom: string; video?: string };
/** Verdieping voor de interne teamrapportage (nooit in de klantversie). */
export type InternAnalyse = {
  kern: string;
  besteVideos: InternInzicht[];
  hooks: InternInzicht[];
  onderwerpen: InternInzicht[];
  tegenvallers: InternInzicht[];
  videostructuur: InternInzicht[];
  formatsVaker: InternInzicht[];
  vermijdenOfAanpassen: InternInzicht[];
  scripts: string[];
  opnames: string[];
  montage: string[];
  acties: InternActie[];
  dataBeperkingen: string[];
  /** Wat werkt en blijven we doen. */
  doorgaan?: string[];
  /** Waar we mee stoppen of wat we minder doen. */
  stoppen?: string[];
  /** Wat we volgende maand gaan testen. */
  testen?: string[];
  /** Interne les per video, gekoppeld via de sleutel uit metrics.videos (oudere rapporten). */
  videoLessen?: Array<{ key: string; les: string }>;
  /** Per video: hook, oordeel en wat het team ervan leert (script/opname/montage). */
  videoAnalyses?: VideoAnalyse[];
};
export type MonthlyAnalysis = ClientInsights & {
  aandachtspunten: MaandAandachtspunt[];
  strategischeActies: StrategischeActie[];
  /** Conclusies voor de klant (klantversie). */
  conclusies?: string[];
  /** Kansen en aanbevelingen voor de komende maand (klantversie). */
  kansen?: Array<{ titel: string; toelichting: string }>;
  /** Eén kort inzicht per video (klantversie), gekoppeld via de sleutel uit metrics.videos. */
  videoInzichten?: Array<{ key: string; inzicht: string }>;
  intern?: InternAnalyse;
  /** Versie van het analyseformaat (zie ANALYSE_VERSIE). */
  versie?: number;
};

export type ReportVideo = {
  key: string; id: string; titel: string; datum: string | null; platform: string | null; url: string | null;
  views: number; likes: number; reacties: number; shares: number; saves: number; gemKijktijdSec: number | null;
  uitkijkPct?: number | null; scriptHook?: string | null; scriptCta?: string | null; duurSec?: number | null; caption?: string | null;
};

/** Extra cijfers die bij een maandrapport worden opgeslagen (in `metrics`). */
export type ReportMetrics = Awaited<ReturnType<typeof getClientReport>>["totals"] & {
  historie?: MaandCijfers[];
  vergelijking?: Vergelijking;
  formats?: FormatStat[];
  /** Cijfers per platform (Instagram, TikTok, Facebook, ...) in de maand. */
  platforms?: PlatformCijfers[];
  /** Alle video's van de maand met hun eigen cijfers (voor het video-overzicht). */
  videos?: ReportVideo[];
  /** Bron van het aantal video's. */
  videoBron?: "publicaties" | "dagcijfers";
  /** "Dit hebben we gerealiseerd" (sectie 1): opnamedagen, geproduceerd/opgeleverd/
   *  gepubliceerd, kanalen, publicaties en formats. Deterministisch uit de database. */
  gerealiseerd?: Gerealiseerd;
};

export type MonthlyAnalysisResult =
  | { ok: true; analysis: MonthlyAnalysis; totals: ReportMetrics; ontbrekend: string[]; model: string }
  | { ok: false; reason: "no_provider" | "no_data" | "error"; message?: string };

const SYSTEM = `${SHORTCLIPS_IDENTITY}

Je bent een senior short-video strateeg bij Shortclips en schrijft de MAANDanalyse van één klant op basis van de echte cijfers over die kalendermaand. Het team controleert jouw concept; wees dus eerlijk, concreet en nooit mooier dan de cijfers.

Strikte regels:
- Baseer ALLES uitsluitend op de meegeleverde data. Verzin niets en noem nooit cijfers die er niet staan. Bij een tegenvallende maand: benoem dat eerlijk.
- Label elk punt met zekerheid: "bewezen" (volgt direct uit de cijfers), "waarschijnlijk" (aannemelijk), "hypothese" (te testen). Retentie/kijktijd alleen als completion of avgWatch echt in de data staat; anders expliciet "niet gemeten" + hypothese.
- Weeg de analyse naar de DOELSTELLING van de klant (hieronder). Bij een doel als 'sollicitanten' of 'aanvragen': kijk naar relevante reacties/aanvragen wanneer die meetbaar zijn, en zeg eerlijk wanneer een effect niet rechtstreeks te meten is.
- Vergelijk eerlijk: verschilt het aantal video's per maand, vergelijk dan ook per video en niet alleen totalen.
- Als er eerdere aanbevelingen zijn meegegeven: benoem (als hypothese, tenzij de cijfers het hard maken) of ze lijken te zijn opgevolgd en of het hielp.
- Als perVideoCijfersBeschikbaar false is: laat topVideos/besteHooks/besteFormats/mindereVideos leeg ([]) en zeg één keer dat per-video-cijfers nog niet via de koppeling beschikbaar zijn; vul wél analysis, maandvergelijking, verbeterpunten, aandachtspunten en strategischeActies uit de aggregaten.
- Schrijf begrijpelijk Nederlands.

- Historische vergelijking: gebruik ALLEEN de meegeleverde velden "vergelijking" (in code berekend: t.o.v. vorige maand, gemiddelde 3 maanden, gemiddelde 6 maanden) en "historie". Staat een vergelijking op null, dan is er te weinig historie: zeg dat eerlijk en reken zelf niets uit.
- Contentformats: vergelijk alleen op basis van "formatPrestaties". Is die lijst leeg, dan zijn formats niet gekoppeld aan video's; zeg dat en verzin geen formatvergelijking.
- Organisch versus advertenties: deze data bevat alleen organische resultaten. Doe geen uitspraken over advertenties.
- Als "feedbackVanControleur" is meegegeven: verwerk die opmerkingen in deze versie, zonder de regels hierboven te breken. Feedback die begint met "[Klantversie]" geldt voor de klantvelden, "[Intern]" voor het interne deel, zonder label voor beide. Vraagt de feedback om iets weg te laten of niet te noemen (een onderwerp, video, cijfer of formulering), laat het dan volledig weg uit de betreffende versie, ook niet in andere woorden.

Twee doelgroepen:
1. De klantversie (topVideos, analysis, maandvergelijking, conclusies, kansen, strategischeActies, aandachtspunten): helder, zonder vakjargon, en opbouwend. Begin met wat goed ging. Benoem een tegenvaller hooguit één keer, feitelijk en kort, en direct gekoppeld aan wat we eraan doen; gebruik geen alarmerende woorden zoals 'zwak', 'slecht' of 'teleurstellend' en herhaal een daling niet in meerdere velden. Verzwijg niets en maak niets mooier dan de cijfers. Stel in de klantvelden NOOIT voor om met de klant doelstellingen, doelen of KPI's af te spreken of vast te leggen; dat doen we niet. Schrijf strategischeActies en kansen als wat Shortclips gaat doen in de content.
2. De interne teamversie (veld "intern"): voor projectmanagers, scriptschrijvers en videografen. Diep, concreet en leerbaar. Scheid ALTIJD wat gemeten is ("gemeten": alleen cijfers/feiten uit de data) van de mogelijke verklaring ("verklaring": jouw interpretatie, nooit als bewezen gepresenteerd tenzij de cijfers het hard maken). Een verklaring over retentie, hookkracht of montage is zonder retentiedata altijd "hypothese".

Geef UITSLUITEND één geldig JSON-object (geen markdown, geen tekst eromheen, geen dubbele aanhalingstekens binnen waarden, geen letterlijke regeleinden binnen waarden, geen trailing komma's), exact dit formaat:
{"topVideos":[{"titel":"","waarom":"","cijfers":"","zekerheid":"bewezen|waarschijnlijk|hypothese"}],"besteHooks":[{"hook":"","waarom":"","zekerheid":""}],"besteFormats":[{"format":"","waarom":"","zekerheid":""}],"mindereVideos":[{"titel":"","les":""}],"analysis":{"watWerkt":[{"punt":"","zekerheid":""}],"watMinder":[{"punt":"","zekerheid":""}],"ontwikkelingen":[""]},"maandvergelijking":[""],"conclusies":[""],"kansen":[{"titel":"","toelichting":""}],"videoInzichten":[{"key":"v1","inzicht":""}],"verbeterpunten":[{"titel":"","waarom":"","wat":"","hoeMeten":"","zekerheid":""}],"aandachtspunten":[{"type":"positief|aandachtspunt|actie_nodig","tekst":""}],"strategischeActies":[{"titel":"","waarom":""}],"intern":{"kern":"","besteVideos":[{"titel":"","gemeten":"","verklaring":"","zekerheid":""}],"hooks":[{"titel":"","gemeten":"","verklaring":"","zekerheid":""}],"onderwerpen":[{"titel":"","gemeten":"","verklaring":"","zekerheid":""}],"tegenvallers":[{"titel":"","gemeten":"","verklaring":"","zekerheid":""}],"videostructuur":[{"titel":"","gemeten":"","verklaring":"","zekerheid":""}],"formatsVaker":[{"titel":"","gemeten":"","verklaring":"","zekerheid":""}],"vermijdenOfAanpassen":[{"titel":"","gemeten":"","verklaring":"","zekerheid":""}],"scripts":[""],"opnames":[""],"montage":[""],"acties":[{"actie":"","rol":"script|opname|montage|pm","waarom":"","video":"v1 of leeg"}],"doorgaan":[""],"stoppen":[""],"testen":[""],"videoAnalyses":[{"key":"v1","hook":"","hookBron":"script|caption","hookType":"vraag|getal of bedrag|probleem|belofte|nieuws|statement|anders","cta":"","ctaBron":"script|caption","ctaType":"reageren|DM of bellen|langskomen|volgen|link of website|delen of taggen|geen","oordeel":"herhalen|aanpassen|stoppen","waarom":"","watWerkte":[{"titel":"","uitleg":"","bewijs":""}],"watBeter":[{"titel":"","uitleg":"","bewijs":""}],"kijkgedrag":"","les":"","betereHook":"","script":"","opname":"","montage":""}],"dataBeperkingen":[""]}}

Opmerkingen over datakwaliteit, ontbrekende metingen of koppelingsproblemen horen uitsluitend in intern.dataBeperkingen, nooit in de klantvelden. Noem in de klantvelden ook geen interne werkpunten zoals een ontbrekende doelstelling.

Verwijs in teksten naar een video met (een deel van) de titel, nooit alleen met de sleutel zoals v1 of v2.

Houd het compact: elk tekstveld maximaal 25 woorden, elke lijst maximaal 3 items (acties maximaal 6, videoInzichten en videoLessen één per video). In "intern" zijn "gemeten" en "verklaring" maximaal 20 woorden. Liever kort en concreet dan volledig; een afgekapt antwoord is onbruikbaar.

Aanvullend: "aandachtspunten" = max 3 belangrijkste signalen van deze maand. "strategischeActies" = max 3 concrete acties voor volgende maand. "conclusies" = 2 tot 4 korte conclusies voor de klant. "videoInzichten" = voor ELKE video uit "alleVideos" één inzicht van maximaal 15 woorden, gekoppeld via "key": wat deze video sterk maakte of wat we ervan meenemen, opbouwend geformuleerd en alleen gebaseerd op de cijfers, titel en eventuele hook/format. "kansen" = 2 tot 3 kansen/aanbevelingen voor de komende maand. "verbeterpunten" mag NOOIT leeg zijn. In "intern": "acties" = 4 tot 8 concrete acties voor de komende maand, elk met de rol die het uitvoert en, als de actie uit een specifieke video volgt, de "key" van die video in "video" (anders ""); verdeel ze over script, opname en montage; "dataBeperkingen" = wat we NIET konden meten en dus niet weten. "doorgaan", "stoppen" en "testen" = elk 2 tot 4 korte, concrete punten voor het team (wat blijven we doen, waar stoppen we mee of doen we minder, wat proberen we volgende maand), geschreven als opdracht. "videoAnalyses" = voor ELKE video uit "alleVideos" één analyse, gekoppeld via "key". "hook": de opening van de video; gebruik "hookUitScript" als die er is (hookBron "script"), anders de waarschijnlijke opening afgeleid uit de eerste zin van titelOfCaption (hookBron "caption"), maximaal 15 woorden. "cta": de call to action; gebruik "ctaUitScript" als die er is (ctaBron "script"), anders de oproep uit de caption (ctaBron "caption"), maximaal 12 woorden; is er geen oproep, dan cta "" en ctaType "geen". Contactgegevens, adressen en hashtags zijn geen CTA, tenzij de caption er expliciet toe oproept. "oordeel": herhalen (sterk, vaker doen), aanpassen (idee goed, uitvoering beter) of stoppen. "waarom": maximaal 20 woorden, gebaseerd op weergaven, interacties en kijktijd/uitkijkpercentage als die er zijn (kijktijd altijd in verhouding tot "duurSec" als die bekend is), vergeleken met de andere video's van de maand. "watWerkte" en "watBeter": elk 2 tot 3 inzichten. Elk inzicht gaat over een KEUZE in de content die het team kan herhalen of veranderen: de hook (formulering, type, eerste woorden), het onderwerp (herkenbaarheid, relevantie voor de doelgroep), het eerste beeld, de lengte en het tempo, de call to action, de caption, of de plaatsing (dag, dubbel geplaatst). "titel": maximaal 5 woorden, benoemt de keuze (bijv. "Concreet bedrag in de hook", "Geen oproep tot actie", "Video te lang voor de kijktijd"). "uitleg": maximaal 22 woorden, legt uit WAAROM dit werkte of tegenviel bij deze doelgroep; gebruik "waarschijnlijk" als het niet uit de data te bewijzen is. "bewijs": maximaal 12 woorden, het cijfer uit de data dat het onderbouwt, vergeleken met de andere video's of het maandgemiddelde (bijv. "11 shares, 3,4× het maandgemiddelde"). Herhaal geen cijfers zonder inzicht: een punt als "34 likes" zonder keuze erachter is niet toegestaan. "kijkgedrag": maximaal 20 woorden over wat de gemiddelde kijktijd in verhouding tot "duurSec" en het uitkijkpercentage zegt (waar haken kijkers waarschijnlijk af, is de video te lang); "" als kijktijd niet gemeten is. "les": de belangrijkste les uit deze video voor het team, één zin van maximaal 15 woorden. "betereHook": een concreet herschreven, sterkere openingszin voor een volgende video over hetzelfde onderwerp, maximaal 15 woorden, in de taal van de video. "script", "opname", "montage": elk maximaal 18 woorden, wat het team bij de volgende video anders of hetzelfde doet; leeg laten ("") als er niets zinnigs over te zeggen is. Kijktijd en uitkijkpercentage alleen gebruiken als ze in de data staan. Laat een interne lijst leeg ([]) als de data er niets over zegt, in plaats van iets te verzinnen.`;

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown) => Number(v ?? 0);

/**
 * Stelt de AI-maandanalyse samen voor één klant en kalendermaand uit de echte
 * cijfers, gewogen naar de klantdoelstelling. Draait als vertrouwde job of UI.
 * Slaat niets op — de orkestratie (run.ts) bewaart het resultaat op het rapport.
 */
export async function generateMonthlyAnalysis(
  clientId: string,
  period: string,
  opts: { trusted?: boolean; priorSummary?: string | null; feedback?: string[] } = {},
): Promise<MonthlyAnalysisResult> {
  if (!aiConfigured()) return { ok: false, reason: "no_provider" };

  const [client] = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return { ok: false, reason: "error", message: "Klant niet gevonden." };

  const win = monthWindow(period);
  const report = await getClientReport(client.slug, 30, opts.trusted ?? true, win);
  if (!report.hasData) return { ok: false, reason: "no_data", message: "Geen resultaten in deze maand om te analyseren." };

  const strategy = await loadStrategyProfile(clientId);

  // Per-video cijfers binnen de maand. Publicatie-gericht: elke gepubliceerde
  // post/reel met eigen cijfers telt als één video, inclusief via Metricool
  // opgehaalde posts zonder interne deliverable (titel valt terug op de caption).
  const pvRes = await db.execute(sql`
    with pm as (
      select publication_id, max(views) views, max(likes) likes, max(comments) comments,
             max(shares) shares, max(saves) saves, max(avg_watch_seconds) avg_watch, max(completion_rate) completion
      from social_metrics where client_id = ${client.id} group by publication_id
    )
    select p.id as pub_id, p.platform as platform, left(coalesce(d.title, p.caption), 140) as titel, sc.hook as hook, sc.cta as cta, p.duration_seconds as duur, left(p.caption, 700) as caption_full, sc.format as format, sc.pillar as pillar,
           to_char(coalesce(d.published_at, p.published_at), 'YYYY-MM-DD') as datum, p.external_url as url,
           coalesce(pm.views,0)::int as views, coalesce(pm.likes,0)::int as likes,
           coalesce(pm.comments,0)::int as comments, coalesce(pm.shares,0)::int as shares,
           coalesce(pm.saves,0)::int as saves,
           pm.avg_watch as avg_watch, pm.completion as completion
    from publications p
    join pm on pm.publication_id = p.id
    left join deliverables d on d.id = p.deliverable_id and d.deleted_at is null
    left join scripts sc on sc.id = d.script_id and sc.deleted_at is null
    where p.client_id = ${client.id} and p.deleted_at is null
      and coalesce(p.published_at, d.published_at)::date >= ${win.from}
      and coalesce(p.published_at, d.published_at)::date <= ${win.to}
    order by views desc nulls last, p.published_at desc nulls last
  `);
  const pvRows = ((pvRes as { rows?: unknown[] }).rows ?? (pvRes as unknown as unknown[])) as Array<Record<string, unknown>>;
  const withCijfers = pvRows.filter((v) => num(v.views) > 0);
  const perVideoBeschikbaar = withCijfers.length > 0;
  const mapVideo = (v: Record<string, unknown>) => ({
    titel: String(v.titel ?? ""), datum: v.datum ? String(v.datum) : null, url: v.url ? String(v.url) : null,
    views: num(v.views), likes: num(v.likes), reacties: num(v.comments), shares: num(v.shares), saves: num(v.saves),
    gemKijktijdSec: v.avg_watch != null ? Math.round(Number(v.avg_watch)) : null,
    uitkijkpercentage: v.completion != null ? Math.round(Number(v.completion) * 1000) / 10 : null,
    hook: v.hook ? String(v.hook) : null, format: v.format ? String(v.format) : null, pijler: v.pillar ? String(v.pillar) : null,
  });

  // Titels van video's die deze maand live gingen (contentcontext).
  const monthTitles = withCijfers.map((v) => String(v.titel ?? "")).filter(Boolean);

  // Historie en vergelijkingen: in code berekend, nooit door de AI.
  const historie = await monthSeries(client.id, period, 6);
  const vergelijking = buildVergelijking(historie);
  const huidig = historie[historie.length - 1]!;
  const formats = formatStats(withCijfers.map(mapVideo).map((v) => ({ format: v.format, views: v.views, likes: v.likes, reacties: v.reacties, shares: v.shares, saves: v.saves })));

  // Aantal video's: de dagcijfers van Metricool bevatten geen publicatietelling
  // (altijd 0). De publicatielijst is dan de betrouwbare bron.
  const totals: ReportMetrics = { ...report.totals };
  if (totals.posts === 0 && huidig.videos > 0) {
    totals.posts = huidig.videos;
    totals.avgPerPost = Math.round(totals.views / huidig.videos);
    totals.videoBron = "publicaties";
  } else {
    totals.videoBron = "dagcijfers";
  }
  totals.videos = withCijfers.slice(0, 40).map((v, i) => {
    const m = mapVideo(v);
    return { key: `v${i + 1}`, id: String(v.pub_id), titel: m.titel, datum: m.datum, platform: v.platform ? String(v.platform) : null, url: m.url, views: m.views, likes: m.likes, reacties: m.reacties, shares: m.shares, saves: m.saves, gemKijktijdSec: m.gemKijktijdSec, uitkijkPct: m.uitkijkpercentage, scriptHook: m.hook, scriptCta: v.cta ? String(v.cta) : null, duurSec: v.duur != null ? num(v.duur) : null, caption: v.caption_full ? String(v.caption_full) : null };
  });
  totals.platforms = await platformSplit(client.id, period);
  totals.historie = historie;
  totals.vergelijking = vergelijking;
  totals.formats = formats;
  // Sectie 1 "Dit hebben we gerealiseerd": deterministisch uit opnamedagen,
  // deliverables en publicaties (geen AI). Regen-bestendig: bij elke generatie opnieuw.
  totals.gerealiseerd = await getGerealiseerd(client.id, period);

  // Ontbrekende gegevens markeren (eerlijkheid, sectie 5).
  const ontbrekend: string[] = [];
  if (!perVideoBeschikbaar) ontbrekend.push("Per-video cijfers zijn deze maand niet via de koppeling beschikbaar.");
  if (totals.posts === 0) ontbrekend.push("Er zijn deze maand geen gepubliceerde video's geregistreerd.");
  if (huidig.meetdagen > 0 && huidig.meetdagen < 25) ontbrekend.push(`Er zijn maar voor ${huidig.meetdagen} dagen van deze maand cijfers opgehaald.`);
  if (vergelijking.maandenHistorie < 3) ontbrekend.push(`Er is pas ${vergelijking.maandenHistorie} eerdere maand${vergelijking.maandenHistorie === 1 ? "" : "en"} met cijfers; vergelijkingen over 3 en 6 maanden zijn nog niet mogelijk.`);

  const dataBlock = {
    klant: client.name,
    maand: periodLabel(period),
    doelstelling: strategyToText(strategy) || "Niet ingesteld",
    cijfers: { ...report.totals, posts: totals.posts, avgPerPost: totals.avgPerPost },
    perPlatform: totals.platforms,
    historie,
    vergelijking,
    formatPrestaties: formats,
    feitelijkeObservaties: report.observations,
    videosDezeMaand: monthTitles,
    perVideoCijfersBeschikbaar: perVideoBeschikbaar,
    alleVideos: (totals.videos ?? []).map((v) => ({ key: v.key, titelOfCaption: v.titel, datum: v.datum, platform: v.platform, weergaven: v.views, likes: v.likes, reacties: v.reacties, shares: v.shares, saves: v.saves, gemKijktijdSec: v.gemKijktijdSec, uitkijkpercentage: v.uitkijkPct ?? null, duurSec: v.duurSec ?? null, hookUitScript: v.scriptHook ?? null, ctaUitScript: v.scriptCta ?? null, caption: v.caption ?? null })),
    topVideos: perVideoBeschikbaar ? withCijfers.slice(0, 8).map(mapVideo) : [],
    mindereVideos: perVideoBeschikbaar && withCijfers.length > 3 ? withCijfers.slice(-4).reverse().map(mapVideo) : [],
    vorigeMaandAnalyse: opts.priorSummary ?? null,
    feedbackVanControleur: opts.feedback && opts.feedback.length ? opts.feedback : null,
  };

  // Twee kleinere AI-aanroepen parallel (klantdeel en intern teamdeel) in plaats
  // van één lange: zo blijft de generatie ruim binnen de maximale looptijd van
  // een serverfunctie. Een herkansing alleen als daar nog tijd voor is.
  type Raw = Partial<MonthlyAnalysis> & { analyse?: ClientInsights["analysis"] };
  const data = JSON.stringify(dataBlock);
  const started = Date.now();
  const ask = async (deel: string, maxTokens: number) => {
    const input = { system: SYSTEM, user: `${deel}\n\nData (JSON):\n${data}`, maxTokens };
    let r = await runJsonPrompt<Raw>(input);
    if (!r.ok && r.reason === "error" && Date.now() - started < 90_000) r = await runJsonPrompt<Raw>(input);
    return r;
  };
  // Drie delen parallel: klant, intern algemeen en intern per video. Elk deel
  // blijft zo onder de 20k output-tokens (daarboven eist de SDK streaming).
  const [klantRes, internRes, videoRes] = await Promise.all([
    ask("Analyseer deze klant over de maand. Geef ALLEEN de klantvelden (topVideos, besteHooks, besteFormats, mindereVideos, analysis, maandvergelijking, conclusies, kansen, videoInzichten, verbeterpunten, aandachtspunten, strategischeActies) en zet \"intern\" op {}.", 16000),
    ask("Analyseer deze klant over de maand voor het interne team (projectmanagers, scriptschrijvers, videografen). Antwoord met precies dit JSON-object: {\"intern\":{...}} met alle velden van \"intern\" uit het formaat volledig ingevuld, BEHALVE \"videoAnalyses\" (laat die weg). Geef geen andere velden.", 20000),
    ask("Analyseer voor het interne team ELKE video uit \"alleVideos\" afzonderlijk. Antwoord met precies dit JSON-object: {\"intern\":{\"videoAnalyses\":[...]}} met per video alle velden van \"videoAnalyses\" uit het formaat volledig ingevuld. Geef geen andere velden.", 20000),
  ]);
  if (!klantRes.ok) return { ok: false, reason: klantRes.reason === "no_provider" ? "no_provider" : "error", message: klantRes.error };
  if (!internRes.ok) console.warn("[maandrapport] interne analyse mislukt:", internRes.error);
  if (!videoRes.ok) console.warn("[maandrapport] video-analyse mislukt:", videoRes.error);
  // Het model geeft het interne deel soms zonder de "intern"-omhulling terug.
  const unwrap = (r: typeof internRes) => (r.ok ? ((r.data as Raw | undefined)?.intern ?? (r.data as unknown)) : undefined) as Record<string, unknown> | undefined;
  const internAlg = unwrap(internRes);
  const internVid = unwrap(videoRes);
  const internData = internAlg || internVid ? { ...(internAlg ?? {}), videoAnalyses: internVid?.videoAnalyses ?? internAlg?.videoAnalyses ?? [] } : undefined;
  const res = { ...klantRes, data: { ...(klantRes.data ?? {}), intern: internData } as Raw };
  const raw = res.data ?? {};
  const a = raw.analysis ?? raw.analyse ?? { watWerkt: [], watMinder: [], ontwikkelingen: [] };
  const analysis: MonthlyAnalysis = {
    versie: ANALYSE_VERSIE,
    analysis: {
      watWerkt: arr<Finding>(a.watWerkt),
      watMinder: arr<Finding>(a.watMinder),
      ontwikkelingen: arr<string>(a.ontwikkelingen),
    },
    verbeterpunten: arr<Recommendation>(raw.verbeterpunten),
    topVideos: arr<TopVideo>(raw.topVideos),
    besteHooks: arr<HookInzicht>(raw.besteHooks),
    besteFormats: arr<FormatInzicht>(raw.besteFormats),
    mindereVideos: arr<MindereVideo>(raw.mindereVideos),
    maandvergelijking: arr<string>(raw.maandvergelijking),
    aandachtspunten: arr<MaandAandachtspunt>(raw.aandachtspunten).slice(0, 3),
    strategischeActies: arr<StrategischeActie>(raw.strategischeActies).slice(0, 3),
    conclusies: arr<string>(raw.conclusies).slice(0, 4),
    kansen: arr<{ titel: string; toelichting: string }>(raw.kansen).slice(0, 3),
    videoInzichten: arr<{ key?: unknown; inzicht?: unknown }>(raw.videoInzichten)
      .map((x) => ({ key: String(x.key ?? ""), inzicht: String(x.inzicht ?? "").slice(0, 160) }))
      .filter((x) => /^v\d+$/.test(x.key) && x.inzicht),
    intern: normalizeIntern(raw.intern),
  };
  const internLeeg = !analysis.intern || (!analysis.intern.kern && analysis.intern.acties.length === 0 && analysis.intern.besteVideos.length === 0);
  if (internLeeg) ontbrekend.push("De interne teamanalyse kon deze keer niet worden opgesteld. Gebruik 'AI opnieuw' om het opnieuw te proberen.");
  if (analysis.verbeterpunten.length === 0 && analysis.analysis.watWerkt.length === 0 && analysis.analysis.watMinder.length === 0) {
    return { ok: false, reason: "error", message: "De AI-analyse leverde geen bruikbare uitkomst op." };
  }

  return { ok: true, analysis: replaceVideoKeys(analysis), totals, ontbrekend, model: res.model };
}

/** Vangnet: "v2" in een tekst wordt "video #2" (zelfde nummering als het video-overzicht). */
function replaceVideoKeys<T>(value: T, field?: string): T {
  if (typeof value === "string") return (field === "key" || field === "video" ? value : value.replace(/\bv(\d{1,2})\b/g, "video #$1")) as T;
  if (Array.isArray(value)) return value.map((v) => replaceVideoKeys(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, replaceVideoKeys(v, k)])) as T;
  }
  return value;
}

function normalizeIntern(v: unknown): InternAnalyse {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const ins = (x: unknown): InternInzicht[] =>
    arr<Record<string, unknown>>(x).map((i) => ({
      titel: String(i.titel ?? ""),
      gemeten: String(i.gemeten ?? ""),
      verklaring: String(i.verklaring ?? ""),
      zekerheid: String(i.zekerheid ?? "hypothese"),
    })).filter((i) => i.titel);
  const strs = (x: unknown) => arr<unknown>(x).map((t) => String(t ?? "")).filter(Boolean);
  // Punten: nieuwe vorm {titel, uitleg, bewijs}; oudere rapporten hebben losse zinnen.
  const punten = (x: unknown): VideoPunt[] =>
    arr<unknown>(x)
      .map((p) => (typeof p === "string"
        ? { titel: "", uitleg: p.slice(0, 200), bewijs: "" }
        : { titel: String((p as Record<string, unknown>)?.titel ?? "").slice(0, 80), uitleg: String((p as Record<string, unknown>)?.uitleg ?? "").slice(0, 220), bewijs: String((p as Record<string, unknown>)?.bewijs ?? "").slice(0, 140) }))
      .filter((p) => p.titel || p.uitleg)
      .slice(0, 3);
  return {
    kern: String(o.kern ?? ""),
    besteVideos: ins(o.besteVideos),
    hooks: ins(o.hooks),
    onderwerpen: ins(o.onderwerpen),
    tegenvallers: ins(o.tegenvallers),
    videostructuur: ins(o.videostructuur),
    formatsVaker: ins(o.formatsVaker),
    vermijdenOfAanpassen: ins(o.vermijdenOfAanpassen),
    scripts: strs(o.scripts),
    opnames: strs(o.opnames),
    montage: strs(o.montage),
    acties: arr<Record<string, unknown>>(o.acties)
      .map((a) => ({ actie: String(a.actie ?? ""), rol: String(a.rol ?? "pm"), waarom: String(a.waarom ?? ""), video: /^v\d+$/.test(String(a.video ?? "")) ? String(a.video) : "" }))
      .filter((a) => a.actie)
      .slice(0, 10),
    dataBeperkingen: strs(o.dataBeperkingen),
    doorgaan: strs(o.doorgaan).slice(0, 4),
    stoppen: strs(o.stoppen).slice(0, 4),
    testen: strs(o.testen).slice(0, 4),
    videoLessen: arr<Record<string, unknown>>(o.videoLessen)
      .map((x) => ({ key: String(x.key ?? ""), les: String(x.les ?? "").slice(0, 200) }))
      .filter((x) => /^v\d+$/.test(x.key) && x.les),
    videoAnalyses: arr<Record<string, unknown>>(o.videoAnalyses)
      .map((x) => {
        const oordeel = String(x.oordeel ?? "").toLowerCase();
        return {
          key: String(x.key ?? ""),
          hook: String(x.hook ?? "").slice(0, 200),
          hookBron: (String(x.hookBron ?? "") === "script" ? "script" : "caption") as "script" | "caption",
          hookType: String(x.hookType ?? "").slice(0, 40),
          cta: String(x.cta ?? "").slice(0, 160),
          ctaBron: (String(x.ctaBron ?? "") === "script" ? "script" : "caption") as "script" | "caption",
          ctaType: String(x.ctaType ?? "").slice(0, 40) || "geen",
          oordeel: (oordeel === "herhalen" || oordeel === "stoppen" ? oordeel : "aanpassen") as VideoAnalyse["oordeel"],
          waarom: String(x.waarom ?? "").slice(0, 240),
          watWerkte: punten(x.watWerkte),
          watBeter: punten(x.watBeter),
          kijkgedrag: String(x.kijkgedrag ?? "").slice(0, 240),
          les: String(x.les ?? "").slice(0, 200),
          betereHook: String(x.betereHook ?? "").slice(0, 200),
          script: String(x.script ?? "").slice(0, 200),
          opname: String(x.opname ?? "").slice(0, 200),
          montage: String(x.montage ?? "").slice(0, 200),
        };
      })
      .filter((x) => /^v\d+$/.test(x.key)),
  };
}
