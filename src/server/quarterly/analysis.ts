import "server-only";
import { aiConfigured, runJsonPrompt } from "@/server/ai/client";
import { SHORTCLIPS_IDENTITY } from "@/server/ai/identity";
import { normalizeIntern, normalizeKlant, type QuarterIntern, type QuarterKlant } from "@/lib/kwartaal-inhoud";
import type { QuarterMetrics } from "./metrics";

/**
 * AI-duiding van de kwartaalcijfers. De AI rekent niets uit en verzint niets:
 * alle cijfers komen uit `QuarterMetrics` (in code berekend). De uitkomst is
 * altijd een concept dat een medewerker controleert en goedkeurt.
 */

/** Ophogen als de opbouw van de rapportage wezenlijk verandert. */
export const KWARTAAL_ANALYSE_VERSIE = 1;

const BASIS = `${SHORTCLIPS_IDENTITY}

Je bent senior short-video strateeg bij Shortclips en schrijft de KWARTAALrapportage van één klant. Shortclips werkt als externe short video contentafdeling van de klant: concept, script, opname, montage, planning, publicatie en optimalisatie. De rapportage is strategisch en bedoeld voor een directeur, eigenaar of marketingmanager. Het is geen optelsom van drie maandrapporten.

Strikte regels:
- Baseer ALLES uitsluitend op de meegeleverde data. Verzin geen feiten, cijfers, oorzaken, leads, omzet, ROI of zakelijke impact.
- Gebruik alleen getallen die letterlijk in de data staan en schrijf ze voluit (geen "ruim 12 duizend", wel het cijfer uit de data). Reken zelf geen percentages, gemiddelden of verhoudingen uit.
- Een verklaring voor een stijging of daling is "bewezen" als die direct uit de cijfers volgt, "waarschijnlijk" als die aannemelijk is, en anders "hypothese". Benoem een hypothese in de tekst ook als vermoeden.
- Staat een waarde op null, dan is die niet gemeten. Zeg dat eerlijk en vul niets in.
- Is "conversies" null, dan is er geen conversiemeting: "impact.direct" blijft leeg ([]) en je noemt nergens leads, aanvragen, omzet of ROI als resultaat. Leg in "impact.nietMeetbaar" uit wat wel en niet gemeten is.
- Is "vorig.vergelijkbaar" false, dan maak je geen vergelijking met het vorige kwartaal en noem je geen groeipercentages. Is het true, gebruik dan alleen de percentages uit "vorig.pct".
- Staat "voorlopig" op true, dan loopt het kwartaal nog: schrijf dan over de cijfers tot nu toe en trek geen eindconclusies.
- Pakket: "pakket.type" bepaalt de invalshoek. organisch = zichtbaarheid, bereik, interactie, groei, contentprestaties en doelgroepinzichten. advertentie = creatieve prestaties van de advertentievideo's; mediabudget en campagneoptimalisatie vallen buiten de verantwoordelijkheid van Shortclips en er zijn geen advertentiecijfers gekoppeld, dus doe geen uitspraken over klikratio, kosten of leads. beide = benoem beide onderdelen apart en tel ze niet bij elkaar op. onbekend = schrijf neutraal en doe geen aannames over het pakket.
- "verbetermonitor": dit zijn de verbeterpunten uit het vorige kwartaal met hun status. Herhaal een punt dat nog "open" staat niet als nieuw advies; benoem dat het nog niet is uitgevoerd.
- Gebruik het contentgeheugen alleen als context voor wat bij deze klant werkt; het zijn verbanden, geen bewezen oorzaken.
- De video met de meeste weergaven is niet automatisch de beste. Weeg ook interactie, kijktijd en het doel van de klant.
- Schrijf zakelijk, concreet en natuurlijk Nederlands. Geen marketingtaal, geen opsommingen van drie bijvoeglijke naamwoorden, geen gedachtestreepjes.
- Verwijs naar een video met (een deel van) de titel, nooit met alleen de sleutel.

Geef UITSLUITEND één geldig JSON-object (geen markdown, geen tekst eromheen, geen dubbele aanhalingstekens of regeleinden binnen waarden, geen trailing komma's).`;

