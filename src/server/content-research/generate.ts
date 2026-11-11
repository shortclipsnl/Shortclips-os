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

Je bent de contentonderzoeker van Shortclips. Je voert ECHT web-onderzoek uit (zoeken en pagina's ophalen) naar actuele, relevante trends en voorbeelden voor de branche van deze klant, en schrijft een grondige BRIEFING in gewone tekst (GEEN JSON).

HARDE REGELS:
- Gebruik uitsluitend controleerbare, actuele bronnen. Verzin NOOIT cijfers (volgers, weergaven, bereik) en verzin NOOIT TikTok-/Reels-voorbeelden. Niet verifieerbaar? Laat het weg of schrijf het expliciet.
- Je kunt geen TikTok-video's "bekijken" — gebruik openbare trendartikelen, roundups, branche- en concurrentpagina's en publieke profielen, en benoem concreet welke pagina je gebruikte.
- Maak onderscheid tussen feit, inschatting en aanname.
- Blijf specifiek voor DEZE klant en branche; geen algemene marketingpraat.
- Sluit af met een lijst BRONNEN (titel — URL) met echte, werkende links.`;

function buildResearchUser(ctx: { clientName: string; sector: string | null; contextText: string; performanceText: string }): string {
  return `Onderzoek relevante, actuele contentkansen voor deze klant en schrijf een briefing.

KLANT: ${ctx.clientName}${ctx.sector ? ` (branche: ${ctx.sector})` : ""}
${ctx.performanceText ? `\n${ctx.performanceText.slice(0, 6000)}\n` : ""}
CONTEXT (intern — eerdere scripts, feedback, voorkeuren, prestaties):
${ctx.contextText.slice(0, 12000)}

Onderzoek en beschrijf, met concrete bronverwijzingen:
- TikTok-/Reels-trends in deze branche (en breder, creatieve formats uit andere branches die passen).
- Wat werkt bij vergelijkbare bedrijven/concurrenten (en wat we daarvan kunnen lenen).
- Veelgestelde vragen / pijnpunten van de doelgroep.
- Seizoens- of actualiteitskansen op dit moment.
- Opvallende, originele invalshoeken die passen bij deze klant.

Schrijf kopjes: TRENDS, WAT WERKT BIJ ANDEREN, VRAGEN VAN DE DOELGROEP, SEIZOEN/ACTUEEL, ORIGINELE INVALSHOEKEN, en sluit af met BRONNEN (titel — URL).`;
}

const IDEA_SYSTEM = `${SHORTCLIPS_IDENTITY}

Je bent de creatieve contentstrateeg van Shortclips en kent deze klant goed. Je zet een onderzoeksbriefing om in originele, concrete ideeën voor organische short video's (TikTok/Reels). GEEN standaard-AI-ideeën: elk idee is specifiek voor deze klant en onderbouwd door het onderzoek.

HARDE REGELS:
- Verzin GEEN cijfers of nepvoorbeelden. Een inspiratiebron-URL geef je alléén als die echt in de briefing/bronnen staat; anders null.
- Vergelijk ieder idee INHOUDELIJK met de reeds bestaande ideeën en eerdere scripts (hieronder). Stel niets voor dat daar inhoudelijk op lijkt, en niets uit de lijst afgekeurde concepten.
- Liever 4 uitstekende ideeën dan 10 matige. Maximaal 10.
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

AL BESTAANDE IDEEËN (niet herhalen, ook niet qua inhoud):
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
      "score": 8,
      "scoreReason": "korte onderbouwing"
    }
  ],
  "bronnen": [ { "label": "", "url": "" } ]
}`;
}

/**
 * Twee-fasen generatie: (1) echt web-onderzoek met Sonnet → vrije briefing,
 * (2) de briefing + klantcontext → originele ideeën + bijgewerkt Content DNA met
 * Opus (sterker/origineler). Spiegelt het bewezen sales-research-patroon.
 */
export async function researchAndIdeate(input: {
  clientName: string;
  sector: string | null;
  contextText: string;
  dnaText: string;
  existingIdeasText: string;
  priorScriptsText: string;
  /** Prestaties uit echte cijfers + goedgekeurde maandrapportages (sturend). */
  performanceText?: string;
}): Promise<{ ok: true; data: ResearchOutput } | { ok: false; reason: "no_provider" | "error"; error?: string }> {
  const performanceText = input.performanceText ?? "";
  // ── Fase 1 — echt web-onderzoek → briefing in gewone tekst ──
  const briefing = await runResearch({
    system: RESEARCH_SYSTEM,
    user: buildResearchUser({ clientName: input.clientName, sector: input.sector, contextText: input.contextText, performanceText }),
    maxUses: 12,
    maxTokens: 12000,
  });
  if (!briefing.ok) return briefing;

  // ── Fase 2 — briefing → ideeën + Content DNA (Opus, zuivere JSON, geen web) ──
  const ideaInput = {
    system: IDEA_SYSTEM,
    user: buildIdeaUser({
      clientName: input.clientName,
      briefing: briefing.text,
      dnaText: input.dnaText,
      existingIdeasText: input.existingIdeasText,
      priorScriptsText: input.priorScriptsText,
      performanceText,
    }),
    model: aiModelStrong(),
    maxTokens: 12000,
  };
  type Raw = { trends?: unknown; contentDna?: unknown; ideeen?: unknown[]; bronnen?: unknown[]; strategischAdvies?: unknown[] };
  let parsed = await runJsonPrompt<Raw>(ideaInput);
  if (!parsed.ok) parsed = await runJsonPrompt<Raw>(ideaInput);
  if (!parsed.ok) return parsed;

  const rawIdeas = Array.isArray(parsed.data.ideeen) ? parsed.data.ideeen : [];
  const ideeen: IdeaDraft[] = rawIdeas
    .map((raw): IdeaDraft | null => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const titel = str(o.titel);
      if (!titel) return null;
      return {
        titel: titel.slice(0, 240),
        concept: str(o.concept),
        hooks: strList(o.hooks, 5),
        waaromWerkt: str(o.waaromWerkt),
        doel: str(o.doel),
        inspiratieUrl: str(o.inspiratieUrl) || null,
        inspiratieLabel: str(o.inspiratieLabel).slice(0, 240) || null,
        categorie: normCategory(o.categorie),
        uitvoerbaarheid: normEffort(o.uitvoerbaarheid),
        score: normScore(o.score),
        scoreReason: str(o.scoreReason),
      };
    })
    .filter((x): x is IdeaDraft => x !== null)
    .slice(0, 10);

  const sources: Source[] = Array.isArray(parsed.data.bronnen)
    ? parsed.data.bronnen
        .map((b) => {
          const o = (b ?? {}) as Record<string, unknown>;
          const url = str(o.url);
          if (!url) return null;
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

  return {
    ok: true,
    data: {
      trends: strList(parsed.data.trends, 15),
      ideeen,
      sources,
      contentDna: normalizeDna(parsed.data.contentDna),
      briefing: briefing.text,
      strategischAdvies,
    },
  };
}
