import "server-only";
import { aiModelStrong, runStructured } from "@/server/ai/client";
import type { IdeaDraft } from "./generate";
import { wellFormed } from "./generate";
import { MIN_STIJL_FIT, MIN_TOTAAL, normalizeKeuring, QUALITY_PARTS, type Keuring } from "./quality";

/**
 * De keuring: een aparte, strenge beoordeling van de kandidaat-ideeën door een
 * "eindredacteur" die alleen het stijlprofiel, de videodata en de eerdere
 * onderwerpen ziet. Bewust een tweede aanroep: wie de ideeën bedacht, is niet
 * de beste beoordelaar van zijn eigen werk.
 */

const JUDGE_SYSTEM = `Je bent de strengste eindredacteur van Shortclips. Je beoordeelt kandidaat-ideeën voor short video's van één klant voordat het team ze te zien krijgt. Alleen ideeën die je met overtuiging zou laten opnemen, mogen door. Een gemiddeld idee is géén 8.

Beoordeel elk idee op (0-10):
1. stijlFit: klinken hooks, middenstuk en CTA's onmiskenbaar als de ECHTE scripts van deze klant (stijlprofiel)? Zelfde format, aanspreekvorm, zinsbouw, energie en woordkeuze? Alles wat onder PAST NIET of de teamcorrecties valt is een stijlprobleem. Een zin die de scriptschrijver van deze klant nooit zou schrijven is een stijlprobleem. 9-10 = niet te onderscheiden van de echte scripts. 8 = past, kleine twijfel. 7 of lager = merkbaar anders.
2. bewezenPatroon: lijkt het onderwerp/hookpatroon op wat aantoonbaar werkte (bewezen hooks in het stijlprofiel, sterke video's in de videodata)? basis = "data" alleen bij een aanwijsbare sterke video of bewezen hook (noem die), "scripts" als het patroon vaak in de scripts terugkomt zonder resultaatbewijs, anders "inschatting".
3. relevantie: past het bij doelgroep, doel en dit moment (seizoen, vragen uit de briefing)?
4. originaliteit: is het ONDERWERP nieuw ten opzichte van de al behandelde onderwerpen en eerdere ideeën? Een bewezen format of hookpatroon hergebruiken met een nieuw onderwerp of een nieuw object (andere woning, ander model, andere regel, andere medewerker) is juist de bedoeling en scoort 8 of hoger. Laag alleen als het onderwerp zelf al (bijna) zo behandeld is.
5. uitvoerbaarheid: goed te filmen op een opnamedag bij deze klant, zonder dingen die de klant niet heeft? Iets wat de klant structureel heeft (aanbod woningen of chalets, medewerkers, wagenpark) en via een plaatshouder wordt ingevuld, is uitvoerbaar.

Verder:
- afwijkendeHooks: de nummers (1, 2 of 3) van hooks die NIET bij de stijl van de klant passen of te zwak zijn. Die hooks vallen weg; beoordeel stijlFit ALLEEN op wat overblijft (de andere hooks, middenstuk en CTA's).
- stijlProblemen: ALLEEN zware problemen: zinnen uit het middenstuk of de CTA's die duidelijk niet klinken als deze klant (toon, woordkeuze, vorm), of inhoudelijk onjuist zijn. Citeer de zin en zeg kort waarom. Problemen met een hook horen hier NIET: die hook zet je bij afwijkendeHooks. Leeg als er geen zijn.
- aanscherpen: lichte verbeterpunten die het team bij het uitwerken kan meenemen (een bedrag noemen, iets preciezer formuleren, een voorbeeld afmaken). Deze tellen NIET als stijlprobleem. Max. 3.
- Plaatshouders ([bedrag], [MODELNAAM], [plaats]) voor gegevens die de klant op de opnamedag aanlevert of die nog gecontroleerd moeten worden, zijn GEEN stijlprobleem als de scripts van de klant ook met plaatshouders werken. Wel een probleem: een vage zin waar de echte scripts een concreet voorbeeld of bedrag geven.
- oordeel: één zin waarom dit idee wel of niet sterk is.
- Toelichtingen max. 15 woorden. Verzin geen data.`;

