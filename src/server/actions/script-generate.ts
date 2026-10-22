"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { clients, scripts, scriptVersions } from "@/db/schema";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { aiConfigured, runPrompt } from "@/server/ai/client";
import { scriptGeneratorSystem } from "@/server/scripts/scripthandboek";
import { getClientAiProfile, captionProfileToText, clientLearnedText, centralKnowledgeText, type CaptionProfile } from "@/server/ai/knowledge";
import { gatherFeedbackContext, estimateSpeakingTime, DEFAULT_WPM } from "@/server/script-control";
import { getClientWinningPatterns } from "@/server/scripts/winning-patterns";
import { getClientDriveScriptPdfs } from "@/server/scripts/drive-scripts";
import { getIntelligenceOverview } from "@/server/video-intelligence/intelligence";

export type GeneratedScript = { onderwerp: string; tekst: string };
type Result =
  | { ok: true; scripts: GeneratedScript[]; klantnaam: string }
  | { ok: false; message: string };

const MAX_SCRIPTS = 8;
const MAX_PDFS = 3;

/** Vaste opmaak- en nadrukregels — gedeeld door genereren en aanpassen. */
const FORMAT_RULES = [
  "OPMAAK (strikt aanhouden):",
  "- Blokken in deze vaste volgorde, elk met een lege regel ervoor en erna: SHORTCLIP UITLEG, HOOK, MIDDENSTUK, CALL TO ACTION, SOCIAL MEDIA POLL KEUZES (die laatste alleen als relevant).",
  "- Elke KOP op een eigen regel, volledig in HOOFDLETTERS. Daarna één lege regel, dan de tekst, dan weer een lege regel.",
  "- SHORTCLIP UITLEG: precies drie volledige zinnen (wat de kijker ziet, de opbouw, waarom het concept werkt).",
  "- MIDDENSTUK: elke zin op een eigen regel.",
  "- Leg nadruk door af en toe een kernwoord in HOOFDLETTERS te zetten en door vraag- of uitroeptekens te gebruiken waar dat natuurlijk is (maximaal twee uitroeptekens per script).",
  "- Laat de VIDEOTITEL-kop weg; de titel staat al bovenaan de pagina.",
  "- Geen markdown, geen sterretjes, geen codeblokken.",
];

/** Kwaliteits- en datagedreven regels: schrijf wat aantoonbaar werkt, op Jarno-niveau. */
const QUALITY_RULES = [
  "KWALITEIT (het doel is scripts op het niveau van de beste scriptschrijver, zodat elk teamlid dit zelfstandig kan):",
  "- Schrijf niet zomaar iets: kies onderwerpen en invalshoeken die aantoonbaar werken. Spiegel de best presterende hooks en concepten van deze klant (uit de meegeleverde cijfers en eerdere scripts) — kopieer ze niet, maak ze beter.",
  "- Haal stijl, woordgebruik, scriptlengte en openingsstijl uit de eerdere scripts van deze klant.",
  "- Zorg dat elk script echt TikTok- en Reels-waardig is: sterke hook in 3 seconden, hoge retentie, concreet en bruikbaar.",
  "- Volg strikt de Shortclips scriptstijl uit het handboek. Twijfel je of een zin sterk genoeg is, herschrijf hem.",
];

/** Regels voor iteratief aanpassen: alleen verwerken wat gevraagd is, de rest met rust laten. */
const REVISE_RULES = [
  "REGELS BIJ AANPASSEN (strikt):",
  "- Verwerk de feedback alleen op dit specifieke script. Laat alles waar de gebruiker niets over zegt exact staan.",
  "- Is het script in de basis goed, behoud dan de structuur en opbouw en verbeter uitsluitend de genoemde punten.",
  "- Neem aangeleverde zinnen, feiten, prijzen, specificaties en scènebeschrijvingen letterlijk en nauwkeurig over. Verzin geen cijfers of specificaties.",
  "- Hook sterker = pak specifiek de eerste zinnen en de nieuwsgierigheid aan, zonder de clou weg te geven.",
  "- Meer waarde = voeg relevante, controleerbare informatie, uitleg of een concreet voorbeeld toe.",
  "- Minder commercieel = verschuif de focus naar de kijker en haal verkooppraat weg.",
  "- Meer humor = verbeter humor en herkenbaarheid zonder het concept te verliezen.",
  "- Korter = schrap overbodige tekst, behoud de kern en de sterke zinnen.",
  "- Voeg geen CTA, beeldsuggesties of opname-uitleg toe als die er niet om gevraagd worden.",
  "- Houd korte, natuurlijke spreektaal aan die makkelijk te presenteren is.",
];

