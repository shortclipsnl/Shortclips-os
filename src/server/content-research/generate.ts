import "server-only";
import { runResearch, runStructured, aiModelStrong } from "@/server/ai/client";
import { SHORTCLIPS_IDENTITY } from "@/server/ai/identity";
import type { ContentDna } from "./content-dna";
import { normalizeDna } from "./content-dna";

/** Eén idee zoals de AI het aanlevert (ruwe vorm, nog te normaliseren). */
export type IdeaDraft = {
  titel: string;
  concept: string;
  hooks: string[];
  waaromWerkt: string;
  /** Het doel voor de klant (bekendheid, vertrouwen, aanvragen, verkoop …). */
  doel: string;
  inspiratieUrl: string | null;
  inspiratieLabel: string | null;
  categorie: string;
  uitvoerbaarheid: string;
  score: number;
  scoreReason: string;
  /** Het uitgeschreven middenstuk: letterlijke tekst, één korte zin per regel. */
  middenstuk: string[];
  ctaCommercieel: string;
  ctaInteractie: string;
  /** Waarmee wij ons onderscheiden van wat de concurrent/markt doet. */
  invalshoek: string;
  onderbouwing: Evidence[];
  opportunity: unknown;
  herhaalReden: string | null;
};

/** Eén onderbouwing van een idee, met de herkomst en hoe zeker die is. */
export type Evidence = {
  type: "eigen_data" | "concurrent" | "markt" | "nieuw" | "herhaling";
  tekst: string;
  zekerheid: "bewezen" | "aanname" | "hypothese";
  url: string | null;
};

/** Door het onderzoek gevonden concurrent/vergelijkbaar bedrijf. */
export type CompetitorSuggestion = {
  naam: string;
  url: string | null;
  tiktok: string | null;
  instagram: string | null;
  youtube: string | null;
  notitie: string;
  observatie: string;
};

export type Source = { label: string; url: string };

/** Strategisch advies o.b.v. de echte resultaten: doorgaan / verbeteren / vermijden. */
export type StrategicAdvice = {
  kleur: "doorgaan" | "verbeteren" | "vermijden";
  punt: string;
  bewijs: string;
  zekerheid: "bewezen" | "waarschijnlijk" | "hypothese";
};

export type ResearchOutput = {
  trends: string[];
  ideeen: IdeaDraft[];
  sources: Source[];
  contentDna: ContentDna;
  briefing: string;
  strategischAdvies: StrategicAdvice[];
  concurrenten: CompetitorSuggestion[];
};

const CATEGORIES = ["humor", "educatief", "teamcontent", "trends", "productcontent", "seizoen", "overig"] as const;
const EFFORTS = ["eenvoudig", "gemiddeld", "uitgebreid"] as const;
const ADVICE_COLORS = ["doorgaan", "verbeteren", "vermijden"] as const;
const ADVICE_ZEKERHEID = ["bewezen", "waarschijnlijk", "hypothese"] as const;

function normCategory(v: unknown): string {
  const s = String(v ?? "").toLowerCase().trim();
  return (CATEGORIES as readonly string[]).includes(s) ? s : "overig";
}
function normAdviceColor(v: unknown): StrategicAdvice["kleur"] {
  const s = String(v ?? "").toLowerCase().trim();
  return (ADVICE_COLORS as readonly string[]).includes(s) ? (s as StrategicAdvice["kleur"]) : "verbeteren";
}
function normZekerheid(v: unknown): StrategicAdvice["zekerheid"] {
  const s = String(v ?? "").toLowerCase().trim();
  return (ADVICE_ZEKERHEID as readonly string[]).includes(s) ? (s as StrategicAdvice["zekerheid"]) : "hypothese";
}
function normEffort(v: unknown): string {
  const s = String(v ?? "").toLowerCase().trim();
  return (EFFORTS as readonly string[]).includes(s) ? s : "gemiddeld";
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strList(v: unknown, cap = 20): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).slice(0, cap);
}

