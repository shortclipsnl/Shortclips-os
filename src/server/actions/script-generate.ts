"use server";

import { and, asc, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { clients, scripts, scriptVersions, productionDays, files, driveMappings } from "@/db/schema";
import { drive } from "@/server/integrations/drive";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { aiConfigured, runPrompt, runJsonPrompt } from "@/server/ai/client";
import { scriptGeneratorSystem } from "@/server/scripts/scripthandboek";
import { adScriptGeneratorSystem, adFormatRules, FUNNEL_GUIDE, FUNNEL_LABEL, type Funnel } from "@/server/scripts/advertentiehandboek";
import { getClientAiProfile, captionProfileToText, clientLearnedText, centralKnowledgeText, type CaptionProfile } from "@/server/ai/knowledge";
import { gatherFeedbackContext, estimateSpeakingTime, DEFAULT_WPM } from "@/server/script-control";
import { getClientWinningPatterns } from "@/server/scripts/winning-patterns";
import { getClientDriveScriptPdfs } from "@/server/scripts/drive-scripts";
import { getIntelligenceOverview } from "@/server/video-intelligence/intelligence";
import { learnedFeedbackText, saveScriptFeedback, listScriptFeedback, deleteScriptFeedback, type FeedbackScope, type LearnedRule } from "@/server/scripts/script-feedback";
import { getMetaRules, refreshMetaRules } from "@/server/scripts/meta-rules";

export type ContentType = "organisch" | "advertentie";
export type GeneratedScript = { onderwerp: string; tekst: string; contentType?: ContentType; funnel?: Funnel };
type Result =
  | { ok: true; scripts: GeneratedScript[]; klantnaam: string }
  | { ok: false; message: string };

const MAX_SCRIPTS = 8;
const MAX_PDFS = 6;

/** Vaste opmaak- en nadrukregels — gedeeld door genereren en aanpassen.
 *  withPoll bepaalt of de CTA wordt afgesloten met een social media poll. */
function formatRules(withPoll: boolean): string[] {
  return [
    "OPMAAK (strikt aanhouden):",
    `- Blokken in deze vaste volgorde, elk met een lege regel ervoor en erna: SHORTCLIP UITLEG, HOOK, MIDDENSTUK, CALL TO ACTION${withPoll ? ", SOCIAL MEDIA POLL KEUZES" : ""}.`,
    "- Elke KOP op een eigen regel, volledig in HOOFDLETTERS. Daarna één lege regel, dan de tekst, dan weer een lege regel.",
    "- SHORTCLIP UITLEG: precies drie volledige zinnen (wat de kijker ziet, de opbouw, waarom het concept werkt).",
    "- MIDDENSTUK: elke zin op een eigen regel MET een lege regel (witregel) tussen elke zin — elke zin wordt los opgenomen, dus ze mogen niet aan elkaar vastzitten.",
    withPoll
      ? "- SOCIAL MEDIA POLL KEUZES: precies twee korte, duidelijk verschillende keuzes (elk op een eigen regel)."
      : "- GEEN poll: sluit af met de CALL TO ACTION. Voeg GEEN kop SOCIAL MEDIA POLL KEUZES en geen pollkeuzes toe. De CTA is een duidelijke vraag of oproep passend bij het onderwerp.",
    "- Leg nadruk door af en toe een kernwoord in HOOFDLETTERS te zetten en door vraag- of uitroeptekens te gebruiken waar dat natuurlijk is (maximaal twee uitroeptekens per script).",
    "- Laat de VIDEOTITEL-kop weg; de titel staat al bovenaan de pagina.",
    "- Geen markdown, geen sterretjes, geen codeblokken.",
  ];
}

/** Kwaliteits- en datagedreven regels: schrijf wat aantoonbaar werkt, op Jarno-niveau. */
const QUALITY_RULES = [
  "KWALITEIT (het doel is scripts op het niveau van de beste scriptschrijver, zodat elk teamlid dit zelfstandig kan):",
  "- Schrijf niet zomaar iets: kies onderwerpen en invalshoeken die aantoonbaar werken. Spiegel de best presterende hooks en concepten van deze klant (uit de meegeleverde cijfers en eerdere scripts) — kopieer ze niet, maak ze beter.",
  "- Haal stijl, woordgebruik, scriptlengte en openingsstijl uit de eerdere scripts van deze klant.",
  "- Zorg dat elk script echt TikTok- en Reels-waardig is: sterke hook in 3 seconden, hoge retentie, concreet en bruikbaar.",
  "- Volg strikt de Shortclips scriptstijl uit het handboek. Twijfel je of een zin sterk genoeg is, herschrijf hem.",
  "- DATAGEDREVEN: gebruik de meegeleverde cijfers als startpunt — de best presterende hooks, onderwerpen en formats van deze klant (wat mensen aanhaken en vasthoudt). Bouw daarop voort in plaats van iets willekeurigs te verzinnen.",
  "- GEEN HERHAALDE FOUTEN: staan er in de klantcontext terugkerende correcties, aandachtspunten of eerdere feedback? Verwerk die vooraf en maak die fouten dus niet opnieuw.",
  "- KWALITEITSDREMPEL: beoordeel elk script vóór je het teruggeeft zelf streng op de 10 punten (hook, originaliteit, waarde, doelgroep, taalgebruik, commerciële balans, opnamehaalbaarheid, herhaling, feitelijke juistheid, aansluiting doel). Herschrijf net zolang tot het op elk belangrijk punt minimaal 8 van de 10 scoort. Lever UITSLUITEND scripts op van minimaal 8/10 — liever 9. Twijfel je, verbeter het dan verder voordat je het teruggeeft.",
];

/** Creativiteitsregels: unieke, verrassende concepten — wat het verschil maakt
 *  tussen gemiddelde en uitzonderlijke scripts. */
const CREATIVITY_RULES = [
  "CREATIVITEIT & ORIGINALITEIT (cruciaal — hier zit het verschil met gemiddelde scripts):",
  "- Durf verrassend en uniek te zijn: bedenk frisse, originele concepten en invalshoeken die je zelden voorbij ziet komen. Geen voor de hand liggende of clichématige video's.",
  "- Varieer sterk binnen de batch: elk script is een écht ander concept, format of invalshoek (denk aan: een mythe ontkrachten, een verrassende vergelijking, een mini-experiment, een insider-geheim, 'dit vertelt niemand je', een pattern interrupt, een onverwachte stelling). Nooit meerdere varianten van hetzelfde idee.",
  "- Open met een onverwachte, nieuwsgierig makende hook die direct een patroon doorbreekt; vermijd generieke of vlakke openingen.",
  "- Combineer die creativiteit met wat aantoonbaar werkt: geef de best presterende hooks en onderwerpen van deze klant een nieuwe, eigen draai in plaats van ze te herhalen.",
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

type ScriptsPayload = { scripts?: Array<{ onderwerp?: unknown; regels?: unknown; tekst?: unknown; funnel?: unknown }> };

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
async function clientContext(viewer: Awaited<ReturnType<typeof requirePermission>>, clientId: string, contentType: ContentType = "organisch"): Promise<{ name: string; slug: string; extra: string; wpm: number | null; location: string | null } | null> {
  const [c] = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!c) return null;
  assertClientAccess(viewer, c.id);
  const isAd = contentType === "advertentie";
  const todayStr = new Date().toISOString().slice(0, 10);
  const [profile, learned, feedback, patterns, central, intel, recent, learnedFb, nextShoot] = await Promise.all([
    getClientAiProfile(c.id),
    clientLearnedText(c.id),
    gatherFeedbackContext(c.id),
    getClientWinningPatterns(viewer, c.id).catch(() => null),
    centralKnowledgeText(["schrijfstijl", "branding", "kwaliteit"]).catch(() => ""),
    getIntelligenceOverview(viewer, c.slug).catch(() => null),
    // Eerdere scripts van hetzelfde contenttype (advertentie vs organisch),
    // zodat de twee werkwijzen niet door elkaar lopen.
    db.select({ title: scripts.title, format: scripts.format }).from(scripts)
      .where(and(eq(scripts.clientId, c.id), isNull(scripts.deletedAt)))
      .orderBy(desc(scripts.createdAt)).limit(40)
      .then((rows) => rows.filter((r) => (/advertentie/i.test(r.format ?? "") ? isAd : !isAd)).slice(0, 15))
      .catch(() => [] as Array<{ title: string; format: string | null }>),
    learnedFeedbackText(c.id, contentType).catch(() => ""),
    // Eerstvolgende geplande opname: de locatie waar deze scripts opgenomen
    // worden — zodat elk concept dáár uitvoerbaar is (uitvoerbaarheidscheck).
    db.select({ locationName: productionDays.locationName, locationAddress: productionDays.locationAddress, scheduledOn: productionDays.scheduledOn })
      .from(productionDays)
      .where(and(eq(productionDays.clientId, c.id), isNull(productionDays.deletedAt), ne(productionDays.status, "cancelled"), gte(productionDays.scheduledOn, todayStr)))
      .orderBy(asc(productionDays.scheduledOn)).limit(1)
      .then((rows) => rows[0] ?? null)
      .catch(() => null),
  ]);

  // Opnamelocatie als tekst (naam + adres), voor de context én de kwaliteitscheck.
  const location = nextShoot && (nextShoot.locationName || nextShoot.locationAddress)
    ? [nextShoot.locationName, nextShoot.locationAddress].filter(Boolean).join(" — ")
    : null;

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
    feedback.recenteScriptfeedback.length ? `Recente klantfeedback op eerdere SCRIPTS (uit de scriptcontrole in het portaal — verwerk dit en maak deze opmerkingen niet opnieuw):\n- ${feedback.recenteScriptfeedback.join("\n- ")}` : "",
    learned ? `Geleerde voorkeuren en correcties van deze klant:\n${learned}` : "",
    patterns && patterns.count > 0 ? `Best presterende hooks van deze klant (echte cijfers${isAd ? " — organisch bereik, GEEN bewijs dat een advertentie converteert; gebruik als inspiratie, niet als resultaat" : " — spiegelen, niet kopiëren"}):\n${patterns.top.map((p) => `- "${p.hook}" (${p.views} views)`).join("\n")}` : "",
    viLines,
    recent.length ? `Eerder geschreven ${isAd ? "advertentiescripts" : "onderwerpen"} voor deze klant (voorkom herhaling, tenzij je een sterk format bewust opnieuw gebruikt):\n- ${recent.map((r) => r.title).join("\n- ")}` : "",
    isAd ? "LET OP: dit zijn advertentiescripts. Schrijf vanuit het advertentiedoel en de funnelfase, niet vanuit organisch bereik. Gebruik alleen daadwerkelijk beschikbare commerciële gegevens; verzin geen cijfers, prijzen of claims." : "",
    location ? `Geplande opnamelocatie: ${location}. Zorg dat elk concept op DEZE locatie opneembaar is — vraag geen beelden, scènes of props die daar niet kunnen. Kan iets alleen elders, kies dan een ander concept of maak het haalbaar op locatie.` : "",
    learnedFb || "",
    central ? `Algemene Shortclips-richtlijnen:\n${central}` : "",
  ].filter(Boolean).join("\n\n");
  return { name: c.name, slug: c.slug, extra, wpm: intel?.speech?.avgWpm && intel.speech.avgWpm > 60 ? intel.speech.avgWpm : null, location };
}

