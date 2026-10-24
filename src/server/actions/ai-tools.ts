"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { aiKnowledge, aiOutputs, clientAiProfiles, clients, contentCalendar, productionDays, deliverables } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { runJsonPrompt, type AiDoc, type AiImage } from "@/server/ai/client";
import { extractDocxText } from "@/server/ai/docx";
import {
  captionProfileToText,
  centralKnowledgeText,
  clientLearnedText,
  getClientAiProfile,
  getClientContextFacts,
  listActiveClientsForAi,
  type CaptionProfile,
  type CommunicationProfile,
  type EditingProfile,
} from "@/server/ai/knowledge";

export type AiActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason?: "no_provider"; message: string };

const SHORTCLIPS_IDENTITY = `Je bent de interne AI-assistent van Shortclips, een gespecialiseerd bureau dat voor klanten organische short-videocontent maakt voor Instagram, TikTok, Facebook en YouTube Shorts. Je schrijft uitsluitend in natuurlijk, vlot Nederlands. Je klinkt nooit als standaard AI-tekst. Je verzint nooit feiten, cijfers, afspraken, prijzen, deadlines of contactgegevens — gebruik alleen wat je expliciet krijgt aangeleverd.`;

async function clientName(clientId: string): Promise<string> {
  const [c] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
  return c?.name ?? "de klant";
}

function docFrom(pdfBase64?: string | null): AiDoc[] {
  return pdfBase64 ? [{ base64: pdfBase64, mediaType: "application/pdf" }] : [];
}

/** Voegt tekst uit een geüpload Word-bestand toe aan de geplakte scripttekst. */
async function mergeDocx(scriptText?: string, docxBase64?: string): Promise<string> {
  let text = scriptText ?? "";
  if (docxBase64) {
    const extracted = await extractDocxText(docxBase64);
    if (extracted) text = `${text}\n\n${extracted}`.trim();
  }
  return text;
}

async function saveOutput(params: {
  clientId: string;
  tool: string;
  title: string | null;
  inputSummary: string | null;
  output: unknown;
  userId: string;
  productionDayId?: string | null;
}) {
  await db.insert(aiOutputs).values({
    clientId: params.clientId,
    tool: params.tool,
    title: params.title,
    inputSummary: params.inputSummary,
    output: params.output as Record<string, unknown>,
    productionDayId: params.productionDayId ?? null,
    createdById: params.userId,
  });
}

/* ------------------------------------------------------------------ *
 * TOOL 1 — Caption Maker
 * ------------------------------------------------------------------ */

export type ShortCaption = {
  shortTitle: string;
  hook: string;
  /** Eén caption, bruikbaar voor Instagram, TikTok, Facebook en YouTube Shorts. */
  caption: string;
  /** Eventueel toepasbare hashtags. */
  hashtags: string[];
};