const RESEARCH_SYSTEM = `${SHORTCLIPS_IDENTITY}

Je bent de contentonderzoeker van Shortclips. Je voert ECHT web-onderzoek uit (zoeken en pagina's ophalen) naar de markt en de concurrenten van deze klant, en schrijft een grondige BRIEFING in gewone tekst (GEEN JSON).

HARDE REGELS:
- Gebruik uitsluitend controleerbare, actuele bronnen. Verzin NOOIT cijfers (volgers, weergaven, likes) en verzin NOOIT video's. Kun je een cijfer niet op een openbare pagina zien, schrijf dan "niet zichtbaar" in plaats van een schatting.
- Je kunt TikTok-/Instagram-video's niet afspelen. Werk met wat openbaar leesbaar is: profielpagina's, video-titels en beschrijvingen, openbare weergavetellers als die op de pagina staan, websites, nieuws, Meta Advertentiebibliotheek, YouTube. Benoem bij elke observatie de exacte URL.
- Maak steeds onderscheid tussen FEIT (staat zo op de bron), AANNAME en HYPOTHESE.
- Neem nooit video's of scripts letterlijk over: beschrijf het onderwerp, het format en de hook-structuur, niet de tekst.
- Blijf specifiek voor DEZE klant, markt en regio.`;

function buildResearchUser(ctx: {
  clientName: string;
  sector: string | null;
  contextText: string;
  performanceText: string;
  competitorsText: string;
}): string {
  return `Onderzoek de markt van deze klant en schrijf een briefing.

KLANT: ${ctx.clientName}${ctx.sector ? ` (branche: ${ctx.sector})` : ""}
${ctx.performanceText ? `\n${ctx.performanceText.slice(0, 6000)}\n` : ""}
${ctx.competitorsText ? `\n${ctx.competitorsText.slice(0, 3000)}\n` : ""}
CONTEXT (intern: klantgeheugen, Content DNA, feedback, eerdere scripts):
${ctx.contextText.slice(0, 10000)}

Onderzoek en beschrijf, met bij elke observatie de URL:
1. CONCURRENTEN: 3 tot 6 relevante concurrenten of vergelijkbare bedrijven (zelfde markt, liefst Nederland/regio; ook inspirerende bedrijven uit aangrenzende markten). Begin bij de bekende concurrenten hierboven, vul aan waar nodig. Geef per bedrijf: naam, website, TikTok/Instagram/YouTube-handle als je die vindt.
2. WAT DOEN ZIJ OP SHORT VIDEO: recente video's of formats die je openbaar kunt zien. Welke onderwerpen en formats komen terug? Welke video valt op ten opzichte van hun andere video's (alleen als de weergaven openbaar zichtbaar zijn, anders zeggen dat het niet te zien is)? Welke hook-structuren gebruiken ze?
3. KANSEN DIE ONZE KLANT NOG NIET BENUT: onderwerpen of formats die bij concurrenten terugkomen maar niet in de eerdere scripts van onze klant.
4. VRAGEN VAN DE DOELGROEP: actuele vragen, pijnpunten en zoekgedrag in deze markt.
5. SEIZOEN EN ACTUALITEIT: wat speelt er de komende weken in deze markt.

Schrijf kopjes: CONCURRENTEN, WAT DOEN ZIJ, KANSEN, VRAGEN VAN DE DOELGROEP, SEIZOEN/ACTUEEL, en sluit af met BRONNEN (titel — URL).`;
}

/** Aantal kandidaten dat fase "ideeen" bedenkt; de keuring laat er max. 5 door. */
export const CANDIDATE_COUNT = 10;