/**
 * Schrijft in één keer `count` complete organische short video scripts, zonder
 * tussenvragen. De stijl + het handboek komen uit scriptGeneratorSystem; de
 * klantcontext (indien gekozen) wordt meegeladen. Het model werkt uit eerdere
 * data en het handboek — nooit een website nodig.
 */
/** Minimale kwaliteitslat; scripts eronder worden door de gate herschreven. */
const GATE = 8.0;

const GATE_SYSTEM = `Je bent een strenge, onafhankelijke scriptbeoordelaar bij Shortclips — NIET de schrijver. Je zorgt dat elke short-videoscript op het niveau van de allerbeste scriptschrijver is, zodat het zonder extra controle live kan.

Beoordeel elk meegeleverd script streng op vijf punten (elk 0-10): hook (pakt het de aandacht in de eerste 3 seconden?), retentie/opbouw (houdt het vast tot het eind?), originaliteit & creativiteit (uniek, verrassend concept — geen cliché), natuurlijke spreektaal (makkelijk te presenteren, geen AI-taal), en aansluiting op de klant en het doel.

Herschrijf ELK script dat op één van deze punten onder de ${GATE} van 10 zit, zó dat het ruim voldoet: behoud wat sterk is en verscherp de rest — maak vooral de hook en het concept opvallender, unieker en creatiever. Laat een script dat al uitstekend is ongewijzigd.

Harde regels:
- Behoud exact dezelfde opmaak en structuur (dezelfde koppen en blokken, dezelfde volgorde).
- Verzin NOOIT nieuwe cijfers, prijzen, claims of specificaties.
- Geef exact hetzelfde aantal scripts terug, in dezelfde volgorde.
- Antwoord met UITSLUITEND geldige JSON, zonder tekst eromheen en zonder markdown. Gebruik binnen tekstwaarden geen dubbele aanhalingstekens en geen letterlijke regeleinden:
{"scripts":[{"onderwerp":"<titel>","regels":["<regel 1>","<regel 2>","..."]}]}`;

/**
 * Automatische kwaliteitsgate: een onafhankelijke, strenge beoordelaar loopt de
 * net geschreven scripts na en herschrijft de scripts die onder de lat zitten
 * (sterkere hook, uniekere concepten, betere retentie) — zodat het team scripts
 * oplevert op het niveau dat anders de handmatige controle van de eigenaar vroeg.
 * Best-effort: lukt de gate niet, dan blijven de originele scripts staan.
 */