type ScriptsPayload = { scripts?: Array<{ onderwerp?: unknown; regels?: unknown; tekst?: unknown }> };

/** Redt complete script-objecten uit het antwoord, ook als het JSON is afgekapt
 *  (bijv. bij de token-limiet): we matchen elk volledig {"onderwerp",...,"regels":[...]}. */
function salvageScripts(raw: string): ScriptsPayload | null {
  const re = /\{\s*"onderwerp"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"regels"\s*:\s*(\[(?:[^[\]]|\\.)*\])\s*\}/g;
  const scripts: Array<{ onderwerp: string; regels: unknown }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    try {
      const onderwerp = JSON.parse(`"${m[1]}"`) as string;
      const regels = JSON.parse(m[2]!) as unknown;
      scripts.push({ onderwerp, regels });
    } catch { /* dit object overslaan */ }
  }
  return scripts.length ? { scripts } : null;
}

/** Leest het JSON-antwoord van het model, ook als er ```-fences of wat tekst omheen staan,
 *  of als het antwoord is afgekapt (dan redden we de complete scripts). */
function parseScriptsJson(raw: string): ScriptsPayload | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const tryParse = (s: string): ScriptsPayload | null => {
    try { return JSON.parse(s) as ScriptsPayload; } catch { return null; }
  };
  return (
    tryParse(cleaned) ??
    (() => {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const parsed = tryParse(cleaned.slice(start, end + 1));
        if (parsed) return parsed;
      }
      return salvageScripts(cleaned);
    })()
  );
}

/**
 * Verzamelt de volledige live klantcontext voor de schrijver: stijl, afspraken,
 * geleerde voorkeuren, best presterende hooks (echte cijfers), Video Intelligence,
 * eerder gebruikte onderwerpen (tegen herhaling) en de algemene Shortclips-richtlijnen.
 * Dezelfde bron als de scriptcontrole, zodat genereren en controleren gelijk denken.
 */
async function clientContext(viewer: Awaited<ReturnType<typeof requirePermission>>, clientId: string): Promise<{ name: string; slug: string; extra: string; wpm: number | null } | null> {
  const [c] = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!c) return null;
  assertClientAccess(viewer, c.id);
  const [profile, learned, feedback, patterns, central, intel, recent] = await Promise.all([
    getClientAiProfile(c.id),
    clientLearnedText(c.id),
    gatherFeedbackContext(c.id),
    getClientWinningPatterns(viewer, c.id).catch(() => null),
    centralKnowledgeText(["schrijfstijl", "branding", "kwaliteit"]).catch(() => ""),
    getIntelligenceOverview(viewer, c.slug).catch(() => null),
    db.select({ title: scripts.title }).from(scripts)
      .where(and(eq(scripts.clientId, c.id), isNull(scripts.deletedAt)))
      .orderBy(desc(scripts.createdAt)).limit(15).catch(() => [] as Array<{ title: string }>),
  ]);

  const viLines = intel
    ? [
        intel.speech?.avgWpm ? `Gemiddelde spreeksnelheid uit Video Intelligence: ${intel.speech.avgWpm} wpm (houd de lengte hierop af).` : "",
        intel.hooks?.length ? `Veelgebruikte hooktypes in eerdere video's: ${intel.hooks.slice(0, 5).map((h) => h.key).join(", ")}.` : "",
      ].filter(Boolean).join("\n")
    : "";

  const extra = [
    `Klant: ${c.name}.`,
    profile ? captionProfileToText(profile.captionProfile as CaptionProfile) : "",
    feedback.afspraken ? `Communicatie-afspraken: ${feedback.afspraken}` : "",
    feedback.aandachtspunten ? `Aandachtspunten: ${feedback.aandachtspunten}` : "",
    feedback.recenteKlantopmerkingen.length ? `Recente klantopmerkingen op eerdere video's:\n- ${feedback.recenteKlantopmerkingen.join("\n- ")}` : "",
    learned ? `Geleerde voorkeuren en correcties van deze klant:\n${learned}` : "",
    patterns && patterns.count > 0 ? `Best presterende hooks van deze klant (echte cijfers — spiegelen, niet kopiëren):\n${patterns.top.map((p) => `- "${p.hook}" (${p.views} views)`).join("\n")}` : "",
    viLines,
    recent.length ? `Eerder geschreven onderwerpen voor deze klant (voorkom herhaling, tenzij je een sterk format bewust opnieuw gebruikt):\n- ${recent.map((r) => r.title).join("\n- ")}` : "",
    central ? `Algemene Shortclips-richtlijnen:\n${central}` : "",
  ].filter(Boolean).join("\n\n");
  return { name: c.name, slug: c.slug, extra, wpm: intel?.speech?.avgWpm && intel.speech.avgWpm > 60 ? intel.speech.avgWpm : null };
}