const s_ = { type: "string" } as const;
const i_ = { type: "integer" } as const;
const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["beoordelingen"],
  properties: {
    beoordelingen: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "nr", "stijlFit", "stijlFitToelichting", "afwijkendeHooks", "stijlProblemen", "aanscherpen",
          "bewezenPatroon", "bewezenPatroonBasis", "bewezenPatroonToelichting",
          "relevantie", "relevantieToelichting", "originaliteit", "originaliteitToelichting",
          "uitvoerbaarheid", "uitvoerbaarheidToelichting", "oordeel",
        ],
        properties: {
          nr: i_,
          stijlFit: i_,
          stijlFitToelichting: s_,
          afwijkendeHooks: { type: "array", items: i_ },
          stijlProblemen: { type: "array", items: s_ },
          aanscherpen: { type: "array", items: s_ },
          bewezenPatroon: i_,
          bewezenPatroonBasis: s_,
          bewezenPatroonToelichting: s_,
          relevantie: i_,
          relevantieToelichting: s_,
          originaliteit: i_,
          originaliteitToelichting: s_,
          uitvoerbaarheid: i_,
          uitvoerbaarheidToelichting: s_,
          oordeel: s_,
        },
      },
    },
  },
};

function candidateText(c: IdeaDraft, nr: number): string {
  return [
    `### IDEE ${nr}: ${c.titel}`,
    `Concept: ${c.concept}`,
    `Hooks:\n${c.hooks.map((h, i) => `${i + 1}. ${h}`).join("\n")}`,
    `Middenstuk:\n${c.middenstuk.join("\n")}`,
    `CTA commercieel: ${c.ctaCommercieel}`,
    `CTA interactie: ${c.ctaInteractie}`,
    `Doel: ${c.doel}`,
    c.onderbouwing.length ? `Onderbouwing volgens de bedenker: ${c.onderbouwing.map((e) => `${e.tekst} (${e.zekerheid})`).join(" | ")}` : "",
  ].filter(Boolean).join("\n");
}

export type JudgedCandidate = IdeaDraft & { keuring: Keuring; verwijderdeHooks: string[] };