async function gateScripts(scripts: GeneratedScript[], context: string): Promise<GeneratedScript[]> {
  if (scripts.length === 0) return scripts;
  try {
    const payload = scripts.map((s, i) => ({ index: i, onderwerp: s.onderwerp, regels: s.tekst.split("\n") }));
    const res = await runJsonPrompt<ScriptsPayload>({
      system: context ? `${GATE_SYSTEM}\n\nKLANTCONTEXT (gebruik om de aansluiting te beoordelen en te verscherpen):\n${context}` : GATE_SYSTEM,
      user: `Beoordeel deze ${scripts.length} scripts streng en herschrijf wat onder de lat zit. Data (JSON):\n${JSON.stringify({ scripts: payload })}`,
      maxTokens: Math.min(24000, scripts.length * 3000 + 3000),
    });
    if (!res.ok || !Array.isArray(res.data?.scripts)) return scripts;
    return scripts.map((orig, i) => {
      const g = res.data.scripts?.[i];
      if (!g) return orig;
      const tekst = Array.isArray(g.regels)
        ? g.regels.map((r) => (typeof r === "string" ? r : "")).join("\n").trim()
        : typeof g.tekst === "string"
          ? g.tekst.trim()
          : "";
      if (!tekst) return orig;
      const onderwerp = typeof g.onderwerp === "string" && g.onderwerp.trim() ? g.onderwerp.trim() : orig.onderwerp;
      return { ...orig, onderwerp, tekst };
    });
  } catch {
    return scripts;
  }
}