const IDEA_SYSTEM = `${SHORTCLIPS_IDENTITY}

Je bent de scriptschrijver en contentstrateeg van Shortclips die al maanden voor deze klant schrijft. Je zet een onderzoeksbriefing om in kandidaat-ideeën voor organische short video's (TikTok/Reels). Na jou beoordeelt een strenge eindredacteur elk idee; alleen ideeën die onmiskenbaar klinken als de eerdere scripts van deze klant én aantoonbaar onderbouwd zijn, halen het. Werk daarom vanuit wat bij deze klant al bewezen werkt, niet vanuit algemene AI-ideeën.

STIJL (het belangrijkste):
- Het STIJLPROFIEL hieronder komt uit de echte Shortclips-scripts van deze klant. Schrijf hooks, middenstuk en CTA's alsof dezelfde scriptschrijver ze maakte: zelfde format (presentator, interview met cameraman, voice-over...), aanspreekvorm, zinslengte, nadruk in HOOFDLETTERS als dat zo in de scripts staat, dezelfde soort plaatshouders ([MODELNAAM], [bedrag]).
- Elke hook volgt één van de HOOKPATRONEN uit het stijlprofiel of lijkt sterk op een (bewezen) voorbeeldhook. Nooit een vorm die niet in de scripts voorkomt.
- Alles onder "PAST NIET" en "CORRECTIES VAN HET TEAM" is verboden.
- Geen generieke marketingtaal, geen uitroepen of begroetingen die niet in de scripts staan, geen vragen aan de kijker die niet bij het format passen.
- Volg het format uit de scripts ook in het middenstuk. Bij een interviewformat (cameraman stelt vragen, medewerker antwoordt): schrijf de vragen letterlijk ("CAMERAMAN: ...") en de antwoorden alleen als korte regieaanwijzing tussen haakjes ("(Chauffeur legt uit wat HVO100 is.)") als de scripts de antwoorden ook niet uitschrijven.

INHOUD:
- Verzin GEEN cijfers of nepvoorbeelden. Een inspiratiebron-URL alleen als die echt in de briefing staat; anders leeg.
- Bouw voort op wat aantoonbaar werkte: de bewezen hooks en sterke video's (VIDEODATA) wegen het zwaarst. Het merendeel van de kandidaten gebruikt een bewezen hookpatroon of een format van een sterke video op een NIEUW onderwerp; noem in "onderbouwing" (type eigen_data) welke video of hook dat is. Een nieuw onderwerp in een bewezen format is beter dan een nieuw format.
- Concreet zoals de scripts: staan in de briefing actuele bedragen, percentages of datums (regels, tarieven, deadlines), gebruik die dan letterlijk in plaats van een plaatshouder. Plaatshouders alleen voor gegevens die de klant op de opnamedag aanlevert (modelnaam, prijs van een specifiek object, naam).
- Alle 3 hooks moeten sterk zijn. Geen vulhook ("Vergeet dit niet.") die niet zegt waarom de kijker moet blijven kijken.
- Niet herhalen wat al in de scripts of eerdere ideeën staat (zie onderwerpen). Alleen opnieuw met een duidelijke reden in "herhaalReden" (bijv. die video presteerde ver boven de eigen mediaan).
- Ideeën uit NIET RELEVANT BEVONDEN nooit opnieuw voorstellen, ook niet als variant. Leer van de reden.
- Concurrentie is inspiratie, geen kopie: "invalshoek" zegt hoe wij het eigen maken.
- "onderbouwing": 1 tot 3 punten met type (eigen_data, concurrent, markt, nieuw, herhaling), zekerheid (bewezen alleen als het letterlijk in de data/bron staat; anders aanname of hypothese) en url als die echt bestaat.

VORM per kandidaat (vaste Shortclips-scriptopbouw):
- "concept": max. 2 zinnen: wat we filmen en waarom het werkt voor de doelgroep.
- "hooks": precies 3 verschillende openingszinnen in de stijl van de klant, letterlijk uit te spreken.
- "middenstuk": 5 tot 9 regels, letterlijk gesproken tekst (of vragen + regieaanwijzingen bij interviews, zie STIJL), één korte zin per regel, [plaatshouder] voor gegevens van de klant.
- "ctaCommercieel" en "ctaInteractie": uitgeschreven, in de stijl van de voorbeeld-CTA's.
- "doel": wat het oplevert (bekendheid, vertrouwen, aanvragen, sollicitanten, verkoop...).

OVERIG:
- Gevarieerd in onderwerp en hookpatroon (het aantal staat onderaan de opdracht).
- Strategisch advies (max. 4) op basis van de VIDEODATA: doorgaan / verbeteren / vermijden, met bewijs en zekerheid. Zonder data: hypothese.
- Content DNA beknopt bijwerken (lijsten max. 5 items). trends max. 5, concurrenten max. 6 (observatie max. 2 zinnen), bronnen max. 10.
- Totaal onder de 5.000 woorden, anders wordt het antwoord afgekapt.`;