function norm(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9€ ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Gaat dit probleem over een van de hooks? Dan het nummer van die hook, anders -1. */
export function hookIndexInProblem(problem: string, hooks: string[]): number {
  const p = norm(problem);
  for (let i = 0; i < hooks.length; i++) {
    const h = norm(hooks[i] ?? "");
    if (h.length < 12) continue;
    // De hele hook, of de eerste 40 tekens ervan, letterlijk in de melding.
    if (p.includes(h) || p.includes(h.slice(0, 40))) return i;
  }
  return -1;
}

export async function judgeCandidates(input: {
  clientName: string;
  styleText: string;
  videoText: string;
  existingText: string;
  candidates: IdeaDraft[];
  hasVideoData: boolean;
  hasProvenHooks: boolean;
  model?: string;
}): Promise<{ ok: true; judged: JudgedCandidate[] } | { ok: false; error: string }> {
  if (input.candidates.length === 0) return { ok: true, judged: [] };
  const user = wellFormed([
    `KLANT: ${input.clientName}`,
    `STIJLPROFIEL UIT DE ECHTE SCRIPTS (de maatstaf):\n${input.styleText.slice(0, 9000) || "(geen scripts beschikbaar: wees extra streng op generieke taal)"}`,
    input.videoText ? input.videoText.slice(0, 5000) : "VIDEODATA: geen bruikbare videodata. bewezenPatroon kan dan alleen op bewezen hooks uit het stijlprofiel rusten.",
    `AL BEHANDELD / EERDER VOORGESTELD:\n${input.existingText.slice(0, 4000) || "(geen)"}`,
    `KANDIDATEN:\n\n${input.candidates.map((c, i) => candidateText(c, i + 1)).join("\n\n")}`,
    `Beoordeel alle ${input.candidates.length} kandidaten. Drempel voor het team: kwaliteitsscore ${MIN_TOTAAL}+ (gewichten ${QUALITY_PARTS.map((p) => `${p.label} ${p.gewicht}%`).join(", ")}) en stijl-fit minimaal ${MIN_STIJL_FIT}.`,
  ].join("\n\n"));

  const res = await runStructured<{ beoordelingen: Array<Record<string, unknown>> }>({
    system: JUDGE_SYSTEM,
    user,
    model: input.model ?? aiModelStrong(),
    maxTokens: 12000,
    schema: JUDGE_SCHEMA,
    effort: "medium",
  });
  if (!res.ok) return { ok: false, error: res.error ?? res.reason };

  const byNr = new Map<number, Record<string, unknown>>();
  for (const b of res.data.beoordelingen ?? []) {
    const nr = Number(b.nr);
    if (Number.isInteger(nr)) byNr.set(nr, b);
  }

  const judged: JudgedCandidate[] = input.candidates.map((c, i) => {
    const raw = { ...(byNr.get(i + 1) ?? {}) };
    const off = new Set(
      (Array.isArray(raw.afwijkendeHooks) ? raw.afwijkendeHooks : [])
        .map((n) => Number(n) - 1)
        .filter((n) => Number.isInteger(n) && n >= 0 && n < c.hooks.length),
    );
    // Een "stijlprobleem" dat over een hook gaat, telt als afgekeurde hook: die
    // hook valt weg en drukt de stijl-fit van de rest niet.
    const problems = (Array.isArray(raw.stijlProblemen) ? raw.stijlProblemen : []).filter((p): p is string => typeof p === "string");
    raw.stijlProblemen = problems.filter((p) => {
      const idx = hookIndexInProblem(p, c.hooks);
      if (idx < 0) return true;
      off.add(idx);
      return false;
    });
    const keptHooks = c.hooks.filter((_, idx) => !off.has(idx));
    const verwijderdeHooks = c.hooks.filter((_, idx) => off.has(idx));
    let keuring = normalizeKeuring(raw, { hasVideoData: input.hasVideoData, hasProvenHooks: input.hasProvenHooks });
    if (!byNr.has(i + 1)) {
      keuring = { ...keuring, geslaagd: false, afwijsReden: "niet beoordeeld" };
    } else if (keptHooks.length === 0) {
      keuring = { ...keuring, geslaagd: false, afwijsReden: "geen enkele hook past bij de stijl van de klant" };
    }
    return { ...c, hooks: keptHooks.length ? keptHooks : c.hooks, keuring, verwijderdeHooks };
  });
  return { ok: true, judged };
}

/* ------------------------------ Verbeterronde ------------------------------ */

const REVISE_SYSTEM = `Je bent de vaste scriptschrijver van Shortclips voor deze klant. De eindredactie keurde een paar ideeën net af en wees precies aan welke zinnen en hooks niet kloppen. Je doet een GERICHTE CORRECTIE, geen herschrijving: alleen de aangewezen zinnen en hooks vervang je; al het andere blijft letterlijk staan.

Regels:
- "vervangingen": per aangewezen zin uit middenstuk of CTA de oude zin (letterlijk zoals hij er staat) en de nieuwe zin. Alleen zinnen die de eindredactie noemde, of die nodig zijn om een genoemd zwak punt op te lossen.
- "nieuweHooks": vervangers voor de afgekeurde hooks (zoveel als er afgekeurd zijn), elk volgens een hookpatroon of voorbeeldhook uit het stijlprofiel. Leeg als er geen hooks afgekeurd zijn.
- Vul feiten (bedragen, datums, regels) alleen in als ze letterlijk in de briefing of de scripts staan; anders een plaatshouder zoals de scripts die gebruiken. Verzin geen cijfers.`;

const REVISE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["correcties"],
  properties: {
    correcties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nr", "vervangingen", "nieuweHooks"],
        properties: {
          nr: i_,
          vervangingen: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["oud", "nieuw"], properties: { oud: s_, nieuw: s_ } },
          },
          nieuweHooks: { type: "array", items: s_ },
        },
      },
    },
  },
};

/** Welke afgekeurde kandidaten de moeite van één correctieronde waard zijn. */
export function pickRevisable(judged: JudgedCandidate[], want: number): JudgedCandidate[] {
  if (want <= 0) return [];
  return judged
    .filter((c) => !c.keuring.geslaagd && c.keuring.afwijsReden !== "niet beoordeeld")
    // Alleen wat op de inhoud al sterk is: stijl valt te corrigeren, een zwak of
    // herhaald onderwerp niet.
    .filter((c) => {
      const o = c.keuring.onderdelen;
      return o.originaliteit.score >= 6 && o.relevantie.score >= 7 && o.uitvoerbaarheid.score >= 7 && o.bewezenPatroon.score >= 6
        && (c.keuring.stijlProblemen.length > 0 || c.verwijderdeHooks.length > 0 || o.stijlFit.score < 8);
    })
    .sort((a, b) => b.keuring.totaal - a.keuring.totaal)
    .slice(0, Math.min(5, want + 2));
}