export async function generateScripts(input: {
  clientId?: string;
  clientName?: string;
  count: number;
  brief?: string;
  /** Tekst uit handmatig toegevoegde eerdere scripts (in de browser uit PDF gehaald). */
  priorText?: string;
  /** Eerdere scripts automatisch uit de Drive-map van de klant halen. */
  useDriveScripts?: boolean;
  /** CTA met social media poll (true) of alleen een CTA zonder poll (false). Alleen organisch. */
  withPoll?: boolean;
  /** Organisch of advertentie — bepaalt het schrijfsysteem (standaard organisch). */
  contentType?: ContentType;
  /** Advertenties: de funnelfase per te schrijven script, in volgorde (bijv. ["TOF","TOF","MOF","MOF","BOF","BOF"]). */
  funnels?: Funnel[];
}): Promise<Result> {
  try {
    const viewer = await requirePermission("ai:read");
    if (!aiConfigured()) return { ok: false, message: "De AI-schrijver staat uit (ANTHROPIC_API_KEY ontbreekt)." };

    const contentType: ContentType = input.contentType === "advertentie" ? "advertentie" : "organisch";
    const isAd = contentType === "advertentie";

    // Advertenties: één script per opgegeven funnelfase. Organisch: gewoon aantal.
    const funnels: Funnel[] = isAd
      ? (input.funnels && input.funnels.length ? input.funnels : (["TOF", "TOF", "MOF", "MOF", "BOF", "BOF"] as Funnel[])).slice(0, MAX_SCRIPTS)
      : [];
    const count = isAd ? funnels.length : Math.max(1, Math.min(MAX_SCRIPTS, Math.round(input.count || 1)));

    let extra = "";
    let klantnaam = (input.clientName ?? "").trim();
    if (input.clientId) {
      const ctx = await clientContext(viewer, input.clientId, contentType);
      if (ctx) { extra = ctx.extra; klantnaam = ctx.name; }
    } else {
      // Zonder vaste klant: toch de centrale geleerde regels voor dit contenttype meenemen.
      const centralLearned = await learnedFeedbackText(null, contentType).catch(() => "");
      if (centralLearned) extra = centralLearned;
    }
    // Advertenties: de actueel opgehaalde Meta-regels meelezen, náást de vaste basisregels.
    if (isAd) {
      const meta = await getMetaRules().catch(() => null);
      if (meta?.body) extra = `${extra ? extra + "\n\n" : ""}ACTUELE META-ADVERTENTIEREGELS (leidend, náást de vaste regels — gecontroleerd ${new Date(meta.updatedAt).toLocaleDateString("nl-NL")}):\n${meta.body}`;
    }

    const brief = (input.brief ?? "").trim().slice(0, 4000);
    let priorText = (input.priorText ?? "").trim().slice(0, 24000);
    const withPoll = input.withPoll !== false; // standaard mét poll (alleen organisch)

    // Eerdere scripts uit Drive (server-side, dus geen upload-limiet): PDF's als
    // document, Word/.docx én Google Docs als tekst — zo leest de schrijver alle
    // bestaande scripts uit de "Short Video Scripts"-map, ongeacht het formaat.
    let documents: Array<{ base64: string; mediaType: "application/pdf" }> = [];
    if (input.useDriveScripts && input.clientId) {
      try {
        const drivePdfs = await getClientDriveScriptPdfs(input.clientId, MAX_PDFS);
        documents = drivePdfs.map((p) => ({ base64: p.base64, mediaType: "application/pdf" as const }));
      } catch { /* zonder Drive-PDF's verdergaan */ }
      try {
        const { getClientDriveScriptTexts } = await import("@/server/scripts/drive-scripts");
        const driveTexts = await getClientDriveScriptTexts(input.clientId, 4);
        if (driveTexts.length) {
          const block = driveTexts.map((d) => `--- ${d.name} (uit Drive) ---\n${d.text}`).join("\n\n");
          priorText = `${priorText ? priorText + "\n\n" : ""}${block}`.slice(0, 32000);
        }
      } catch { /* zonder Drive-teksten verdergaan */ }
    }

    // De funnelverdeling als compacte, genummerde opdrachtregel voor het model.
    const funnelOrder = funnels.map((f, i) => `  Script ${i + 1}: ${f} (${FUNNEL_LABEL[f]}, richtlijn ${FUNNEL_GUIDE[f].seconds} / ${FUNNEL_GUIDE[f].words}).`).join("\n");

    const user = isAd
      ? [
          `BATCHMODUS. Schrijf nu direct ${count} complete advertentie short video scripts voor Meta${klantnaam ? ` voor klant "${klantnaam}"` : ""}.`,
          "Stel GEEN vragen en wacht nergens op. Werk volledig volgens het Shortclips Advertentiehandboek en de meegeleverde klantcontext.",
          "Schrijf precies één script per onderstaande funnelfase, in deze volgorde:",
          funnelOrder,
          "Twee scripts in dezelfde funnelfase moeten een duidelijk andere invalshoek hebben — niet twee keer dezelfde boodschap.",
          klantnaam
            ? "Gebruik alles wat je over deze klant weet uit de meegeleverde context (producten, aanbiedingen, tone of voice, eerdere advertenties, feedback). Een website heb je niet nodig."
            : "Er is geen vaste klant gekozen. Kies een logisch, concreet product/dienst en campagnedoel per script.",
          documents.length ? `Er zijn ${documents.length} eerdere script(s) als PDF meegestuurd uit Drive. Gebruik die als stijlreferentie, maar schrijf NIEUWE advertentiescripts.` : "",
          priorText ? `Eerdere scripts van deze klant (tekst — stijlreferentie):\n${priorText}` : "",
          brief ? `Input van de gebruiker (campagnedoel, product, doelgroep, actie of thema — leidend):\n${brief}` : "Geen specifiek campagnedoel opgegeven: kies per script een logisch, concreet commercieel doel (aanvragen, leads, verkopen of afspraken) dat bij de klant past.",
          "Verzin NOOIT prijzen, garanties, resultaten of producteigenschappen. Ontbreekt een hard gegeven, laat de claim weg.",
          "Controleer elk script vóór je het teruggeeft op de Meta-regels en de kwaliteitscontrole uit het handboek. Lever alleen scripts op die op elk punt voldoen.",
          "",
          ...adFormatRules(),
          "",
          "Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder tekst eromheen:",
          `{"scripts":[{"onderwerp":"<korte videotitel zonder nummer>","funnel":"TOF|MOF|BOF","regels":["<regel 1>","<regel 2>","..."]}]}`,
          "- onderwerp: alleen de titel van de video, zonder nummer ervoor.",
          "- funnel: exact de funnelfase van dit script (TOF, MOF of BOF), in dezelfde volgorde als hierboven.",
          "- regels: het volledige script, één tekstregel per array-element (nooit een regeleinde binnen een element; leeg element (\"\") = witregel). Begin de drie hooks met \"A) \", \"B) \" en \"C) \".",
        ].filter(Boolean).join("\n")
      : [
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
          ...CREATIVITY_RULES,
          "",
          ...formatRules(withPoll),
          "",
          "Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder tekst eromheen:",
          `{"scripts":[{"onderwerp":"<korte videotitel zonder nummer>","regels":["<regel 1>","<regel 2>","..."]}]}`,
          "- onderwerp: alleen de titel van de video, zonder nummer ervoor.",
          "- regels: een array met het volledige script, één tekstregel per array-element. Zet NOOIT een regeleinde binnen een element — elke nieuwe regel is een nieuw element. Gebruik een leeg element (\"\") voor een witregel tussen de blokken.",
        ].filter(Boolean).join("\n");

    const res = await runPrompt({
      system: isAd ? adScriptGeneratorSystem(extra || undefined) : scriptGeneratorSystem(extra || undefined),
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

    const validFunnel = (v: unknown): Funnel | undefined => (v === "TOF" || v === "MOF" || v === "BOF" ? v : undefined);
    const scripts: GeneratedScript[] = (data.scripts ?? [])
      .map((s, i) => {
        // Voorkeur: regels-array (voorkomt kapotte JSON door regeleindes). Val
        // terug op een los tekstveld als het model dat toch meestuurt.
        const tekst = Array.isArray(s?.regels)
          ? s.regels.map((r) => (typeof r === "string" ? r : "")).join("\n").trim()
          : typeof s?.tekst === "string"
            ? s.tekst.trim()
            : "";
        const base: GeneratedScript = {
          onderwerp: typeof s?.onderwerp === "string" ? s.onderwerp.trim() : "",
          tekst,
        };
        if (isAd) {
          // Funnel uit het antwoord, anders de gevraagde funnel op deze positie.
          base.contentType = "advertentie";
          base.funnel = validFunnel(s?.funnel) ?? funnels[i] ?? "TOF";
        } else {
          base.contentType = "organisch";
        }
        return base;
      })
      .filter((s) => s.onderwerp || s.tekst)
      .slice(0, count);

    if (scripts.length === 0) return { ok: false, message: "De schrijver leverde geen scripts op. Probeer het nog eens." };

    // Automatische kwaliteitsgate: een onafhankelijke beoordelaar herschrijft
    // zwakke scripts, zodat de handmatige controle van de eigenaar niet meer nodig is.
    const gated = await gateScripts(scripts, extra).catch(() => scripts);

    return { ok: true, scripts: gated, klantnaam };
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
  /** Organisch of advertentie — bepaalt het schrijfsysteem en de opmaakregels. */
  contentType?: ContentType;
  /** Advertenties: de funnelfase van dit script (behouden bij aanpassen). */
  funnel?: Funnel;
  /** Organisch: forceer CTA mét (true) of zonder (false) poll. Niet gezet = uit de huidige tekst afleiden. */
  withPoll?: boolean;
}): Promise<ReviseResult> {
  try {
    const viewer = await requirePermission("ai:read");
    if (!aiConfigured()) return { ok: false, message: "De AI-schrijver staat uit (ANTHROPIC_API_KEY ontbreekt)." };

    const instruction = (input.instruction ?? "").trim();
    if (!instruction) return { ok: false, message: "Geef aan wat er moet veranderen." };

    const contentType: ContentType = input.contentType === "advertentie" ? "advertentie" : "organisch";
    const isAd = contentType === "advertentie";
    const funnel = input.funnel ?? "TOF";

    let extra = "";
    let klantnaam = (input.clientName ?? "").trim();
    if (input.clientId) {
      const ctx = await clientContext(viewer, input.clientId, contentType);
      if (ctx) { extra = ctx.extra; klantnaam = ctx.name; }
    }

    const user = isAd
      ? [
          input.newConcept
            ? `Hieronder staat een bestaand advertentie short video script (funnelfase ${funnel})${klantnaam ? ` voor klant "${klantnaam}"` : ""}. Bedenk een VOLLEDIG NIEUW advertentieconcept met een andere invalshoek voor dezelfde funnelfase — geen kleine aanpassing, maar een frisse aanpak.`
            : `Hieronder staat een bestaand advertentie short video script (funnelfase ${funnel})${klantnaam ? ` voor klant "${klantnaam}"` : ""}. Pas het aan volgens de instructie en lever het volledige, aangepaste script terug.`,
          `Behoud de funnelfase ${funnel} (${FUNNEL_LABEL[funnel]}) en de vaste advertentiestructuur: SHORTCLIP UITLEG, HOOKS (precies drie, A/B/C), PROBLEEM, OPLOSSING / USP, CALL TO ACTION.`,
          "Verander alleen wat gevraagd wordt; laat de rest staan. Verzin geen prijzen, claims of resultaten. Houd je aan de Meta-regels en gesproken zinnen van max 14 woorden.",
          "",
          `TITEL: ${input.onderwerp || "(geen)"}`,
          "HUIDIG SCRIPT:",
          input.tekst || "(leeg)",
          "",
          `INSTRUCTIE VAN DE GEBRUIKER:\n${instruction.slice(0, 2000)}`,
          "",
          ...adFormatRules(),
          "",
          "Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder tekst eromheen:",
          `{"scripts":[{"onderwerp":"<titel zonder nummer>","funnel":"${funnel}","regels":["<regel 1>","<regel 2>","..."]}]}`,
          "- regels: één tekstregel per array-element, nooit een regeleinde binnen een element; leeg element (\"\") = witregel; hooks beginnen met \"A) \", \"B) \", \"C) \".",
        ].join("\n")
      : [
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
          ...formatRules(typeof input.withPoll === "boolean" ? input.withPoll : /SOCIAL\s*MEDIA\s*POLL/i.test(input.tekst)),
          "",
          "Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder tekst eromheen:",
          `{"scripts":[{"onderwerp":"<titel zonder nummer>","regels":["<regel 1>","<regel 2>","..."]}]}`,
          "- regels: één tekstregel per array-element, nooit een regeleinde binnen een element; leeg element (\"\") = witregel.",
        ].join("\n");

    const res = await runPrompt({
      system: isAd ? adScriptGeneratorSystem(extra || undefined) : scriptGeneratorSystem(extra || undefined),
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

    const out: GeneratedScript = { onderwerp: onderwerp || input.onderwerp, tekst };
    if (isAd) { out.contentType = "advertentie"; out.funnel = funnel; } else { out.contentType = "organisch"; }
    return { ok: true, script: out };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

type TopicsResult =
  | { ok: true; topics: string[]; basis: string }
  | { ok: false; message: string };

/**
 * Laat de generator zelf sterke onderwerpen voorstellen — ná echt onderzoek: hij
 * analyseert eerst de bestaande scripts, de best presterende hooks en de Video
 * Intelligence-patronen van deze klant (meegeleverd in de context) en kiest dán
 * onderwerpen in bewezen richtingen én op gaten die nog niet behandeld zijn.
 * `avoid` = eerder voorgestelde/gebruikte onderwerpen; die worden vermeden en
 * samen met een variatiesignaal zorgt dat herhaald klikken nieuwe ideeën geeft.
 * `basis` legt kort uit waarop de keuze is gebaseerd.
 */
export async function suggestTopics(input: { clientId?: string; clientName?: string; count?: number; avoid?: string[] }): Promise<TopicsResult> {
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

    const avoid = (input.avoid ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 40);
    // Variatiesignaal: een willekeurige hoek + nonce, zodat twee keer klikken niet
    // exact dezelfde lijst oplevert (het model krijgt anders identieke input).
    const angles = ["een verrassende insteek", "een misverstand ontkrachten", "een how-to", "achter de schermen", "een veelgestelde vraag", "een vergelijking", "een mythe vs. feit", "een concreet resultaat/voorbeeld", "een seizoens- of actualiteitshaak", "een tip die bijna niemand toepast"];
    const pick = angles.sort(() => Math.random() - 0.5).slice(0, 4);
    const nonce = Math.random().toString(36).slice(2, 8);

    const user = [
      `Stel ${count} sterke, concrete onderwerpen voor organische short video's voor${klantnaam ? ` klant "${klantnaam}"` : " een klant"}.`,
      "WERKWIJZE (belangrijk): onderzoek EERST en kies DAARNA. Analyseer de eerder geschreven scripts, de best presterende hooks (echte cijfers) en de Video Intelligence-patronen van deze klant uit de meegeleverde context: in welke richtingen maken we content, wat werkt, en welke invalshoeken zijn nog NIET gebruikt. Kies onderwerpen die (a) aansluiten op wat aantoonbaar werkt én (b) nieuwe, nog niet behandelde gaten vullen. Geen advertentie-ideeën.",
      avoid.length ? `Vermijd deze onderwerpen (al eerder voorgesteld of gebruikt) — kom met wezenlijk ANDERE ideeën, niet een herformulering:\n- ${avoid.join("\n- ")}` : "",
      `Breng variatie aan; leun deze keer onder meer op: ${pick.join(", ")}. (variatiecode ${nonce} — negeer deze code inhoudelijk, hij dient alleen om niet in herhaling te vallen.)`,
      "Elk onderwerp is één korte, pakkende regel (een titel of hook), zonder nummer.",
      "",
      "Geef UITSLUITEND geldige JSON terug in exact dit formaat:",
      "{\"basis\":\"<1-2 zinnen: waarop je deze keuze baseerde — wat je in de eerdere scripts/cijfers/patronen zag>\",\"onderwerpen\":[\"...\",\"...\"]}",
    ].filter(Boolean).join("\n");

    const res = await runPrompt({ system: scriptGeneratorSystem(extra || undefined), user, maxTokens: 1800 });
    if (!res.ok) return { ok: false, message: "De schrijver gaf geen antwoord. Probeer het nog eens." };

    const cleaned = res.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    let topics: string[] = [];
    let basis = "";
    try {
      const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
      const obj = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned) as { onderwerpen?: unknown; basis?: unknown };
      if (Array.isArray(obj.onderwerpen)) topics = obj.onderwerpen.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim());
      if (typeof obj.basis === "string") basis = obj.basis.trim();
    } catch { /* val terug op niets */ }

    // Harde ontdubbeling t.o.v. wat al voorgesteld/gebruikt is.
    const seen = new Set(avoid.map((t) => t.toLowerCase()));
    topics = topics.filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });

    if (topics.length === 0) return { ok: false, message: "Geen nieuwe onderwerpen gekregen. Probeer het nog eens." };
    return { ok: true, topics: topics.slice(0, count), basis };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Actuele klantenlijst voor de scriptgenerator — voor live verversen in de UI. */
export async function listScriptClientsAction(): Promise<Array<{ id: string; name: string; active: boolean; logoUrl: string | null; color: string | null }>> {
  const viewer = await requirePermission("ai:read");
  const { listClientsForScripts } = await import("@/server/ai/knowledge");
  return listClientsForScripts(viewer);
}

/** Aantal script-PDF's in de Drive-map van een klant — voor de live melding. */
export async function getClientDriveScriptInfoAction(clientId: string): Promise<{ count: number }> {
  const viewer = await requirePermission("ai:read");
  const [c] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), isNull(clients.deletedAt))).limit(1);
  if (!c) return { count: 0 };
  assertClientAccess(viewer, c.id);
  if (!drive.isConfigured) return { count: 0 };
  const { getClientDriveScriptInfo } = await import("@/server/scripts/drive-scripts");
  return getClientDriveScriptInfo(c.id).catch(() => ({ count: 0 }));
}