function buildIdeaUser(input: {
  clientName: string;
  briefing: string;
  dnaText: string;
  existingIdeasText: string;
  priorScriptsText: string;
  performanceText: string;
  styleText: string;
  toneText: string;
  rejectedText: string;
}): string {
  return `Klant: ${input.clientName}

STIJLPROFIEL UIT DE ECHTE SCRIPTS VAN DEZE KLANT (leidend):
${input.styleText.slice(0, 9000) || "(geen scripts gevonden: schrijf neutraal-professioneel en zakelijk-informeel, zonder uitroepen of begroetingen)"}

${input.toneText ? `AANVULLEND (klantgeheugen en Content DNA; bij conflict wint het stijlprofiel):\n${input.toneText.slice(0, 3000)}\n\n` : ""}NIET RELEVANT BEVONDEN (nooit opnieuw voorstellen):
${input.rejectedText.slice(0, 3000) || "(geen)"}

${input.performanceText ? `${input.performanceText.slice(0, 7000)}\n\n` : ""}ONDERZOEKSBRIEFING:
${input.briefing.slice(0, 16000)}

CONTENT DNA EN KLANTCONTEXT:
${input.dnaText.slice(0, 4000) || "(nog geen DNA)"}

EERDERE IDEEËN EN HUN STATUS (niet herhalen):
${input.existingIdeasText.slice(0, 5000) || "(geen)"}

EERDERE SCRIPTS (bestandsnamen; onderwerpen staan in het stijlprofiel):
${input.priorScriptsText.slice(0, 3000) || "(geen)"}

Lever de kandidaten zoals hieronder gevraagd.`;
}

/**
 * Verwijdert losse UTF-16-surrogaten (halve emoji's door het afknippen van
 * captions/teksten). Die maken het verzoek aan de AI ongeldige JSON
 * ("unexpected end of hex escape") en laten het hele onderzoek mislukken.
 */
export function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