const KLANT_FORMAT = `{"directie":{"bereikt":"","opgeleverd":"","geleerd":"","volgend":""},"samenvatting":{"kern":"","resultaten":[""],"positief":"","inzichten":[""],"tegenvallers":[{"wat":"","oorzaak":"","zekerheid":"bewezen|waarschijnlijk|hypothese"}],"verbeterd":[""],"kans":"","advies":""},"opgeleverd":{"tekst":"","diensten":[""]},"trends":[{"titel":"","beschrijving":"","verklaring":"","zekerheid":""}],"topVideos":[{"key":"v1","waarom":"","meenemen":"","zekerheid":""}],"geleerd":{"onderwerpen":[{"punt":"","onderbouwing":"","zekerheid":""}],"hooks":[{"punt":"","onderbouwing":"","zekerheid":""}],"formats":[{"punt":"","onderbouwing":"","zekerheid":""}],"lengtes":[{"punt":"","onderbouwing":"","zekerheid":""}],"presentatoren":[{"punt":"","onderbouwing":"","zekerheid":""}],"doelgroep":[{"punt":"","onderbouwing":"","zekerheid":""}],"vaker":[""],"minder":[""]},"impact":{"direct":[""],"indirect":[""],"kwalitatief":[""],"nietMeetbaar":""},"verbeterpunten":[{"constatering":"","belang":"","actie":"","verwachtResultaat":"","verantwoordelijke":""}],"plan":{"binnenPakket":[{"titel":"","toelichting":""}],"aanvullend":[{"titel":"","toelichting":""}]},"conclusie":{"kern":"","bereikt":"","kansen":"","verbeteringen":"","prioriteiten":[""]}}`;

const KLANT_UITLEG = `Dit is de KLANTVERSIE. Eerlijk en opbouwend: tegenvallers worden kort en feitelijk uitgelegd, met de aanpak om ze te verbeteren. Niet alleen positief, niets mooier dan de cijfers. Geen interne opmerkingen, geen commerciële beoordelingen, geen opmerkingen over koppelingen of datakwaliteit (behalve in impact.nietMeetbaar, in gewone taal). Stel niet voor om doelen of KPI's met de klant af te spreken.

Velden:
- "directie": vier antwoorden van elk maximaal 45 woorden: wat hebben we bereikt, wat heeft het opgeleverd, wat hebben we geleerd, wat doen we volgend kwartaal.
- "samenvatting.kern": 3 tot 4 zinnen waarmee een directeur in 60 seconden weet hoe het kwartaal verliep. "resultaten": 3 tot 5 belangrijkste resultaten met cijfer. "positief": de grootste positieve ontwikkeling. "inzichten": 2 tot 3 inzichten uit de content. "tegenvallers": 0 tot 3, alleen als de cijfers ze laten zien. "verbeterd": wat Shortclips concreet heeft verbeterd (alleen als de data dat laat zien, anders []). "kans": de belangrijkste kans voor het volgende kwartaal. "advies": het advies voor de komende drie maanden.
- "opgeleverd.tekst": 2 tot 3 zinnen over wat Shortclips als externe contentafdeling heeft verzorgd, op basis van "geleverd". "diensten": alleen diensten waarvoor de data een aanwijzing geeft (concept en script bij concepten > 0, opnames bij opnamedagen > 0, montage bij geproduceerd > 0, planning en publicatie bij plaatsingen > 0).
- "trends": 2 tot 4 opvallende ontwikkelingen over de drie maanden (uit "segmenten"), elk met beschrijving en verklaring.
- "topVideos": 3 tot 5 video's uit "videos" (gebruik de "key"), met waarom deze vermoedelijk werkte en wat we meenemen.
- "geleerd": per categorie 0 tot 3 inzichten met onderbouwing uit de cijfers. Laat een categorie leeg ([]) als de data er niets over zegt (bijvoorbeeld geen presentator of format bekend). "vaker" en "minder": 2 tot 4 concrete punten.
- "impact": "direct" alleen bij gemeten klikken of conversies. "indirect": indicatoren zoals bereik, volgersgroei, profielbezoeken. "kwalitatief": inzichten zonder cijfer. "nietMeetbaar": één of twee zinnen over wat niet gemeten is.
- "verbeterpunten": maximaal 5, elk gebaseerd op een concreet cijfer of patroon van deze klant. "verantwoordelijke": een rol bij Shortclips (bijvoorbeeld projectmanager, scriptschrijver, videograaf, editor).
- "plan.binnenPakket": 3 tot 6 acties die binnen het bestaande pakket vallen. "plan.aanvullend": 0 tot 2 voorstellen die buiten het pakket vallen, duidelijk als voorstel geformuleerd.
- "conclusie": "kern" in 2 tot 3 zinnen, daarna bereikt, kansen, verbeteringen en 3 tot 4 prioriteiten.
Houd elk tekstveld onder de 60 woorden, tenzij hierboven anders staat.`;