type NeedsResult = { ok: true; benodigdheden: string[] } | { ok: false; message: string };

/**
 * Laat de AI de benodigdheden voor het opnemen van deze short bepalen op basis
 * van het script: locatie, props/materialen, beeld (b-roll), schermteksten en
 * eventuele voorbereiding. Concreet en haalbaar — geen verzonnen producten.
 */
export async function generateScriptNeeds(input: {
  onderwerp: string;
  tekst: string;
  clientId?: string;
  clientName?: string;
  contentType?: ContentType;
}): Promise<NeedsResult> {
  try {
    const viewer = await requirePermission("ai:read");
    if (!aiConfigured()) return { ok: false, message: "De AI staat uit (ANTHROPIC_API_KEY ontbreekt)." };
    if (!input.tekst?.trim()) return { ok: false, message: "Dit script is nog leeg." };

    let klantnaam = (input.clientName ?? "").trim();
    let extra = "";
    if (input.clientId) {
      const ctx = await clientContext(viewer, input.clientId, input.contentType === "advertentie" ? "advertentie" : "organisch");
      if (ctx) { extra = ctx.extra; klantnaam = ctx.name; }
    }

    const user = [
      `Bepaal de BENODIGDHEDEN om deze short video op te nemen${klantnaam ? ` voor klant "${klantnaam}"` : ""}.`,
      "Lees het script en geef een praktische, concrete checklist voor op de opnamedag: locatie(s), personen/rollen voor de camera, props en materialen, beeld/b-roll dat gefilmd moet worden, schermteksten/overlays en eventuele voorbereiding vooraf.",
      "Baseer je uitsluitend op wat in het script staat. Verzin geen producten, cijfers of locaties die er niet zijn; is iets onduidelijk, benoem het als '(afstemmen)'.",
      "Houd elk item kort (één regel), concreet en afvinkbaar. Maximaal 10 items.",
      "",
      `TITEL: ${input.onderwerp || "(geen)"}`,
      "SCRIPT:",
      input.tekst.slice(0, 6000),
      extra ? `\nCONTEXT (klant):\n${extra.slice(0, 3000)}` : "",
      "",
      "Geef UITSLUITEND geldige JSON terug: {\"benodigdheden\":[\"...\",\"...\"]}",
    ].filter(Boolean).join("\n");

    const res = await runPrompt({ system: scriptGeneratorSystem(extra || undefined), user, maxTokens: 1200 });
    if (!res.ok) return { ok: false, message: "Geen antwoord gekregen. Probeer het nog eens." };

    const cleaned = res.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    let benodigdheden: string[] = [];
    try {
      const a = cleaned.indexOf("{"); const b = cleaned.lastIndexOf("}");
      const obj = JSON.parse(a >= 0 && b > a ? cleaned.slice(a, b + 1) : cleaned) as { benodigdheden?: unknown };
      if (Array.isArray(obj.benodigdheden)) benodigdheden = obj.benodigdheden.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim());
    } catch { /* niets */ }

    if (benodigdheden.length === 0) return { ok: false, message: "Geen benodigdheden gekregen. Probeer het nog eens." };
    return { ok: true, benodigdheden: benodigdheden.slice(0, 10) };
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

const AD_QUALITY_SYSTEM = `Je bent advertentie-script-analist voor Shortclips. Je beoordeelt direct response short video scripts voor Meta (Facebook/Instagram) op de interne advertentierichtlijnen en de Meta-advertentieregels. Onderbouw elk punt met wat daadwerkelijk in het script staat. Markeer onbevestigde claims (prijzen, garanties, resultaten, specificaties) als te controleren en wijs op mogelijke Meta-overtredingen (ongefundeerde garanties, misleidende resultaten, verzonnen schaarste, gevoelige persoonlijke aannames). Verzin nooit cijfers. Geef uitsluitend geldige JSON terug.`;

/** Beoordeelt de kwaliteit van het HUIDIGE (evt. onopgeslagen) script op 10 punten. */
export async function checkScriptQuality(input: {
  onderwerp: string;
  tekst: string;
  clientId?: string;
  clientName?: string;
  contentType?: ContentType;
  funnel?: Funnel;
}): Promise<QualityActionResult> {
  try {
    const viewer = await requirePermission("ai:read");
    if (!aiConfigured()) return { ok: false, message: "De AI-schrijver staat uit (ANTHROPIC_API_KEY ontbreekt)." };
    if (!input.tekst?.trim()) return { ok: false, message: "Dit script is nog leeg." };

    const contentType: ContentType = input.contentType === "advertentie" ? "advertentie" : "organisch";
    const isAd = contentType === "advertentie";
    const funnel = input.funnel ?? "TOF";

    const { hook, body, cta } = parseScriptBlocks(input.tekst);

    let extra = "";
    let klantnaam = (input.clientName ?? "").trim();
    let wpm = DEFAULT_WPM;
    let location: string | null = null;
    if (input.clientId) {
      const ctx = await clientContext(viewer, input.clientId, contentType);
      if (ctx) { extra = ctx.extra; klantnaam = ctx.name; if (ctx.wpm) wpm = ctx.wpm; location = ctx.location; }
    }
    const speaking = estimateSpeakingTime({ hook, body, cta }, wpm);

    const dims = isAd
      ? [
          "Juiste funnelfase (TOF/MOF/BOF) en opbouw",
          "Precies drie sterke, onderling verschillende hooks",
          "Hooks sluiten alle drie aan op hetzelfde middenstuk",
          "Concrete, controleerbare commerciële boodschap",
          "Minimaal één controleerbaar voordeel genoemd",
          "Bezwaren behandeld waar relevant",
          "Call to action past bij de funnelfase en het doel",
          "Productinformatie en claims kloppen (geen verzonnen cijfers)",
          "Voldoet aan de Meta-advertentieregels",
          "Gesproken zinnen max 14 woorden en natuurlijke overgangen",
        ]
      : [
          "Hook en aandacht in de eerste seconden",
          "Originaliteit van het concept (geen herhaling van eerdere content)",
          "Toegevoegde waarde voor de kijker",
          "Viral potentie en deelbaarheid",
          "Tone of voice en stijl komen overeen met eerdere scripts van deze klant",
          "Geschiktheid voor de doelgroep",
          "Natuurlijk en compact taalgebruik",
          "Commerciële balans (focus op kijker, niet verkoperig)",
          location ? `Opnamehaalbaarheid op de geplande locatie (${location})` : "Visuele mogelijkheden en opnamehaalbaarheid",
          "Feitelijke juistheid",
          "Aansluiting bij de doelstelling van de video",
        ];

    const adGuide = FUNNEL_GUIDE[funnel];
    const user = isAd
      ? [
          `Beoordeel dit advertentie short video script (funnelfase ${funnel} — ${FUNNEL_LABEL[funnel]})${klantnaam ? ` voor klant "${klantnaam}"` : ""}.`,
          `Titel: ${input.onderwerp || "(geen)"}`,
          `Geschatte spreektijd: ~${speaking.seconds}s (${speaking.words} woorden @ ${wpm} wpm; richtlijn ${adGuide.seconds} / ${adGuide.words}).`,
          "",
          "SCRIPT",
          `Hooks: ${hook || "(leeg)"}`,
          `Probleem + oplossing: ${body || "(leeg)"}`,
          `CTA: ${cta || "(leeg)"}`,
          "",
          extra ? `CONTEXT (klantstijl, aanbiedingen, eerdere advertenties, feedback)\n${extra}` : "",
          "",
          `Beoordeel op deze 10 punten en geef per punt een score 1–10 en een korte onderbouwing:\n- ${dims.join("\n- ")}`,
          "",
          "Zet mogelijke Meta-overtredingen en te controleren claims in 'feitenControleren'. Zet in 'alternatieveHooks' drie sterkere advertentiehooks (max 15 woorden elk, verschillende invalshoeken).",
          "Houd elke onderbouwing kort (maximaal 15 woorden) en elke lijst beknopt (max 3 items). Geen regeleindes binnen een waarde.",
          "Geef UITSLUITEND geldige JSON terug in exact dit formaat:",
          `{"scoreTotaal": <1-10>, "oordeel": "<één zin eindoordeel>", "punten": [{"dimensie": "<naam>", "score": <1-10>, "waarom": "<korte onderbouwing>"}], "sterk": ["..."], "verbeteren": ["..."], "feitenControleren": ["..."], "alternatieveHooks": ["<3 sterkere hooks>"]}`,
        ].filter(Boolean).join("\n")
      : [
          `Beoordeel dit organische short video script${klantnaam ? ` voor klant "${klantnaam}"` : ""}.`,
          `Titel: ${input.onderwerp || "(geen)"}`,
          `Geschatte spreektijd: ~${speaking.seconds}s (${speaking.words} woorden @ ${wpm} wpm; richtlijn 30–33s en 80–95 woorden).`,
          "",
          "SCRIPT",
          `Hook: ${hook || "(leeg)"}`,
          `Middenstuk: ${body || "(leeg)"}`,
          `CTA: ${cta || "(leeg)"}`,
          "",
          location ? `Geplande opnamelocatie: ${location}. Beoordeel of dit concept dáár daadwerkelijk opgenomen kan worden.` : "",
          extra ? `CONTEXT (klantstijl, feedback, wat werkt, eerdere onderwerpen)\n${extra}` : "",
          "",
          `Beoordeel op deze punten en geef per punt een score 1–10 en een korte onderbouwing:\n- ${dims.join("\n- ")}`,
          "",
          "Houd elke onderbouwing kort (maximaal 15 woorden) en elke lijst beknopt (max 3 items). Geen regeleindes binnen een waarde.",
          "Geef UITSLUITEND geldige JSON terug in exact dit formaat:",
          `{"scoreTotaal": <1-10>, "oordeel": "<één zin eindoordeel>", "punten": [{"dimensie": "<naam>", "score": <1-10>, "waarom": "<korte onderbouwing>"}], "sterk": ["..."], "verbeteren": ["..."], "feitenControleren": ["..."], "alternatieveHooks": ["<3 sterkere hooks>"]}`,
        ].filter(Boolean).join("\n");

    const res = await runPrompt({ system: isAd ? AD_QUALITY_SYSTEM : QUALITY_SYSTEM, user, maxTokens: 6000 });
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
      else if (upper.startsWith("HOOK")) section = "hook"; // HOOK én HOOKS (advertentie: 3 hooks)
      else if (upper.startsWith("MIDDENSTUK")) section = "body";
      else if (upper.startsWith("PROBLEEM")) section = "body"; // advertentie
      else if (upper.startsWith("OPLOSSING") || upper.startsWith("USP")) section = "body"; // advertentie
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

/** Laadt een sjabloonpagina voor de PDF, serverkant: eerst van schijf, anders via de eigen URL. */
async function loadTemplateImage(n: number): Promise<Uint8Array> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    return new Uint8Array(await fs.readFile(path.join(process.cwd(), "public", "script-template", `slide${n}.png`)));
  } catch { /* val terug op fetch */ }
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (process.env.APP_URL || "http://localhost:3000");
  const res = await fetch(`${base}/script-template/slide${n}.png`);
  if (!res.ok) throw new Error(`Sjabloonpagina ${n} kon niet worden geladen (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

type DriveSaveResult =
  | { ok: true; fileName: string; folderName: string; link: string }
  | { ok: false; message: string };

/** Slaat de scripts op als PDF in de "Scripts"-map van de klant in Google Drive. */
export async function saveScriptToDrive(input: {
  clientId: string;
  klantnaam: string;
  opnamedag: string;
  scripts: Array<{ onderwerp: string; tekst: string }>;
}): Promise<DriveSaveResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    if (!drive.isConfigured) return { ok: false, message: "De Google Drive-koppeling staat niet aan." };

    const items = (input.scripts ?? []).filter((s) => (s?.onderwerp?.trim() || s?.tekst?.trim()));
    if (items.length === 0) return { ok: false, message: "Er zijn geen scripts om op te slaan." };

    const [c] = await db.select({ id: clients.id, name: clients.name }).from(clients)
      .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt))).limit(1);
    if (!c) return { ok: false, message: "Kies eerst een vastgelegde klant." };
    assertClientAccess(viewer, c.id);

    // De juiste map bepalen: de al gesynchroniseerde "Scripts"-map van de klant.
    let folderId: string | null = null;
    const [sf] = await db.select({ externalId: files.externalId }).from(files)
      .where(and(eq(files.clientId, c.id), eq(files.isFolder, true), isNull(files.deletedAt), sql`lower(${files.name}) = 'scripts'`))
      .limit(1);
    if (sf?.externalId) {
      folderId = sf.externalId;
    } else {
      // Fallback: de gekoppelde klant-rootmap, en daarin (vind-of-maak) een "Scripts"-submap.
      const [dm] = await db.select({ folderId: driveMappings.folderId }).from(driveMappings)
        .where(and(eq(driveMappings.entityType, "client"), eq(driveMappings.entityId, c.id))).limit(1);
      if (!dm?.folderId) return { ok: false, message: "Deze klant heeft nog geen gekoppelde Google Drive-map. Koppel die eerst of synchroniseer de Drive." };
      folderId = await drive.ensureFolderUnder("Scripts", dm.folderId);
    }

    // PDF serverkant bouwen (exact dezelfde opmaak als de download).
    const { buildScriptPdfBytes } = await import("@/lib/script-pdf");
    const bytes = await buildScriptPdfBytes(
      { klantnaam: input.klantnaam || c.name, opnamedag: input.opnamedag || "", scripts: items.map((s) => ({ onderwerp: s.onderwerp, tekst: s.tekst })) },
      loadTemplateImage,
    );

    const safe = (input.klantnaam || c.name).replace(/[^\p{L}\p{N} _-]/gu, "").trim() || c.name;
    const fileName = `Scripts - ${safe}${input.opnamedag ? ` - ${input.opnamedag}` : ""}.pdf`;
    const { id } = await drive.uploadBytes(fileName, "application/pdf", bytes, folderId);

    await auditLog({ viewer, action: "script.save_to_drive", entityType: "client", entityId: c.id, clientId: c.id, changes: { fileName } });
    return { ok: true, fileName, folderName: "Scripts", link: `https://drive.google.com/file/d/${id}/view` };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    const msg = (e as { userMessage?: string })?.userMessage ?? (e as Error)?.message ?? "onbekende fout";
    return { ok: false, message: `Opslaan in Drive mislukt: ${msg}` };
  }
}

/* ---------------- Lerende feedback (advertentie vs organisch) ---------------- */

export type { FeedbackScope, LearnedRule } from "@/server/scripts/script-feedback";

/** Onthoud een correctie als regel (met gekozen reikwijdte); eenmalig = niets opslaan. */
export async function rememberScriptFeedback(input: {
  clientId?: string;
  contentType?: ContentType;
  scope: FeedbackScope;
  instruction: string;
}): Promise<{ ok: true; saved: boolean } | { ok: false; message: string }> {
  try {
    const viewer = await requirePermission("scripts:write");
    const contentType: ContentType = input.contentType === "advertentie" ? "advertentie" : "organisch";
    if (input.clientId) assertClientAccess(viewer, input.clientId);
    const res = await saveScriptFeedback({ clientId: input.clientId ?? null, contentType, scope: input.scope, instruction: input.instruction, viewerId: viewer.id });
    return res;
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Geleerde regels voor dit contenttype (centraal + klantspecifiek). */
export async function getLearnedRules(input: { clientId?: string; contentType?: ContentType }): Promise<LearnedRule[]> {
  await requirePermission("ai:read");
  const contentType: ContentType = input.contentType === "advertentie" ? "advertentie" : "organisch";
  return listScriptFeedback(input.clientId ?? null, contentType);
}

export async function removeLearnedRule(id: string, scope: "klant" | "centraal"): Promise<{ ok: true }> {
  await requirePermission("scripts:write");
  await deleteScriptFeedback(id, scope);
  return { ok: true };
}

/* ---------------- Live Meta-advertentieregels ---------------- */

/** Haalt de actuele Meta-advertentieregels op (web) en cachet ze centraal. */
export async function refreshMetaRulesAction(): Promise<{ ok: true; updatedAt: string } | { ok: false; message: string }> {
  try {
    await requirePermission("scripts:write");
    if (!aiConfigured()) return { ok: false, message: "De AI staat uit (ANTHROPIC_API_KEY ontbreekt)." };
    const res = await refreshMetaRules();
    return res.ok ? { ok: true, updatedAt: res.updatedAt.toISOString() } : res;
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Status van de gecachete Meta-regels (voor de UI). */
export async function getMetaRulesInfo(): Promise<{ updatedAt: string | null }> {
  await requirePermission("ai:read");
  const meta = await getMetaRules().catch(() => null);
  return { updatedAt: meta ? meta.updatedAt.toISOString() : null };
}

/** Aankomende opnamedagen van een klant, om scripts direct aan te koppelen. */
export async function listShootDaysForClient(clientId: string): Promise<Array<{ id: string; scheduledOn: string; title: string }>> {
  const viewer = await requirePermission("ai:read");
  const [c] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), isNull(clients.deletedAt))).limit(1);
  if (!c) return [];
  assertClientAccess(viewer, c.id);
  const todayStr = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({ id: productionDays.id, scheduledOn: productionDays.scheduledOn, title: productionDays.title })
    .from(productionDays)
    .where(and(
      eq(productionDays.clientId, c.id),
      isNull(productionDays.deletedAt),
      ne(productionDays.status, "cancelled"),
      gte(productionDays.scheduledOn, todayStr),
    ))
    .orderBy(asc(productionDays.scheduledOn))
    .limit(30);
  return rows.map((r) => ({ id: r.id, scheduledOn: String(r.scheduledOn), title: r.title }));
}

type SaveResult =
  | { ok: true; count: number; saved: Array<{ index: number; scriptId: string }>; blocked: Array<{ index: number; title: string }> }
  | { ok: false; message: string };

/**
 * Slaat de (bewerkte) scripts op in de bestaande scriptbibliotheek, idempotent:
 *  - zonder `scriptId` → nieuw script (status concept, versie 1);
 *  - mét `scriptId` → het bestaande script bijwerken (nieuwe versie, geen
 *    duplicaat). Een al GOEDGEKEURD script wordt niet overschreven tenzij
 *    `force` meegegeven is; het komt dan terug in `blocked` met een waarschuwing.
 * Optioneel koppelt het de scripts aan een opnamedag (productionDayId), zodat ze
 * op de scriptingpagina bij die opname verschijnen.
 */
export async function saveScriptsToLibrary(input: {
  clientId: string;
  scripts: Array<{ onderwerp: string; tekst: string; contentType?: ContentType; funnel?: Funnel; scriptId?: string }>;
  /** Optioneel: koppel aan een opnamedag uit de opnameplanning. */
  productionDayId?: string;
  /** Overschrijf ook goedgekeurde scripts (na bevestiging door de gebruiker). */
  force?: boolean;
}): Promise<SaveResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const items = (input.scripts ?? []).map((s, index) => ({ s, index })).filter(({ s }) => (s?.onderwerp?.trim() || s?.tekst?.trim()));
    if (items.length === 0) return { ok: false, message: "Er zijn geen scripts om op te slaan." };

    const [c] = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)))
      .limit(1);
    if (!c) return { ok: false, message: "Kies eerst een vastgelegde klant om in op te slaan." };
    assertClientAccess(viewer, c.id);

    // Valideer de opnamedag: moet van deze klant zijn.
    let productionDayId: string | null = null;
    if (input.productionDayId) {
      const [pd] = await db.select({ id: productionDays.id }).from(productionDays)
        .where(and(eq(productionDays.id, input.productionDayId), eq(productionDays.clientId, c.id), isNull(productionDays.deletedAt)))
        .limit(1);
      if (pd) productionDayId = pd.id;
    }

    const saved: Array<{ index: number; scriptId: string }> = [];
    const blocked: Array<{ index: number; title: string }> = [];

    for (const { s: it, index } of items) {
      const title = (it.onderwerp || "Script").replace(/^\s*\d+\.\s*/, "").trim().slice(0, 240) || "Script";
      const { uitleg, hook, body, cta } = parseScriptBlocks(it.tekst);
      // Contenttype serverzijdig vastleggen in het format-veld, zodat het bij
      // heropenen herkenbaar blijft: "Advertentie TOF/MOF/BOF" of "Organische short video".
      const format = it.contentType === "advertentie"
        ? `Advertentie ${it.funnel ?? "TOF"}`
        : "Organische short video";
      const bodyVal = body || it.tekst.trim() || null;
      const notesVal = uitleg ? `Shortclip uitleg:\n${uitleg}` : null;

      // Bestaand script bijwerken (geen duplicaat), mits het van deze klant is.
      if (it.scriptId) {
        const [existing] = await db.select({ id: scripts.id, status: scripts.status, currentVersion: scripts.currentVersion })
          .from(scripts)
          .where(and(eq(scripts.id, it.scriptId), eq(scripts.clientId, c.id), isNull(scripts.deletedAt)))
          .limit(1);
        if (existing) {
          // Goedgekeurde scripts niet zonder bevestiging overschrijven.
          if (existing.status === "approved" && !input.force) {
            blocked.push({ index, title });
            continue;
          }
          const nextVersion = (existing.currentVersion ?? 1) + 1;
          await db.update(scripts).set({
            title,
            format,
            hook: hook || null,
            body: bodyVal,
            cta: cta || null,
            internalNotes: notesVal,
            currentVersion: nextVersion,
            updatedAt: new Date(),
            ...(productionDayId ? { productionDayId } : {}),
          }).where(eq(scripts.id, existing.id));
          await db.insert(scriptVersions).values({
            scriptId: existing.id,
            versionNumber: nextVersion,
            snapshot: { title, uitleg, hook, body, cta } as unknown as Record<string, unknown>,
            changeSummary: "Bijgewerkt met de scriptgenerator",
            status: existing.status,
            authorId: viewer.id,
          });
          await auditLog({ viewer, action: "script.update", entityType: "script", entityId: existing.id, clientId: c.id });
          saved.push({ index, scriptId: existing.id });
          continue;
        }
        // scriptId onbekend/verwijderd → val terug op nieuw aanmaken.
      }

      const [row] = await db.insert(scripts).values({
        clientId: c.id,
        productionDayId,
        title,
        status: "concept",
        format,
        hook: hook || null,
        body: bodyVal,
        cta: cta || null,
        internalNotes: notesVal,
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
      saved.push({ index, scriptId: row.id });
    }

    if (saved.length === 0 && blocked.length === 0) return { ok: false, message: "Opslaan lukte niet. Probeer het nog eens." };
    revalidatePath("/scripts");
    revalidatePath("/scripting");
    return { ok: true, count: saved.length, saved, blocked };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