export async function generateCaptions(input: {
  clientId: string;
  scriptText?: string;
  pdfBase64?: string;
  docxBase64?: string;
  /** Taal van de captions: Nederlands (standaard) of Engels. */
  language?: "nl" | "en";
  /** Optioneel gekoppelde opnamedag. */
  productionDayId?: string;
}): Promise<AiActionResult<ShortCaption[]>> {
  try {
    const viewer = await requirePermission("ai:read");
    assertClientAccess(viewer, input.clientId);
    const scriptText = await mergeDocx(input.scriptText, input.docxBase64);
    if (!scriptText.trim() && !input.pdfBase64) {
      return { ok: false, message: "Plak scripttekst of upload een PDF/Word-bestand." };
    }
    const lang = input.language === "en" ? "en" : "nl";

    const name = await clientName(input.clientId);
    const profile = await getClientAiProfile(input.clientId);
    const caption = captionProfileToText((profile?.captionProfile as CaptionProfile) ?? null);
    const knowledge = await centralKnowledgeText(["branding", "schrijfstijl", "communicatie", "algemeen"]);
    const learned = await clientLearnedText(input.clientId);

    const system = `${SHORTCLIPS_IDENTITY}

Je maakt social media captions voor klant "${name}".

CAPTIONPROFIEL VAN DEZE KLANT:
${caption}
${learned ? `\nGELEERDE KLANTVOORKEUREN (bevestigd uit eerder werk — volg deze):\n${learned}\n` : ""}

${knowledge ? `ALGEMENE SHORTCLIPS-KENNIS:\n${knowledge}\n` : ""}
REGELS VOOR DE CAPTIONS:
- HEEL BELANGRIJK: de caption draait volledig om de hoek/hook van de video. Pak uit het script de hook (de invalshoek waarmee de video opent) en spreek de kijker daar direct op aan. Niet het script navertellen of samenvatten.
- ZEER KORT en pakkend: 1 à 2 korte zinnen, zoals het team ze écht schrijft. Nooit lange captions.
- Gebruik de tone of voice en schrijfstijl van deze klant. Laat het natuurlijk klinken, nooit herkenbaar als AI.
- Gebruik passende emoji's alleen als dat bij deze klant past.
- Voeg contactgegevens alleen toe als dat onderdeel is van de captionstijl van de klant, en uitsluitend de gegevens die in het profiel staan. Verzin nooit gegevens.
- Eén caption per short die werkt op Instagram, TikTok, Facebook én YouTube Shorts (niet per platform verschillend).
- Zet GEEN hashtags in de caption zelf; die geef je apart als eventueel toepasbare hashtags (relevant voor onderwerp en branche, geen generieke of willekeurige — mag een lege lijst zijn).
- Zorg dat de captions onderling variëren — niet elke video dezelfde soort opening.
${lang === "en"
  ? "- TAAL: schrijf ALLE captions in natuurlijk, vloeiend ENGELS (geen Nederlands), passend bij de tone of voice van deze klant. Ook de hashtags in het Engels waar logisch. shortTitle en hook mag je in het Engels teruggeven."
  : "- TAAL: schrijf alle captions in natuurlijk Nederlands."}`;

    const user = `Hieronder staat een document of tekst met één of meer scripts voor afzonderlijke shorts. Herken automatisch hoeveel losse shorts erin staan. Analyseer per short de hook, het onderwerp, de inhoud en de call to action. Genereer per short ÉÉN caption die bruikbaar is voor Instagram, TikTok, Facebook en YouTube Shorts, plus eventueel toepasbare hashtags.

Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder omliggende tekst:
[
  {
    "shortTitle": "korte titel van de short",
    "hook": "de herkende hook",
    "caption": "de caption (zonder hashtags erin)",
    "hashtags": ["#..", "#.."]
  }
]

${scriptText.trim() ? `De scripts:\n\n${scriptText.trim()}` : "De scripts staan in het bijgevoegde document."}`;

    const res = await runJsonPrompt<ShortCaption[]>({
      system,
      user,
      documents: docFrom(input.pdfBase64),
      maxTokens: 12000,
    });
    if (!res.ok) {
      return res.reason === "no_provider"
        ? { ok: false, reason: "no_provider", message: "Er is nog geen AI-sleutel ingesteld." }
        : { ok: false, message: res.error ?? "Genereren mislukt." };
    }
    const data = Array.isArray(res.data) ? res.data : [];
    await saveOutput({
      clientId: input.clientId,
      tool: "caption",
      title: `${data.length} captions${lang === "en" ? " (EN)" : ""}`,
      inputSummary: (scriptText || "PDF-upload").slice(0, 200),
      output: data,
      userId: viewer.id,
      productionDayId: input.productionDayId ?? null,
    });
    await auditLog({ viewer, action: "ai.captions_generated", entityType: "client", entityId: input.clientId, clientId: input.clientId, changes: { shorts: data.length } });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Genereert de captions voor één specifieke short opnieuw (verse variatie). */
export async function regenerateOneCaption(input: {
  clientId: string;
  shortTitle: string;
  hook: string;
  scriptText?: string;
  pdfBase64?: string;
  /** Variant van de nieuwe versie. Leeg = gewoon een frisse variatie. */
  variant?: "variatie" | "met_cta" | "zonder_cta" | "korter" | "langer";
  /** Taal: Nederlands (standaard) of Engels. */
  language?: "nl" | "en";
}): Promise<AiActionResult<ShortCaption>> {
  try {
    const viewer = await requirePermission("ai:read");
    assertClientAccess(viewer, input.clientId);
    const lang = input.language === "en" ? "en" : "nl";

    const name = await clientName(input.clientId);
    const profile = await getClientAiProfile(input.clientId);
    const caption = captionProfileToText((profile?.captionProfile as CaptionProfile) ?? null);

    const system = `${SHORTCLIPS_IDENTITY}

Je maakt captions voor klant "${name}". Houd je aan dit captionprofiel:
${caption}

De caption draait volledig om de hoek/hook van de video en spreekt de kijker daar direct op aan — niet het script navertellen. Standaard ZEER kort en pakkend (1 à 2 korte zinnen), zoals het team ze écht schrijft. Eén caption die werkt op Instagram, TikTok, Facebook en YouTube Shorts. Gebruik passende emoji's; zet geen hashtags in de caption maar geef ze apart. Verzin geen contactgegevens.
${lang === "en" ? "Schrijf de caption in natuurlijk, vloeiend ENGELS (geen Nederlands)." : "Schrijf de caption in natuurlijk Nederlands."}`;

    const variantInstr: Record<NonNullable<typeof input.variant>, string> = {
      variatie: "Kies een andere invalshoek dan voorheen, maar blijf kort en gericht op de hoek van de video.",
      met_cta: "Voeg een duidelijke, natuurlijke call to action toe (bijv. aanzetten tot reageren, kijken of contact opnemen) — passend bij de klant.",
      zonder_cta: "Zonder call to action: puur de pakkende, hook-gerichte caption.",
      korter: "Maak het nóg korter: één pakkende zin die direct de hoek van de video raakt.",
      langer: "Maak het iets uitgebreider (maar nog steeds vlot en gericht op de hoek), met wat meer context of een extra prikkel.",
    };
    const instr = variantInstr[input.variant ?? "variatie"];

    const user = `Genereer UITSLUITEND voor de volgende short één nieuwe caption, bruikbaar voor Instagram, TikTok, Facebook en YouTube Shorts, plus eventueel toepasbare hashtags.

${instr}

Short: "${input.shortTitle}"
Hook: "${input.hook}"
${input.scriptText?.trim() ? `\nContext (volledige scripts):\n${input.scriptText.trim()}` : input.pdfBase64 ? "\nDe scripts staan in het bijgevoegde document." : ""}

Geef UITSLUITEND geldige JSON terug in dit formaat:
{
  "shortTitle": "${input.shortTitle}",
  "hook": "${input.hook}",
  "caption": "...",
  "hashtags": ["#.."]
}`;

    const res = await runJsonPrompt<ShortCaption>({ system, user, documents: docFrom(input.pdfBase64), maxTokens: 2000 });
    if (!res.ok) {
      return res.reason === "no_provider"
        ? { ok: false, reason: "no_provider", message: "Er is nog geen AI-sleutel ingesteld." }
        : { ok: false, message: res.error ?? "Genereren mislukt." };
    }
    return { ok: true, data: res.data };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Zet een goedgekeurde caption in de contentplanning van de klant. Komt als
 * concept-publicatie (status 'to_prepare') op de planner; het team zet daar de
 * datum en zet 'm op 'ingepland', waarna de klant 'm in zijn portaal ziet.
 */
export async function addCaptionToPlanning(input: {
  clientId: string;
  shortTitle: string;
  caption: string;
  /** Optioneel gekoppelde opnamedag, zodat de caption bij de juiste opname hoort. */
  productionDayId?: string;
}): Promise<SimpleResult> {
  try {
    const viewer = await requirePermission("calendar:write");
    assertClientAccess(viewer, input.clientId);
    const title = input.shortTitle.trim() || "Nieuwe publicatie";
    const today = new Date().toISOString().slice(0, 10);

    const [created] = await db
      .insert(contentCalendar)
      .values({
        clientId: input.clientId,
        title,
        scheduledOn: today,
        status: "to_prepare",
        platforms: ["instagram", "tiktok"],
        caption: input.caption.trim() || null,
        productionDayId: input.productionDayId ?? null,
        notes: null,
        ownerId: viewer.id,
      })
      .returning({ id: contentCalendar.id });

    await auditLog({ viewer, action: "ai.caption_to_planning", entityType: "calendar_item", entityId: created!.id, clientId: input.clientId });
    revalidatePath("/calendar");
    return { ok: true, id: created!.id };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Samenvatting van een opnamedag voor de caption maker: hoeveel video's er aan
 * deze opname gekoppeld zijn en hoeveel er uiteindelijk gepubliceerd ("ingezet")
 * zijn. Zo zie je direct welke captions bij welke opname horen en hoeveel er
 * daadwerkelijk is gebruikt.
 */
export async function getShootVideoSummary(productionDayId: string): Promise<
  { ok: true; date: string; title: string; videosTotal: number; videosPublished: number } | { ok: false }
> {
  try {
    const viewer = await requirePermission("ai:read");
    const [pd] = await db
      .select({ id: productionDays.id, clientId: productionDays.clientId, scheduledOn: productionDays.scheduledOn, title: productionDays.title })
      .from(productionDays)
      .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
      .limit(1);
    if (!pd) return { ok: false };
    assertClientAccess(viewer, pd.clientId);
    const [agg] = await db
      .select({
        total: sql<number>`count(*)::int`,
        published: sql<number>`(count(*) filter (where ${deliverables.status} = 'published'))::int`,
      })
      .from(deliverables)
      .where(and(eq(deliverables.productionDayId, pd.id), isNull(deliverables.deletedAt)));
    return { ok: true, date: String(pd.scheduledOn), title: pd.title, videosTotal: Number(agg?.total ?? 0), videosPublished: Number(agg?.published ?? 0) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false };
    throw e;
  }
}

/* ------------------------------------------------------------------ *
 * TOOL 2 — Editor Briefing Maker
 * ------------------------------------------------------------------ */

export type EditorBriefing = {
  projectIntro: {
    client: string;
    aantalShorts: number;
    /** Eén of twee zinnen over de hele sessie. */
    omschrijving: string;
    /** Max ~3 korte, algemene aandachtspunten. */
    algemeneAandachtspunten: string[];
  };
  shorts: Array<{
    titel: string;
    /** Eén of twee zinnen over wat deze short inhoudt. */
    omschrijving: string;
    /** Max 2 korte aandachtspunten voor de editor (optioneel). */
    aandachtspunten: string[];
  }>;
};

export async function generateBriefing(input: {
  clientId: string;
  scriptText?: string;
  pdfBase64?: string;
  docxBase64?: string;
  projectName?: string;
  editorName?: string;
  deadline?: string;
}): Promise<AiActionResult<EditorBriefing>> {
  try {
    const viewer = await requirePermission("ai:read");
    assertClientAccess(viewer, input.clientId);
    const scriptText = await mergeDocx(input.scriptText, input.docxBase64);
    if (!scriptText.trim() && !input.pdfBase64) {
      return { ok: false, message: "Plak scripttekst of upload een PDF/Word-bestand." };
    }

    const name = await clientName(input.clientId);
    const profile = await getClientAiProfile(input.clientId);
    const editing = (profile?.editingProfile as EditingProfile) ?? {};
    const guidelines = await centralKnowledgeText(["editing", "kwaliteit"]);
    const learned = await clientLearnedText(input.clientId);

    const system = `${SHORTCLIPS_IDENTITY}

Je maakt een praktische, scanbare editingbriefing voor een editor, voor klant "${name}". Editors moeten direct begrijpen wat de bedoeling is, zonder lange AI-teksten.

ALGEMENE SHORTCLIPS-EDITINGRICHTLIJNEN (algemeen, niet per se uit dit script):
${guidelines || "- Kies momenten waarop presentatoren goed in beeld staan; vermijd ongelukkige gezichtsuitdrukkingen, gesloten ogen en vreemde tussenframes.\n- Houd belangrijke producten, auto's en onderwerpen goed zichtbaar; plaats tekst/ondertiteling niet over belangrijke onderdelen.\n- Zorg dat de eerste seconden visueel sterk zijn; houd het tempo passend bij het concept.\n- Gebruik alleen relevante, beschikbare beelden; vermijd onnodige effecten. Edit sluit aan op de premium uitstraling van Shortclips."}
${editing.aandachtspunten ? `\nKLANTSPECIFIEKE EDITINGVOORKEUREN:\n${editing.aandachtspunten}` : ""}
${learned ? `\nGELEERDE KLANTVOORKEUREN (bevestigd uit eerder werk — houd hier rekening mee):\n${learned}` : ""}

HEEL BELANGRIJK: presenteer nooit beelden, shots of opnamemomenten als daadwerkelijk beschikbaar wanneer die alleen uit het script worden afgeleid. Als een script bijvoorbeeld zegt dat een auto van binnen en buiten getoond wordt, adviseer dan daarop te letten, maar beweer niet dat die beelden er ook echt zijn. Maak onderscheid tussen algemene richtlijnen en instructies die echt uit het script volgen.`;

    const user = `Hieronder staan de scripts van één opnamesessie (uit het aangeleverde scriptbestand). Herken de afzonderlijke scripts en tel hoeveel video's/shorts het zijn. Maak ÉÉN compacte, heel scanbare briefing voor de editor.

HOUD HET KORT. Leg het script NIET volledig uit en herhaal de tekst niet. Per short geef je alleen:
- een titel (kort);
- een omschrijving van ÉÉN of TWEE zinnen over wat de short inhoudt;
- maximaal 2 korte aandachtspunten voor de montage (alleen als ze echt helpen; anders een lege lijst).

Voor het hele project: een omschrijving van één à twee zinnen en maximaal 3 korte algemene aandachtspunten. Verzin niets; presenteer geen beelden als beschikbaar wanneer die alleen uit het script zijn afgeleid.

Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder omliggende tekst:
{
  "projectIntro": {
    "client": "${name}",
    "aantalShorts": 0,
    "omschrijving": "één of twee zinnen over de sessie",
    "algemeneAandachtspunten": ["kort punt", "kort punt"]
  },
  "shorts": [
    {
      "titel": "korte titel",
      "omschrijving": "één of twee zinnen over deze short",
      "aandachtspunten": ["kort punt", "kort punt"]
    }
  ]
}

${scriptText.trim() ? `De scripts:\n\n${scriptText.trim()}` : "De scripts staan in het bijgevoegde document."}`;

    const res = await runJsonPrompt<EditorBriefing>({
      system,
      user,
      documents: docFrom(input.pdfBase64),
      maxTokens: 4000,
    });
    if (!res.ok) {
      return res.reason === "no_provider"
        ? { ok: false, reason: "no_provider", message: "Er is nog geen AI-sleutel ingesteld." }
        : { ok: false, message: res.error ?? "Genereren mislukt." };
    }
    await saveOutput({
      clientId: input.clientId,
      tool: "briefing",
      title: input.projectName?.trim() || `Briefing ${res.data.shorts?.length ?? 0} shorts`,
      inputSummary: (scriptText || "PDF-upload").slice(0, 200),
      output: res.data,
      userId: viewer.id,
    });
    await auditLog({ viewer, action: "ai.briefing_generated", entityType: "client", entityId: input.clientId, clientId: input.clientId });
    return { ok: true, data: res.data };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * TOOL 3 — Klantbericht Assistent
 * ------------------------------------------------------------------ */

export type ReplyDraft = {
  channel: "whatsapp" | "email" | "onbekend";
  reply: string;
  isSensitive: boolean;
  needsJarno: boolean;
  note: string;
  /** Welke klant automatisch herkend is (null als het niet lukte). */
  detectedClientName: string | null;
};

/**
 * Herkent automatisch bij welke actieve klant een bericht/screenshot hoort,
 * puur door het model te laten kiezen uit de lijst met klantnamen. Geeft null
 * terug als het niet met redelijke zekerheid kan.
 */
async function detectClientFromMessage(input: {
  messageText?: string;
  images?: AiImage[];
  candidates: { id: string; name: string }[];
}): Promise<{ id: string; name: string } | null> {
  if (input.candidates.length === 0) return null;
  const list = input.candidates.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
  const system = `Je bepaalt bij welke klant van Shortclips een ontvangen bericht of screenshot hoort. Kies ALLEEN uit de genummerde klantenlijst. Gebruik aanwijzingen zoals de naam van de afzender, het bedrijf, de contactpersoon of de inhoud. Als je het niet met redelijke zekerheid kunt bepalen, kies 0.`;
  const user = `Klanten:
${list}

Bepaal bij welk klantnummer het onderstaande bericht/screenshot hoort. Geef UITSLUITEND geldige JSON terug: {"nummer": <getal; 0 als onbekend>}.

${input.messageText?.trim() ? `Het bericht:\n\n${input.messageText.trim()}` : "Het bericht staat in de bijgevoegde screenshot(s)."}`;
  const res = await runJsonPrompt<{ nummer: number }>({ system, user, images: input.images, maxTokens: 200 });
  if (!res.ok) return null;
  const idx = Number(res.data?.nummer) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= input.candidates.length) return null;
  return input.candidates[idx] ?? null;
}

export async function generateReply(input: {
  /** Optioneel: als een klant al bekend is (bijv. uit geschiedenis). Anders
   *  wordt de klant automatisch herkend uit het bericht/screenshot. */
  clientId?: string;
  messageText?: string;
  tone?: "standaard" | "korter" | "vriendelijker" | "netter" | "duidelijker" | "directer" | "uitgebreider";
  images?: AiImage[];
}): Promise<AiActionResult<ReplyDraft>> {
  try {
    const viewer = await requirePermission("ai:read");
    if (!input.messageText?.trim() && (!input.images || input.images.length === 0)) {
      return { ok: false, message: "Plak het klantbericht of sleep een screenshot erin." };
    }

    // Klant bepalen: gebruik de meegegeven klant, of herken hem automatisch.
    let clientId = input.clientId;
    if (clientId) {
      assertClientAccess(viewer, clientId);
    } else {
      const candidates = await listActiveClientsForAi(viewer);
      const detected = await detectClientFromMessage({ messageText: input.messageText, images: input.images, candidates });
      clientId = detected?.id;
    }

    // Context opbouwen. Met herkende klant: volledige dashboardcontext.
    // Zonder klant: algemeen antwoord met een duidelijke notitie.
    const name = clientId ? await clientName(clientId) : null;
    const profile = clientId ? await getClientAiProfile(clientId) : null;
    const comms = (profile?.communicationProfile as CommunicationProfile) ?? {};
    const facts = clientId ? await getClientContextFacts(viewer, clientId) : "";
    const learned = clientId ? await clientLearnedText(clientId) : "";
    const knowledge = await centralKnowledgeText(["communicatie", "productie", "escalatie", "algemeen"]);

    const system = `${SHORTCLIPS_IDENTITY}

Je helpt een medewerker een professioneel conceptantwoord op te stellen voor een ontvangen klantbericht. Het antwoord is altijd een CONCEPT — er wordt niets automatisch verstuurd.

${name ? `Dit bericht hoort bij klant "${name}".

LIVE KLANTCONTEXT (uit ons dashboard):
${facts}
${comms.afspraken ? `\nAFSPRAKEN MET DEZE KLANT:\n${comms.afspraken}` : ""}
${learned ? `\nGELEERDE KLANTVOORKEUREN (bevestigd uit eerder werk):\n${learned}` : ""}` : `Het is niet gelukt om automatisch vast te stellen bij welke klant dit bericht hoort. Schrijf een correct, algemeen Shortclips-antwoord zonder klantspecifieke aannames, en geef in "note" aan dat de klant niet automatisch herkend kon worden.`}

${knowledge ? `SHORTCLIPS-KENNISBANK (werkwijze, afspraken, escalatie):\n${knowledge}\n` : ""}
COMMUNICATIESTIJL:
- Professioneel maar niet overdreven formeel. Vriendelijk, persoonlijk en direct. Natuurlijke Nederlandse zinnen, niet te lang.
- Geen standaard AI-taalgebruik, niet onnodig commercieel. Spreek vanuit "wij" (Shortclips als team).
- Communiceer duidelijk over afspraken en verwachtingen. Doe geen toezeggingen die niet gecontroleerd zijn. Verzin geen afspraken, deadlines of prijzen.
- Maak verschil tussen een WhatsApp-antwoord (korter, informeler) en een e-mail (iets uitgebreider, met nette aanhef/afsluiting).
- Als er onvoldoende informatie is om goed te antwoorden, geef dat aan in plaats van iets te verzinnen.

ESCALATIE: signaleer gevoelige onderwerpen zoals klachten, financiële afspraken of contractwijzigingen. Zet bij zulke onderwerpen needsJarno op true en benoem in "note" kort dat akkoord van Jarno nodig is.`;

    const toneInstr =
      input.tone && input.tone !== "standaard"
        ? `\n\nMaak het antwoord ${input.tone}.`
        : "";

    const user = `Hier is een ontvangen klantbericht (als tekst en/of screenshot). Lees het, bepaal zelf of het een WhatsApp-bericht of e-mail is, begrijp wat de klant vraagt, en stel één passend conceptantwoord op in de Shortclips-stijl.${toneInstr}

Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder omliggende tekst:
{
  "channel": "whatsapp" | "email" | "onbekend",
  "reply": "het conceptantwoord",
  "isSensitive": true/false,
  "needsJarno": true/false,
  "note": "korte toelichting; bij gevoelige onderwerpen: dat akkoord van Jarno nodig is, of welke info nog ontbreekt"
}

${input.messageText?.trim() ? `Het bericht:\n\n${input.messageText.trim()}` : "Het bericht staat in de bijgevoegde screenshot(s)."}`;

    const res = await runJsonPrompt<ReplyDraft>({
      system,
      user,
      images: input.images,
      maxTokens: 4000,
    });
    if (!res.ok) {
      return res.reason === "no_provider"
        ? { ok: false, reason: "no_provider", message: "Er is nog geen AI-sleutel ingesteld." }
        : { ok: false, message: res.error ?? "Genereren mislukt." };
    }
    const data: ReplyDraft = { ...res.data, detectedClientName: name };
    // Alleen bewaren in de geschiedenis als we een klant hebben (vereist veld).
    if (clientId) {
      await saveOutput({
        clientId,
        tool: "message",
        title: data.channel === "email" ? "E-mailconcept" : "WhatsApp-concept",
        inputSummary: (input.messageText ?? "Screenshot").slice(0, 200),
        output: data,
        userId: viewer.id,
      });
      await auditLog({ viewer, action: "ai.reply_generated", entityType: "client", entityId: clientId, clientId, changes: { needsJarno: data.needsJarno } });
    }
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Kennisbank & klantprofiel beheren
 * ------------------------------------------------------------------ */

export type SimpleResult = { ok: boolean; message?: string; id?: string };

export async function saveKnowledgeItem(input: { id?: string; category: string; title: string; body: string }): Promise<SimpleResult> {
  try {
    // Lezen van de kennisbank mag met ai:read; aanpassen/verwijderen vraagt het
    // sterkere ai:run (owner, admin, projectcoördinator) — een leesrecht mag
    // geen gedeelde kennis muteren.
    const viewer = await requirePermission("ai:run");
    const category = (input.category || "algemeen").trim().slice(0, 48);
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title || !body) return { ok: false, message: "Titel en inhoud zijn verplicht." };

    if (input.id) {
      await db.update(aiKnowledge).set({ category, title, body, updatedAt: new Date() }).where(eq(aiKnowledge.id, input.id));
    } else {
      await db.insert(aiKnowledge).values({ category, title, body });
    }
    await auditLog({ viewer, action: "ai.knowledge_saved", entityType: "ai_knowledge", entityId: input.id ?? null });
    revalidatePath("/ai/kennisbank");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function deleteKnowledgeItem(id: string): Promise<SimpleResult> {
  try {
    const viewer = await requirePermission("ai:run");
    await db.update(aiKnowledge).set({ deletedAt: new Date() }).where(eq(aiKnowledge.id, id));
    await auditLog({ viewer, action: "ai.knowledge_deleted", entityType: "ai_knowledge", entityId: id });
    revalidatePath("/ai/kennisbank");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function saveClientAiProfile(input: {
  clientId: string;
  captionProfile?: CaptionProfile;
  editingProfile?: EditingProfile;
  communicationProfile?: CommunicationProfile;
}): Promise<SimpleResult> {
  try {
    const viewer = await requirePermission("ai:read");
    assertClientAccess(viewer, input.clientId);

    const [existing] = await db
      .select({ id: clientAiProfiles.id })
      .from(clientAiProfiles)
      .where(eq(clientAiProfiles.clientId, input.clientId))
      .limit(1);

    const values = {
      captionProfile: (input.captionProfile ?? {}) as Record<string, unknown>,
      editingProfile: (input.editingProfile ?? {}) as Record<string, unknown>,
      communicationProfile: (input.communicationProfile ?? {}) as Record<string, unknown>,
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(clientAiProfiles).set(values).where(eq(clientAiProfiles.id, existing.id));
    } else {
      await db.insert(clientAiProfiles).values({ clientId: input.clientId, ...values });
    }
    await auditLog({ viewer, action: "ai.profile_saved", entityType: "client", entityId: input.clientId, clientId: input.clientId });
    revalidatePath("/ai/kennisbank");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