const INTERN_FORMAT = `{"kern":"","risicos":[{"titel":"","toelichting":""}],"kritisch":[""],"gesprek":[""],"commercieel":[{"kans":"","onderbouwing":""}],"acties":[{"actie":"","rol":"script|opname|montage|pm","waarom":""}],"opvolging":""}`;

const INTERN_UITLEG = `Dit is de INTERNE versie, alleen voor het team van Shortclips. Wees kritisch op ons eigen werk.

Velden:
- "kern": 3 tot 4 zinnen: hoe staat deze samenwerking er werkelijk voor.
- "risicos": 0 tot 4 risico's voor de resultaten of de samenwerking, onderbouwd met de data.
- "kritisch": 2 tot 5 kritische verbeterpunten voor Shortclips zelf (kwaliteit, tempo, opvolging, datakwaliteit).
- "gesprek": 3 tot 5 adviezen voor het kwartaalgesprek met de klant: wat benoemen, welke vraag stellen, waar eerlijk over zijn.
- "commercieel": 0 tot 3 commerciële kansen, alleen als de data er aanleiding voor geeft.
- "acties": 4 tot 8 concrete acties voor het team met de rol die het uitvoert.
- "opvolging": oordeel over de verbeterpunten uit het vorige kwartaal ("verbetermonitor"): wat is uitgevoerd, wat niet, en wat betekent dat. Leeg laten ("") als er geen vorige rapportage is.
Houd elk tekstveld onder de 60 woorden.`;

export type QuarterAnalysisInput = {
  clientName: string;
  metrics: QuarterMetrics;
  doelstelling: string;
  contentgeheugen: string;
  /** Opmerkingen van de controleur die in deze versie verwerkt moeten worden. */
  feedback?: string[];
};

export type QuarterAnalysisResult =
  | { ok: true; klant: QuarterKlant; intern: QuarterIntern; model: string; internMislukt: boolean }
  | { ok: false; reason: "no_provider" | "error"; message?: string };

function dataBlock(input: QuarterAnalysisInput) {
  const m = input.metrics;
  return {
    klant: input.clientName,
    periode: m.periode,
    voorlopig: m.voorlopig,
    doelstelling: input.doelstelling || "Niet ingesteld",
    pakket: m.pakket,
    totaal: m.totaal,
    segmenten: m.segmenten,
    kijktijd: m.kijktijd,
    profielbezoeken: m.profielbezoeken,
    websiteKlikken: m.websiteKlikken,
    conversies: m.conversies,
    platforms: m.platforms,
    geleverd: m.geleverd,
    formats: m.formats,
    vorig: m.vorig,
    doelen: m.doelen,
    verbetermonitor: m.verbetermonitor,
    advertenties: m.advertenties,
    nietGemeten: [...m.ontbrekend, ...m.dataKwaliteit],
    videos: m.videos.slice(0, 30).map((v) => ({
      key: v.key, titel: v.titel, datum: v.datum, kanalen: v.platforms, weergaven: v.views, likes: v.likes, reacties: v.reacties,
      shares: v.shares, saves: v.saves, interactiesPer100Weergaven: v.engagementPct, gemKijktijdSec: v.gemKijktijdSec,
      uitkijkpercentage: v.uitkijkPct, duurSec: v.duurSec, hook: v.hook, cta: v.cta, format: v.format, pijler: v.pijler,
      presentator: v.presentator, caption: v.hook ? null : (v.caption ?? "").slice(0, 200),
    })),
    contentgeheugen: input.contentgeheugen || null,
    feedbackVanControleur: input.feedback?.length ? input.feedback : null,
  };
}