/**
 * Schrijft in één keer `count` complete organische short video scripts, zonder
 * tussenvragen. De stijl + het handboek komen uit scriptGeneratorSystem; de
 * klantcontext (indien gekozen) wordt meegeladen. Het model werkt uit eerdere
 * data en het handboek — nooit een website nodig.
 */
export async function generateScripts(input: {
  clientId?: string;
  clientName?: string;
  count: number;
  brief?: string;
  /** Tekst uit handmatig toegevoegde eerdere scripts (in de browser uit PDF gehaald). */
  priorText?: string;
  /** Eerdere scripts automatisch uit de Drive-map van de klant halen. */
  useDriveScripts?: boolean;
}): Promise<Result> {
  try {
    const viewer = await requirePermission("ai:read");
    if (!aiConfigured()) return { ok: false, message: "De AI-schrijver staat uit (ANTHROPIC_API_KEY ontbreekt)." };

    const count = Math.max(1, Math.min(MAX_SCRIPTS, Math.round(input.count || 1)));

    let extra = "";
    let klantnaam = (input.clientName ?? "").trim();
    if (input.clientId) {
      const ctx = await clientContext(viewer, input.clientId);
      if (ctx) { extra = ctx.extra; klantnaam = ctx.name; }
    }

    const brief = (input.brief ?? "").trim().slice(0, 4000);
    const priorText = (input.priorText ?? "").trim().slice(0, 24000);

    // Eerdere scripts uit Drive (server-side, dus geen upload-limiet).
    let documents: Array<{ base64: string; mediaType: "application/pdf" }> = [];
    if (input.useDriveScripts && input.clientId) {
      try {
        const drivePdfs = await getClientDriveScriptPdfs(input.clientId, MAX_PDFS);
        documents = drivePdfs.map((p) => ({ base64: p.base64, mediaType: "application/pdf" as const }));
      } catch { /* zonder Drive-scripts verdergaan */ }
    }

    const user = [
      `BATCHMODUS. Schrijf nu direct ${count} complete organische short video scripts${klantnaam ? ` voor klant "${klantnaam}"` : ""}.`,
      "Stel GEEN vragen en wacht nergens op. Werk volledig volgens het Shortclips Scripthandboek en de meegeleverde klantcontext.",
      klantnaam
        ? "Gebruik alles wat je over deze klant weet uit de meegeleverde context en eerdere data. Een website heb je niet nodig."
        : "Er is geen vaste klant gekozen. Kies een logisch, concreet onderwerp per script dat past bij het handboek.",
      documents.length ? `Er zijn ${documents.length} eerdere script(s) als PDF meegestuurd uit Drive. Gebruik die als basis en stijlreferentie: neem tone of voice, opbouw en sterke concepten over, maar schrijf NIEUWE scripts — geen kopie.` : "",
      priorText ? `Eerdere scripts van deze klant (tekst — gebruik als basis en stijlreferentie, schrijf nieuwe scripts):\n${priorText}` : "",
      "Mis je een hard cijfer? Gebruik een realistische range en noem het een gemiddelde. Verzin nooit exacte cijfers, namen of modellen.",
      brief ? `Input van de gebruiker (onderwerpen, hooks of extra wensen — gebruik dit leidend):\n${brief}` : "",
      "",
      ...QUALITY_RULES,
      "",
      ...FORMAT_RULES,
      "",
      "Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder tekst eromheen:",
      `{"scripts":[{"onderwerp":"<korte videotitel zonder nummer>","regels":["<regel 1>","<regel 2>","..."]}]}`,
      "- onderwerp: alleen de titel van de video, zonder nummer ervoor.",
      "- regels: een array met het volledige script, één tekstregel per array-element. Zet NOOIT een regeleinde binnen een element — elke nieuwe regel is een nieuw element. Gebruik een leeg element (\"\") voor een witregel tussen de blokken.",
    ].filter(Boolean).join("\n");

    const res = await runPrompt({
      system: scriptGeneratorSystem(extra || undefined),
      user,
      documents: documents.length ? documents : undefined,
      maxTokens: Math.min(24000, count * 3000 + 3000),
    });

    if (!res.ok) {
      return { ok: false, message: res.reason === "no_provider" ? "De AI-schrijver staat uit." : "De schrijver gaf geen bruikbaar antwoord. Probeer het nog eens." };
    }

    const data = parseScriptsJson(res.text);
    if (!data) {
      console.error("[generateScripts] JSON parse mislukt. Ruwe tekst (eerste 1500):\n", res.text.slice(0, 1500));
      return { ok: false, message: "De schrijver gaf geen bruikbaar antwoord. Probeer het nog eens." };
    }

    const scripts: GeneratedScript[] = (data.scripts ?? [])
      .map((s) => {
        // Voorkeur: regels-array (voorkomt kapotte JSON door regeleindes). Val
        // terug op een los tekstveld als het model dat toch meestuurt.
        const tekst = Array.isArray(s?.regels)
          ? s.regels.map((r) => (typeof r === "string" ? r : "")).join("\n").trim()
          : typeof s?.tekst === "string"
            ? s.tekst.trim()
            : "";
        return {
          onderwerp: typeof s?.onderwerp === "string" ? s.onderwerp.trim() : "",
          tekst,
        };
      })
      .filter((s) => s.onderwerp || s.tekst)
      .slice(0, count);

    if (scripts.length === 0) return { ok: false, message: "De schrijver leverde geen scripts op. Probeer het nog eens." };

    return { ok: true, scripts, klantnaam };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

type ReviseResult =
  | { ok: true; script: GeneratedScript }
  | { ok: false; message: string };

/** Past één bestaand script aan volgens een instructie (bijv. ingesproken of getypt),
 *  met behoud van de vaste Shortclips-opmaak. */
export async function reviseScript(input: {
  onderwerp: string;
  tekst: string;
  instruction: string;
  clientId?: string;
  clientName?: string;
  /** true = volledig nieuw concept met andere invalshoek i.p.v. kleine aanpassingen. */
  newConcept?: boolean;
}): Promise<ReviseResult> {
  try {
    const viewer = await requirePermission("ai:read");
    if (!aiConfigured()) return { ok: false, message: "De AI-schrijver staat uit (ANTHROPIC_API_KEY ontbreekt)." };

    const instruction = (input.instruction ?? "").trim();
    if (!instruction) return { ok: false, message: "Geef aan wat er moet veranderen." };

    let extra = "";
    let klantnaam = (input.clientName ?? "").trim();
    if (input.clientId) {
      const ctx = await clientContext(viewer, input.clientId);
      if (ctx) { extra = ctx.extra; klantnaam = ctx.name; }
    }

    const user = [
      input.newConcept
        ? `Hieronder staat een bestaand organisch short video script${klantnaam ? ` voor klant "${klantnaam}"` : ""}. Bedenk een VOLLEDIG NIEUW concept met een andere invalshoek voor hetzelfde onderwerp/thema — geen kleine tekstaanpassing, maar een frisse aanpak. Controleer eerdere scripts om herhaling te voorkomen.`
        : `Hieronder staat een bestaand organisch short video script${klantnaam ? ` voor klant "${klantnaam}"` : ""}. Pas het aan volgens de instructie en lever het volledige, aangepaste script terug.`,
      "Behoud de vaste Shortclips-opmaak en de stijl uit het handboek.",
      "",
      `TITEL: ${input.onderwerp || "(geen)"}`,
      "HUIDIG SCRIPT:",
      input.tekst || "(leeg)",
      "",
      `INSTRUCTIE VAN DE GEBRUIKER:\n${instruction.slice(0, 2000)}`,
      "",
      ...(input.newConcept ? [] : REVISE_RULES),
      "",
      ...FORMAT_RULES,
      "",
      "Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder tekst eromheen:",
      `{"scripts":[{"onderwerp":"<titel zonder nummer>","regels":["<regel 1>","<regel 2>","..."]}]}`,
      "- regels: één tekstregel per array-element, nooit een regeleinde binnen een element; leeg element (\"\") = witregel.",
    ].join("\n");

    const res = await runPrompt({
      system: scriptGeneratorSystem(extra || undefined),
      user,
      maxTokens: 4000,
    });
    if (!res.ok) return { ok: false, message: "De schrijver gaf geen antwoord. Probeer het nog eens." };

    const data = parseScriptsJson(res.text);
    const s = data?.scripts?.[0];
    if (!s) {
      console.error("[reviseScript] JSON parse mislukt. Ruwe tekst (eerste 1000):\n", res.text.slice(0, 1000));
      return { ok: false, message: "De aanpassing kon niet worden gelezen. Probeer het nog eens." };
    }
    const tekst = Array.isArray(s.regels)
      ? s.regels.map((r) => (typeof r === "string" ? r : "")).join("\n").trim()
      : typeof s.tekst === "string" ? s.tekst.trim() : "";
    const onderwerp = typeof s.onderwerp === "string" ? s.onderwerp.trim() : input.onderwerp;
    if (!tekst) return { ok: false, message: "De aanpassing leverde geen tekst op. Probeer het nog eens." };

    return { ok: true, script: { onderwerp: onderwerp || input.onderwerp, tekst } };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

type TopicsResult =
  | { ok: true; topics: string[] }
  | { ok: false; message: string };

/** Laat de generator zelf sterke onderwerpen/hooks voorstellen op basis van wat werkt. */
export async function suggestTopics(input: { clientId?: string; clientName?: string; count?: number }): Promise<TopicsResult> {
  try {
    const viewer = await requirePermission("ai:read");
    if (!aiConfigured()) return { ok: false, message: "De AI-schrijver staat uit (ANTHROPIC_API_KEY ontbreekt)." };

    const count = Math.max(4, Math.min(12, Math.round(input.count || 8)));
    let extra = "";
    let klantnaam = (input.clientName ?? "").trim();
    if (input.clientId) {
      const ctx = await clientContext(viewer, input.clientId);
      if (ctx) { extra = ctx.extra; klantnaam = ctx.name; }
    }

    const user = [
      `Stel ${count} sterke, concrete onderwerpen voor organische short video's voor${klantnaam ? ` klant "${klantnaam}"` : " een klant"}.`,
      "Kies onderwerpen die aantoonbaar werken: baseer je op wat goed presteert bij deze klant, veelgestelde vragen, misverstanden en sterke invalshoeken uit het handboek. Geen advertentie-ideeën.",
      "Elk onderwerp is één korte, pakkende regel (een titel of hook), zonder nummer.",
      "",
      "Geef UITSLUITEND geldige JSON terug: {\"onderwerpen\":[\"...\",\"...\"]}",
    ].join("\n");

    const res = await runPrompt({ system: scriptGeneratorSystem(extra || undefined), user, maxTokens: 1500 });
    if (!res.ok) return { ok: false, message: "De schrijver gaf geen antwoord. Probeer het nog eens." };

    const cleaned = res.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    let topics: string[] = [];
    try {
      const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
      const obj = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned) as { onderwerpen?: unknown };
      if (Array.isArray(obj.onderwerpen)) topics = obj.onderwerpen.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim());
    } catch { /* val terug op niets */ }

    if (topics.length === 0) return { ok: false, message: "Geen onderwerpen gekregen. Probeer het nog eens." };
    return { ok: true, topics: topics.slice(0, count) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

export type QualityPoint = { dimensie: string; score: number; waarom: string };
export type QualityResult = {
  scoreTotaal: number | null;
  oordeel: string;
  punten: QualityPoint[];
  sterk: string[];
  verbeteren: string[];
  feitenControleren: string[];
  alternatieveHooks: string[];
  speaking: { seconds: number; words: number; wpm: number };
};
type QualityActionResult = { ok: true; data: QualityResult } | { ok: false; message: string };

const QUALITY_SYSTEM = `Je bent script-analist voor Shortclips, een bureau voor organische short video's (TikTok/Reels/Shorts). Beoordeel een script eerlijk en onderbouwd op de interne richtlijnen. Onderbouw elk punt met wat daadwerkelijk in het script staat. Scheid bewezen observatie van creatieve verwachting. Markeer onbevestigde feitelijke claims (prijzen, specificaties, percentages, vergelijkingen) als te controleren; verzin nooit cijfers. Geef uitsluitend geldige JSON terug.`;

/** Beoordeelt de kwaliteit van het HUIDIGE (evt. onopgeslagen) script op 10 punten. */
export async function checkScriptQuality(input: {
  onderwerp: string;
  tekst: string;
  clientId?: string;
  clientName?: string;
}): Promise<QualityActionResult> {
  try {
    const viewer = await requirePermission("ai:read");
    if (!aiConfigured()) return { ok: false, message: "De AI-schrijver staat uit (ANTHROPIC_API_KEY ontbreekt)." };
    if (!input.tekst?.trim()) return { ok: false, message: "Dit script is nog leeg." };

    const { hook, body, cta } = parseScriptBlocks(input.tekst);

    let extra = "";
    let klantnaam = (input.clientName ?? "").trim();
    let wpm = DEFAULT_WPM;
    if (input.clientId) {
      const ctx = await clientContext(viewer, input.clientId);
      if (ctx) { extra = ctx.extra; klantnaam = ctx.name; if (ctx.wpm) wpm = ctx.wpm; }
    }
    const speaking = estimateSpeakingTime({ hook, body, cta }, wpm);

    const dims = [
      "Hook en aandacht in de eerste seconden",
      "Originaliteit van het concept",
      "Toegevoegde waarde voor de kijker",
      "Geschiktheid voor de doelgroep",
      "Natuurlijk en compact taalgebruik",
      "Commerciële balans (focus op kijker, niet verkoperig)",
      "Visuele mogelijkheden en opnamehaalbaarheid",
      "Overeenkomsten met eerder gemaakte content (herhaling)",
      "Feitelijke juistheid",
      "Aansluiting bij de doelstelling van de video",
    ];

    const user = [
      `Beoordeel dit organische short video script${klantnaam ? ` voor klant "${klantnaam}"` : ""}.`,
      `Titel: ${input.onderwerp || "(geen)"}`,
      `Geschatte spreektijd: ~${speaking.seconds}s (${speaking.words} woorden @ ${wpm} wpm; richtlijn 30–33s en 80–95 woorden).`,
      "",
      "SCRIPT",
      `Hook: ${hook || "(leeg)"}`,
      `Middenstuk: ${body || "(leeg)"}`,
      `CTA: ${cta || "(leeg)"}`,
      "",
      extra ? `CONTEXT (klantstijl, feedback, wat werkt, eerdere onderwerpen)\n${extra}` : "",
      "",
      `Beoordeel op deze 10 punten en geef per punt een score 1–10 en een korte onderbouwing:\n- ${dims.join("\n- ")}`,
      "",
      "Houd elke onderbouwing kort (maximaal 15 woorden) en elke lijst beknopt (max 3 items). Geen regeleindes binnen een waarde.",
      "Geef UITSLUITEND geldige JSON terug in exact dit formaat:",
      `{"scoreTotaal": <1-10>, "oordeel": "<één zin eindoordeel>", "punten": [{"dimensie": "<naam>", "score": <1-10>, "waarom": "<korte onderbouwing>"}], "sterk": ["..."], "verbeteren": ["..."], "feitenControleren": ["..."], "alternatieveHooks": ["<3 sterkere hooks>"]}`,
    ].filter(Boolean).join("\n");

    const res = await runPrompt({ system: QUALITY_SYSTEM, user, maxTokens: 6000 });
    if (!res.ok) return { ok: false, message: "De analyse gaf geen antwoord. Probeer het nog eens." };

    const cleaned = res.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    let parsed: Partial<QualityResult> | null = null;
    try {
      const a = cleaned.indexOf("{"); const b = cleaned.lastIndexOf("}");
      parsed = JSON.parse(a >= 0 && b > a ? cleaned.slice(a, b + 1) : cleaned) as Partial<QualityResult>;
    } catch { parsed = null; }
    if (!parsed) {
      console.error("[checkScriptQuality] JSON parse mislukt:\n", res.text.slice(0, 1000));
      return { ok: false, message: "De analyse kon niet worden gelezen. Probeer het nog eens." };
    }

    const asStrArr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
    const data: QualityResult = {
      scoreTotaal: typeof parsed.scoreTotaal === "number" ? parsed.scoreTotaal : null,
      oordeel: typeof parsed.oordeel === "string" ? parsed.oordeel : "",
      punten: Array.isArray(parsed.punten) ? parsed.punten.filter((p): p is QualityPoint => !!p && typeof p.dimensie === "string" && typeof p.score === "number") : [],
      sterk: asStrArr(parsed.sterk),
      verbeteren: asStrArr(parsed.verbeteren),
      feitenControleren: asStrArr(parsed.feitenControleren),
      alternatieveHooks: asStrArr(parsed.alternatieveHooks),
      speaking: { seconds: speaking.seconds, words: speaking.words, wpm },
    };
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Splitst de gegenereerde scripttekst in de vaste blokken van de scriptbibliotheek. */
function parseScriptBlocks(tekst: string): { uitleg: string; hook: string; body: string; cta: string } {
  const lines = (tekst || "").replace(/\r/g, "").split("\n");
  const buckets: Record<string, string[]> = { uitleg: [], hook: [], body: [], cta: [] };
  let section: keyof typeof buckets | null = null;
  for (const raw of lines) {
    const t = raw.trim();
    const upper = t.toUpperCase();
    if (t && t.length <= 42 && /[A-Z]/.test(t) && t === upper) {
      if (upper.startsWith("SHORTCLIP UITLEG")) section = "uitleg";
      else if (upper.startsWith("HOOK")) section = "hook";
      else if (upper.startsWith("MIDDENSTUK")) section = "body";
      else if (upper.startsWith("CALL TO ACTION")) section = "cta";
      else if (upper.startsWith("SOCIAL MEDIA POLL")) section = "cta"; // poll bij de CTA houden
      // onbekende kop: huidige sectie aanhouden
      continue;
    }
    if (section) buckets[section].push(raw);
  }
  const join = (arr: string[]) => arr.join("\n").trim();
  return { uitleg: join(buckets.uitleg), hook: join(buckets.hook), body: join(buckets.body), cta: join(buckets.cta) };
}

type SaveResult =
  | { ok: true; count: number }
  | { ok: false; message: string };

/** Slaat de (bewerkte) scripts op in de bestaande scriptbibliotheek: een scripts-record
 *  plus een eerste versie per script, gekoppeld aan de klant. */
export async function saveScriptsToLibrary(input: {
  clientId: string;
  scripts: Array<{ onderwerp: string; tekst: string }>;
}): Promise<SaveResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const items = (input.scripts ?? []).filter((s) => (s?.onderwerp?.trim() || s?.tekst?.trim()));
    if (items.length === 0) return { ok: false, message: "Er zijn geen scripts om op te slaan." };

    const [c] = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)))
      .limit(1);
    if (!c) return { ok: false, message: "Kies eerst een vastgelegde klant om in op te slaan." };
    assertClientAccess(viewer, c.id);

    let count = 0;
    for (const it of items) {
      const title = (it.onderwerp || "Script").replace(/^\s*\d+\.\s*/, "").trim().slice(0, 240) || "Script";
      const { uitleg, hook, body, cta } = parseScriptBlocks(it.tekst);
      const [row] = await db.insert(scripts).values({
        clientId: c.id,
        title,
        status: "concept",
        format: "Organische short video",
        hook: hook || null,
        body: body || it.tekst.trim() || null,
        cta: cta || null,
        internalNotes: uitleg ? `Shortclip uitleg:\n${uitleg}` : null,
        creatorId: viewer.id,
        currentVersion: 1,
      }).returning({ id: scripts.id });
      if (!row) continue;
      await db.insert(scriptVersions).values({
        scriptId: row.id,
        versionNumber: 1,
        snapshot: { title, uitleg, hook, body, cta } as unknown as Record<string, unknown>,
        changeSummary: "Aangemaakt met de scriptgenerator",
        status: "concept",
        authorId: viewer.id,
      });
      await auditLog({ viewer, action: "script.create", entityType: "script", entityId: row.id, clientId: c.id });
      count++;
    }

    if (count === 0) return { ok: false, message: "Opslaan lukte niet. Probeer het nog eens." };
    revalidatePath("/scripts");
    return { ok: true, count };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