function evidenceList(v: unknown): Evidence[] {
  if (!Array.isArray(v)) return [];
  const TYPES = ["eigen_data", "concurrent", "markt", "nieuw", "herhaling"] as const;
  const ZEK = ["bewezen", "aanname", "hypothese"] as const;
  return v
    .map((x): Evidence | null => {
      const o = (x ?? {}) as Record<string, unknown>;
      const tekst = str(o.tekst);
      if (!tekst) return null;
      const type = (TYPES as readonly string[]).includes(str(o.type)) ? (str(o.type) as Evidence["type"]) : "markt";
      const zekerheid = (ZEK as readonly string[]).includes(str(o.zekerheid)) ? (str(o.zekerheid) as Evidence["zekerheid"]) : "hypothese";
      const url = str(o.url);
      return { type, tekst: tekst.slice(0, 400), zekerheid, url: /^https?:\/\//.test(url) ? url : null };
    })
    .filter((x): x is Evidence => x !== null)
    .slice(0, 4);
}

function handle(v: unknown): string | null {
  const s = str(v);
  return s ? s.slice(0, 160) : null;
}

/**
 * Fase 1: echt web-onderzoek (Sonnet + web search/fetch) naar markt en
 * concurrenten → vrije briefing. Wordt op de onderzoeksronde bewaard zodat fase 2
 * in een aparte aanroep kan draaien.
 */
export async function runResearchBriefing(input: {
  clientName: string;
  sector: string | null;
  contextText: string;
  performanceText: string;
  competitorsText: string;
  /** Aantal zoek- en ophaalacties (standaard 12). */
  maxUses?: number;
}) {
  return runResearch({
    system: RESEARCH_SYSTEM,
    user: wellFormed(buildResearchUser(input)),
    maxUses: input.maxUses ?? 12,
    maxTokens: 12000,
  });
}

const str_ = { type: "string" } as const;
const strArr = { type: "array", items: str_ } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arrOf = (properties: Record<string, unknown>) => ({ type: "array", items: obj(properties) });

/**
 * JSON-schema voor fase 2 (structured outputs): de API garandeert dit formaat.
 * Bewust plat gehouden (alleen strings, geen enums of null-varianten, de score-
 * opbouw als lijst): een rijker schema geeft "compiled grammar is too large".
 * Waarden worden daarna in code genormaliseerd.
 */
const IDEA_ITEM = {
  titel: str_,
  concept: str_,
  hooks: strArr,
  middenstuk: strArr,
  ctaCommercieel: str_,
  ctaInteractie: str_,
  doel: str_,
  inspiratieUrl: str_,
  categorie: str_,
  uitvoerbaarheid: str_,
  invalshoek: str_,
  herhaalReden: str_,
  onderbouwing: arrOf({ type: str_, tekst: str_, zekerheid: str_, url: str_ }),
};

/** Alleen ideeën (voor de tweede, parallelle aanroep). */
const IDEAS_ONLY_SCHEMA = obj({ ideeen: arrOf(IDEA_ITEM) });

const RESEARCH_SCHEMA = obj({
  trends: strArr,
  strategischAdvies: arrOf({ kleur: str_, punt: str_, bewijs: str_, zekerheid: str_ }),
  contentDna: obj({
    toneOfVoice: str_,
    doelgroep: str_,
    favorieteFormats: strArr,
    geaccepteerdeConcepten: strArr,
    afgekeurdeConcepten: strArr,
    voorkeuren: strArr,
    creatieveBeperkingen: strArr,
    gewensteUitstraling: str_,
  }),
  ideeen: arrOf(IDEA_ITEM),
  concurrenten: arrOf({ naam: str_, url: str_, tiktok: str_, instagram: str_, youtube: str_, notitie: str_, observatie: str_ }),
  bronnen: arrOf({ label: str_, url: str_ }),
});

/**
 * Fase 2: briefing + klantcontext → ideeën, Opportunity-onderdelen, strategisch
 * advies, Content DNA en concurrentvoorstellen (Opus, zuivere JSON, geen web).
 */
export async function ideateFromBriefing(input: {
  clientName: string;
  briefing: string;
  dnaText: string;
  existingIdeasText: string;
  priorScriptsText: string;
  performanceText?: string;
  /** Stijlprofiel uit de echte scripts (leidend). */
  styleText?: string;
  /** Aanvullend: klantgeheugen en Content DNA. */
  toneText?: string;
  /** Door het team als niet relevant afgewezen ideeën (met reden). */
  rejectedText?: string;
  /** Sneller model als terugval (na een eerdere time-out). Standaard het sterke model. */
  model?: string;
}): Promise<{ ok: true; data: ResearchOutput } | { ok: false; reason: "no_provider" | "error"; error?: string }> {
  const performanceText = input.performanceText ?? "";
  const ideaInput = {
    system: IDEA_SYSTEM,
    user: wellFormed(buildIdeaUser({
      clientName: input.clientName,
      briefing: input.briefing,
      dnaText: input.dnaText,
      existingIdeasText: input.existingIdeasText,
      priorScriptsText: input.priorScriptsText,
      performanceText,
      styleText: input.styleText ?? "",
      toneText: input.toneText ?? "",
      rejectedText: input.rejectedText ?? "",
    })),
    model: input.model ?? aiModelStrong(),
  };
  type Raw = { trends?: unknown; contentDna?: unknown; ideeen?: unknown[]; bronnen?: unknown[]; strategischAdvies?: unknown[]; concurrenten?: unknown[] };
  // Twee aanroepen tegelijk, elk met de helft van de kandidaten en een eigen
  // focus: halveert de wachttijd (één aanroep met 10 uitgeschreven ideeën kon
  // tegen de tijdslimiet van Vercel aanlopen) en geeft meer variatie.
  // Structured outputs: de API garandeert geldige JSON.
  const half = Math.ceil(CANDIDATE_COUNT / 2);
  const focus = (nr: 1 | 2) =>
    nr === 1
      ? `\n\nDEZE AANROEP: lever precies ${half} kandidaten. FOCUS: bewezen hookpatronen en formats van de sterkste video's, toegepast op nieuwe onderwerpen. Lever ook trends, strategisch advies, Content DNA, concurrenten en bronnen.`
      : `\n\nDEZE AANROEP: lever precies ${CANDIDATE_COUNT - half} kandidaten en verder alleen "ideeen". FOCUS: nieuwe onderwerpen uit de briefing (vragen van de doelgroep, actualiteit, seizoen, kansen die concurrenten laten liggen), wel steeds in een bewezen hookpatroon van deze klant. Geen onderwerpen met prijsvergelijkingen of budgetten als de andere set die al dekt.`;
  const [one, two] = await Promise.all([
    runStructured<Raw>({ ...ideaInput, user: ideaInput.user + focus(1), schema: RESEARCH_SCHEMA, maxTokens: 16000, effort: "medium" }),
    runStructured<Raw>({ ...ideaInput, user: ideaInput.user + focus(2), schema: IDEAS_ONLY_SCHEMA, maxTokens: 12000, effort: "medium" }),
  ]);
  if (!one.ok) return one;
  const parsed = {
    ...one,
    data: {
      ...one.data,
      ideeen: [...(Array.isArray(one.data.ideeen) ? one.data.ideeen : []), ...(two.ok && Array.isArray(two.data.ideeen) ? two.data.ideeen : [])],
    },
  };

  const rawIdeas = Array.isArray(parsed.data.ideeen) ? parsed.data.ideeen : [];
  const ideeen: IdeaDraft[] = rawIdeas
    .map((raw): IdeaDraft | null => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const titel = str(o.titel);
      if (!titel) return null;
      const url = str(o.inspiratieUrl);
      return {
        titel: titel.slice(0, 240),
        concept: str(o.concept),
        hooks: strList(o.hooks, 3),
        middenstuk: strList(o.middenstuk, 12),
        ctaCommercieel: str(o.ctaCommercieel).slice(0, 300),
        ctaInteractie: str(o.ctaInteractie).slice(0, 300),
        waaromWerkt: str(o.waaromWerkt),
        doel: str(o.doel),
        inspiratieUrl: /^https?:\/\//.test(url) ? url : null,
        inspiratieLabel: str(o.inspiratieLabel).slice(0, 240) || null,
        categorie: normCategory(o.categorie),
        uitvoerbaarheid: normEffort(o.uitvoerbaarheid),
        score: 0,
        scoreReason: "",
        invalshoek: str(o.invalshoek).slice(0, 600),
        onderbouwing: evidenceList(o.onderbouwing),
        opportunity: {},
        herhaalReden: str(o.herhaalReden) || null,
      };
    })
    .filter((x): x is IdeaDraft => x !== null)
    .slice(0, CANDIDATE_COUNT);

  const sources: Source[] = Array.isArray(parsed.data.bronnen)
    ? parsed.data.bronnen
        .map((b) => {
          const o = (b ?? {}) as Record<string, unknown>;
          const url = str(o.url);
          if (!/^https?:\/\//.test(url)) return null;
          return { label: str(o.label) || url, url };
        })
        .filter((x): x is Source => x !== null)
        .slice(0, 30)
    : [];

  const strategischAdvies: StrategicAdvice[] = Array.isArray(parsed.data.strategischAdvies)
    ? parsed.data.strategischAdvies
        .map((a): StrategicAdvice | null => {
          const o = (a ?? {}) as Record<string, unknown>;
          const punt = str(o.punt);
          if (!punt) return null;
          return {
            kleur: normAdviceColor(o.kleur),
            punt: punt.slice(0, 240),
            bewijs: str(o.bewijs).slice(0, 500),
            zekerheid: normZekerheid(o.zekerheid),
          };
        })
        .filter((x): x is StrategicAdvice => x !== null)
        .slice(0, 9)
    : [];

  const concurrenten: CompetitorSuggestion[] = Array.isArray(parsed.data.concurrenten)
    ? parsed.data.concurrenten
        .map((c): CompetitorSuggestion | null => {
          const o = (c ?? {}) as Record<string, unknown>;
          const naam = str(o.naam);
          if (!naam) return null;
          const url = str(o.url);
          return {
            naam: naam.slice(0, 160),
            url: /^https?:\/\//.test(url) ? url : null,
            tiktok: handle(o.tiktok),
            instagram: handle(o.instagram),
            youtube: handle(o.youtube),
            notitie: str(o.notitie).slice(0, 500),
            observatie: str(o.observatie).slice(0, 1500),
          };
        })
        .filter((x): x is CompetitorSuggestion => x !== null)
        .slice(0, 8)
    : [];

  return {
    ok: true,
    data: {
      trends: strList(parsed.data.trends, 15),
      ideeen,
      sources,
      contentDna: normalizeDna(parsed.data.contentDna),
      briefing: input.briefing,
      strategischAdvies,
      concurrenten,
    },
  };
}