function same(a: string, b: string): boolean {
  const n = (t: string) => t.toLowerCase().replace(/[^a-z0-9€]+/g, "");
  return n(a) === n(b) || (n(b).length > 12 && n(a).includes(n(b)));
}

/** Past de correcties toe op een kandidaat (alleen aangewezen regels). */
export function applyCorrections(
  c: JudgedCandidate,
  corr: { vervangingen: Array<{ oud: string; nieuw: string }>; nieuweHooks: string[] },
): IdeaDraft {
  const swap = (line: string) => {
    const hit = corr.vervangingen.find((v) => v.oud.trim() && same(line, v.oud));
    return hit ? hit.nieuw.trim() : line;
  };
  const middenstuk = c.middenstuk.map(swap).filter(Boolean);
  const hooks = [...c.hooks.map(swap), ...corr.nieuweHooks.map((h) => h.trim()).filter(Boolean)].slice(0, 3);
  const { keuring: _k, verwijderdeHooks: _v, ...base } = c;
  void _k;
  void _v;
  return {
    ...base,
    hooks,
    middenstuk,
    ctaCommercieel: swap(c.ctaCommercieel),
    ctaInteractie: swap(c.ctaInteractie),
  };
}

/**
 * Eén correctieronde: bij de bijna-goede kandidaten worden alleen de door de
 * eindredactie aangewezen zinnen en hooks vervangen. Daarna wordt OPNIEUW
 * gekeurd met dezelfde strenge maatstaf; de drempel verandert niet.
 */
export async function reviseCandidates(input: {
  clientName: string;
  styleText: string;
  briefing: string;
  items: JudgedCandidate[];
  model?: string;
}): Promise<{ ok: true; revised: Array<{ from: JudgedCandidate; idea: IdeaDraft }> } | { ok: false; error: string }> {
  if (input.items.length === 0) return { ok: true, revised: [] };
  const blocks = input.items.map((c, i) => {
    const k = c.keuring;
    const zwak = QUALITY_PARTS.filter((p) => k.onderdelen[p.key].score < 8).map((p) => `${p.label} ${k.onderdelen[p.key].score}/10: ${k.onderdelen[p.key].toelichting}`);
    return [
      candidateText(c, i + 1),
      c.verwijderdeHooks.length ? `AFGEKEURDE HOOKS (${c.verwijderdeHooks.length} vervangen): ${c.verwijderdeHooks.join(" | ")}` : "",
      `OORDEEL EINDREDACTIE: ${k.oordeel}`,
      k.stijlProblemen.length ? `AANGEWEZEN ZINNEN:\n- ${k.stijlProblemen.join("\n- ")}` : "",
      zwak.length ? `Zwakke punten:\n- ${zwak.join("\n- ")}` : "",
    ].filter(Boolean).join("\n");
  });
  const user = wellFormed([
    `KLANT: ${input.clientName}`,
    `STIJLPROFIEL UIT DE ECHTE SCRIPTS:\n${input.styleText.slice(0, 9000)}`,
    `BRIEFING (feiten die je mag gebruiken):\n${input.briefing.slice(0, 10000)}`,
    `TE CORRIGEREN:\n\n${blocks.join("\n\n")}`,
    `Lever voor elk idee (nr 1 t/m ${input.items.length}) de correcties.`,
  ].join("\n\n"));
  const res = await runStructured<{ correcties: Array<{ nr: number; vervangingen: Array<{ oud: string; nieuw: string }>; nieuweHooks: string[] }> }>({
    system: REVISE_SYSTEM,
    user,
    model: input.model ?? aiModelStrong(),
    maxTokens: 8000,
    schema: REVISE_SCHEMA,
    effort: "medium",
  });
  if (!res.ok) return { ok: false, error: res.error ?? res.reason };
  const revised: Array<{ from: JudgedCandidate; idea: IdeaDraft }> = [];
  for (const r of res.data.correcties ?? []) {
    const orig = input.items[Number(r.nr) - 1];
    if (!orig || revised.some((x) => x.from === orig)) continue;
    const idea = applyCorrections(orig, { vervangingen: r.vervangingen ?? [], nieuweHooks: r.nieuweHooks ?? [] });
    if (idea.hooks.length === 0) continue;
    revised.push({ from: orig, idea });
  }
  return { ok: true, revised };
}
