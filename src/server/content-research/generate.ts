import "server-only";
import { runResearch, runJsonPrompt, aiModelStrong } from "@/server/ai/client";
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
function normScore(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(1, Math.min(10, n));
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

const IDEA_SYSTEM = `${SHORTCLIPS_IDENTITY}

Je bent de creatieve contentstrateeg van Shortclips en kent deze klant goed. Je zet een onderzoeksbriefing om in originele, concrete ideeën voor organische short video's (TikTok/Reels). GEEN standaard-AI-ideeën: elk idee is specifiek voor deze klant en onderbouwd door het onderzoek.

HARDE REGELS:
- Verzin GEEN cijfers of nepvoorbeelden. Een inspiratiebron-URL geef je alléén als die echt in de briefing/bronnen staat; anders null.
- Vergelijk ieder idee INHOUDELIJK met de reeds bestaande ideeën en eerdere scripts (hieronder). Stel niets voor dat daar inhoudelijk op lijkt, en niets uit de lijst afgekeurde concepten.
- Liever 4 uitstekende ideeën dan 8 matige. Maximaal 6 per week. Zorg voor variatie in categorie en format: niet alles uit één succesvol format.
- Een eerder behandeld onderwerp mag ALLEEN opnieuw als daar een duidelijke reden voor is (bijv. die video presteerde aantoonbaar ver boven de eigen mediaan, of een nieuwe invalshoek). Vul dan "herhaalReden" in; anders null.
- Concurrentie is inspiratie, geen kopie: beschrijf in "invalshoek" hoe wij het onderwerp op een eigen, onderscheidende manier uitwerken.
- "onderbouwing" bevat 1 tot 4 punten, elk met type (eigen_data = uit de EIGEN STATISTIEKEN, concurrent, markt, nieuw = nog niet eerder behandeld, herhaling), zekerheid (bewezen = staat letterlijk in de data/bron; aanname; hypothese) en een url als die echt in de bronnen staat. Verzin geen bewijs.
- "opportunity": scoor elk onderdeel 0–10 en zet basis op "data" alleen als het rust op de eigen statistieken of een concrete bron; anders "inschatting". Toelichting per onderdeel maximaal 15 woorden.
- Schrijf compact: concept maximaal 3 zinnen, onderbouwing per punt maximaal 2 zinnen. Geen herhaling tussen velden.
- Elk idee is STERK onderbouwd: "waaromWerkt" verwijst waar mogelijk naar wat bij deze klant aantoonbaar werkte (zie PRESTATIES), en "doel" benoemt concreet wat dit idee voor de klant oplevert (bijv. meer bekendheid, vertrouwen opbouwen, aanvragen, sollicitanten, verkoop).
- De "score" (1–10) is een interne kwaliteitsinschatting van relevantie, originaliteit, creatieve kracht en uitvoerbaarheid — GEEN voorspelling van weergaven.
- Geef daarnaast STRATEGISCH ADVIES op basis van de PRESTATIES: wat moeten we DOORGAAN (werkt bewezen), VERBETEREN (kan beter) en VERMIJDEN (werkt niet). Onderbouw elk advies met concreet bewijs uit de data en label de zekerheid (bewezen = volgt direct uit de cijfers; waarschijnlijk; hypothese = te testen). Verzin geen bewijs; is er nog geen data, baseer je dan op de branche-briefing en markeer het als hypothese.
- Werk ook een beknopt, bijgewerkt Content DNA bij op basis van het onderzoek en de context.
- Geef UITSLUITEND geldige JSON terug, zonder tekst eromheen.`;

function buildIdeaUser(input: {
  clientName: string;
  briefing: string;
  dnaText: string;
  existingIdeasText: string;
  priorScriptsText: string;
  performanceText: string;
}): string {
  return `Klant: ${input.clientName}

${input.performanceText ? `${input.performanceText.slice(0, 8000)}\n\n` : ""}ONDERZOEKSBRIEFING:
${input.briefing.slice(0, 20000)}

HUIDIG CONTENT DNA (voorkeuren/afgekeurd/uitstraling):
${input.dnaText.slice(0, 4000) || "(nog geen DNA)"}

EERDERE IDEEËN EN HUN STATUS (niet herhalen, ook niet qua inhoud; leer van "niet relevant"):
${input.existingIdeasText.slice(0, 6000) || "(geen)"}

EERDERE SCRIPTS/ONDERWERPEN (niet herhalen):
${input.priorScriptsText.slice(0, 6000) || "(geen)"}

Geef UITSLUITEND geldige JSON in exact dit formaat:
{
  "trends": ["korte trendobservatie met bron waar mogelijk"],
  "strategischAdvies": [
    {
      "kleur": "doorgaan|verbeteren|vermijden",
      "punt": "concreet advies (bijv. 'blijf team-content maken')",
      "bewijs": "onderbouwing met concrete cijfers/observaties uit de prestaties",
      "zekerheid": "bewezen|waarschijnlijk|hypothese"
    }
  ],
  "contentDna": {
    "toneOfVoice": "",
    "doelgroep": "",
    "favorieteFormats": [],
    "geaccepteerdeConcepten": [],
    "afgekeurdeConcepten": [],
    "voorkeuren": [],
    "creatieveBeperkingen": [],
    "gewensteUitstraling": ""
  },
  "ideeen": [
    {
      "titel": "",
      "concept": "wat we concreet filmen",
      "hooks": ["openingszin 1", "openingszin 2"],
      "waaromWerkt": "onderbouwing, waar mogelijk gekoppeld aan wat bij deze klant werkte",
      "doel": "wat dit idee voor de klant oplevert (bekendheid|vertrouwen|aanvragen|sollicitanten|verkoop|...)",
      "inspiratieUrl": null,
      "inspiratieLabel": null,
      "categorie": "humor|educatief|teamcontent|trends|productcontent|seizoen|overig",
      "uitvoerbaarheid": "eenvoudig|gemiddeld|uitgebreid",
      "invalshoek": "hoe wij dit eigen en onderscheidend maken",
      "herhaalReden": null,
      "onderbouwing": [
        { "type": "eigen_data|concurrent|markt|nieuw|herhaling", "tekst": "", "zekerheid": "bewezen|aanname|hypothese", "url": null }
      ],
      "opportunity": {
        "relevantie": { "score": 7, "basis": "inschatting", "toelichting": "" },
        "eerdereResultaten": { "score": 7, "basis": "data|inschatting", "toelichting": "" },
        "concurrentie": { "score": 7, "basis": "data|inschatting", "toelichting": "" },
        "originaliteit": { "score": 7, "basis": "inschatting", "toelichting": "" },
        "doelaansluiting": { "score": 7, "basis": "inschatting", "toelichting": "" },
        "uitvoerbaarheid": { "score": 7, "basis": "inschatting", "toelichting": "" }
      },
      "score": 8,
      "scoreReason": "korte onderbouwing"
    }
  ],
  "concurrenten": [
    { "naam": "", "url": null, "tiktok": null, "instagram": null, "youtube": null, "notitie": "waarom relevant", "observatie": "wat ze op short video doen, met URL" }
  ],
  "bronnen": [ { "label": "", "url": "" } ]
}`;
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
    })),
    model: input.model ?? aiModelStrong(),
    // Ruim boven de verwachte ~8k tokens, zodat het JSON-antwoord nooit wordt
    // afgekapt (een afgekapt antwoord = onleesbare JSON = dubbele aanroep).
    maxTokens: 16000,
  };
  type Raw = { trends?: unknown; contentDna?: unknown; ideeen?: unknown[]; bronnen?: unknown[]; strategischAdvies?: unknown[]; concurrenten?: unknown[] };
  let parsed = await runJsonPrompt<Raw>(ideaInput);
  if (!parsed.ok && parsed.reason === "error" && !/credit balance/i.test(parsed.error ?? "")) parsed = await runJsonPrompt<Raw>(ideaInput);
  if (!parsed.ok) return parsed;

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
        hooks: strList(o.hooks, 5),
        waaromWerkt: str(o.waaromWerkt),
        doel: str(o.doel),
        inspiratieUrl: /^https?:\/\//.test(url) ? url : null,
        inspiratieLabel: str(o.inspiratieLabel).slice(0, 240) || null,
        categorie: normCategory(o.categorie),
        uitvoerbaarheid: normEffort(o.uitvoerbaarheid),
        score: normScore(o.score),
        scoreReason: str(o.scoreReason),
        invalshoek: str(o.invalshoek).slice(0, 600),
        onderbouwing: evidenceList(o.onderbouwing),
        opportunity: o.opportunity ?? {},
        herhaalReden: str(o.herhaalReden) || null,
      };
    })
    .filter((x): x is IdeaDraft => x !== null)
    .slice(0, 6);

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