/**
 * Vangnet na de AI: zorgt dat de inhoud nooit iets beweert wat de cijfers niet
 * dragen. Topvideo's moeten bestaan; zonder conversiemeting geen direct
 * meetbare zakelijke resultaten.
 */
export function enforceFacts(klant: QuarterKlant, m: QuarterMetrics): QuarterKlant {
  const keys = new Set(m.videos.filter((v) => v.views > 0).map((v) => v.key));
  let top = klant.topVideos.filter((t) => keys.has(t.key));
  if (top.length < Math.min(3, keys.size)) {
    const have = new Set(top.map((t) => t.key));
    for (const v of m.videos) {
      if (top.length >= Math.min(3, keys.size)) break;
      if (v.views > 0 && !have.has(v.key)) top.push({ key: v.key, waarom: "", meenemen: "", zekerheid: "hypothese" });
    }
  }
  top = top.slice(0, 5);
  const geenMeting = m.conversies === null && m.websiteKlikken === null;
  return {
    ...klant,
    topVideos: top,
    impact: {
      ...klant.impact,
      direct: geenMeting ? [] : klant.impact.direct,
      nietMeetbaar: klant.impact.nietMeetbaar || (m.conversies === null
        ? "Er is geen conversiemeting gekoppeld. Aanvragen, leads en omzet uit de content zijn daardoor niet vast te stellen. Bereik, interactie en volgersgroei zijn wel gemeten."
        : ""),
    },
  };
}

export async function generateQuarterAnalysis(input: QuarterAnalysisInput): Promise<QuarterAnalysisResult> {
  if (!aiConfigured()) return { ok: false, reason: "no_provider" };
  const data = JSON.stringify(dataBlock(input));
  const started = Date.now();
  const ask = async (system: string, maxTokens: number) => {
    const req = { system, user: `Data (JSON):\n${data}`, maxTokens };
    let r = await runJsonPrompt<Record<string, unknown>>(req);
    if (!r.ok && r.reason === "error" && Date.now() - started < 90_000) r = await runJsonPrompt<Record<string, unknown>>(req);
    return r;
  };
  // Klantversie en interne versie parallel: korter dan één lange aanroep en
  // de interne opmerkingen kunnen zo nooit in de klanttekst terechtkomen.
  const [klantRes, internRes] = await Promise.all([
    ask(`${BASIS}\n\n${KLANT_UITLEG}\n\nFormaat:\n${KLANT_FORMAT}`, 16000),
    ask(`${BASIS}\n\n${INTERN_UITLEG}\n\nFormaat:\n${INTERN_FORMAT}`, 8000),
  ]);
  if (!klantRes.ok) return { ok: false, reason: klantRes.reason === "no_provider" ? "no_provider" : "error", message: klantRes.error };
  const klant = enforceFacts(normalizeKlant(klantRes.data), input.metrics);
  if (!klant.samenvatting.kern && !klant.conclusie.kern) return { ok: false, reason: "error", message: "De AI-analyse leverde geen bruikbare rapportage op." };
  const internRaw = internRes.ok ? ((internRes.data as { intern?: unknown }).intern ?? internRes.data) : {};
  return { ok: true, klant, intern: normalizeIntern(internRaw), model: klantRes.model, internMislukt: !internRes.ok };
}
