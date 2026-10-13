"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { aiKnowledge, aiOutputs, clientAiProfiles, clients, contentCalendar } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { runJsonPrompt, type AiDoc, type AiImage } from "@/server/ai/client";
import { extractDocxText } from "@/server/ai/docx";
import {
  captionProfileToText,
  centralKnowledgeText,
  getClientAiProfile,
  getClientContextFacts,
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
}) {
  await db.insert(aiOutputs).values({
    clientId: params.clientId,
    tool: params.tool,
    title: params.title,
    inputSummary: params.inputSummary,
    output: params.output as Record<string, unknown>,
    createdById: params.userId,
  });
}

/* ------------------------------------------------------------------ *
 * TOOL 1 — Caption Maker
 * ------------------------------------------------------------------ */

export type ShortCaption = {
  shortTitle: string;
  hook: string;
  instagram: { caption: string; hashtags: string[] };
  tiktok: { caption: string; hashtags: string[] };
};

export async function generateCaptions(input: {
  clientId: string;
  scriptText?: string;
  pdfBase64?: string;
  docxBase64?: string;
}): Promise<AiActionResult<ShortCaption[]>> {
  try {
    const viewer = await requirePermission("ai:read");
    assertClientAccess(viewer, input.clientId);
    const scriptText = await mergeDocx(input.scriptText, input.docxBase64);
    if (!scriptText.trim() && !input.pdfBase64) {
      return { ok: false, message: "Plak scripttekst of upload een PDF/Word-bestand." };
    }

    const name = await clientName(input.clientId);
    const profile = await getClientAiProfile(input.clientId);
    const caption = captionProfileToText((profile?.captionProfile as CaptionProfile) ?? null);
    const knowledge = await centralKnowledgeText(["branding", "schrijfstijl", "communicatie", "algemeen"]);

    const system = `${SHORTCLIPS_IDENTITY}

Je maakt social media captions voor klant "${name}".

CAPTIONPROFIEL VAN DEZE KLANT:
${caption}

${knowledge ? `ALGEMENE SHORTCLIPS-KENNIS:\n${knowledge}\n` : ""}
REGELS VOOR DE CAPTIONS:
- Baseer elke caption op de daadwerkelijke inhoud van het script.
- Gebruik de hook van het script als belangrijk uitgangspunt voor de opening, maar schrijf het script niet over — maak een aantrekkelijke caption die aansluit op de video.
- Gebruik de tone of voice en schrijfstijl van deze klant. Laat het natuurlijk klinken, nooit herkenbaar als AI.
- Gebruik passende emoji's alleen als dat bij deze klant past.
- Voeg relevante hashtags toe die aansluiten op het onderwerp, de branche en het platform. Vermijd generieke of willekeurige hashtags.
- Voeg contactgegevens alleen toe als dat onderdeel is van de captionstijl van de klant, en uitsluitend de gegevens die in het profiel staan. Verzin nooit gegevens.
- Instagram mag wat meer toelichting bevatten; TikTok is korter en directer. Houd rekening met de eventueel ingestelde lengtes per platform.
- Zorg dat de captions onderling variëren — niet elke video dezelfde soort opening.`;

    const user = `Hieronder staat een document of tekst met één of meer scripts voor afzonderlijke shorts. Herken automatisch hoeveel losse shorts erin staan. Analyseer per short de hook, het onderwerp, de inhoud en de call to action. Genereer per short twee captions: één voor Instagram en één voor TikTok.

Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder omliggende tekst:
[
  {
    "shortTitle": "korte titel van de short",
    "hook": "de herkende hook",
    "instagram": { "caption": "...", "hashtags": ["#..", "#.."] },
    "tiktok": { "caption": "...", "hashtags": ["#..", "#.."] }
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
      title: `${data.length} captions`,
      inputSummary: (scriptText || "PDF-upload").slice(0, 200),
      output: data,
      userId: viewer.id,
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
}): Promise<AiActionResult<ShortCaption>> {
  try {
    const viewer = await requirePermission("ai:read");
    assertClientAccess(viewer, input.clientId);

    const name = await clientName(input.clientId);
    const profile = await getClientAiProfile(input.clientId);
    const caption = captionProfileToText((profile?.captionProfile as CaptionProfile) ?? null);

    const system = `${SHORTCLIPS_IDENTITY}

Je maakt captions voor klant "${name}". Houd je aan dit captionprofiel:
${caption}

Baseer de caption op de inhoud van het script en de hook. Instagram mag wat meer toelichting bevatten; TikTok is korter en directer. Gebruik passende emoji's en relevante hashtags, geen generieke. Verzin geen contactgegevens.`;

    const user = `Genereer UITSLUITEND voor de volgende short nieuwe, frisse captions (andere invalshoek dan voorheen) voor Instagram en TikTok.

Short: "${input.shortTitle}"
Hook: "${input.hook}"
${input.scriptText?.trim() ? `\nContext (volledige scripts):\n${input.scriptText.trim()}` : input.pdfBase64 ? "\nDe scripts staan in het bijgevoegde document." : ""}

Geef UITSLUITEND geldige JSON terug in dit formaat:
{
  "shortTitle": "${input.shortTitle}",
  "hook": "${input.hook}",
  "instagram": { "caption": "...", "hashtags": ["#.."] },
  "tiktok": { "caption": "...", "hashtags": ["#.."] }
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
  instagramCaption: string;
  tiktokCaption: string;
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
        caption: input.instagramCaption.trim() || null,
        notes: input.tiktokCaption.trim() ? `TikTok-caption:\n${input.tiktokCaption.trim()}` : null,
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

/* ------------------------------------------------------------------ *
 * TOOL 2 — Editor Briefing Maker
 * ------------------------------------------------------------------ */

export type EditorBriefing = {
  projectIntro: {
    client: string;
    project: string;
    aantalShorts: number;
    editor: string;
    deadline: string;
    omschrijving: string;
    algemeneAandachtspunten: string[];
  };
  shorts: Array<{
    titel: string;
    omschrijving: string;
    doel: string;
    hook: string;
    beelden: string;
    opbouw: string;
    tekstelementen: string;
    montagekeuzes: string;
    nietVergeten: string;
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

    const system = `${SHORTCLIPS_IDENTITY}

Je maakt een praktische, scanbare editingbriefing voor een editor, voor klant "${name}". Editors moeten direct begrijpen wat de bedoeling is, zonder lange AI-teksten.

ALGEMENE SHORTCLIPS-EDITINGRICHTLIJNEN (algemeen, niet per se uit dit script):
${guidelines || "- Kies momenten waarop presentatoren goed in beeld staan; vermijd ongelukkige gezichtsuitdrukkingen, gesloten ogen en vreemde tussenframes.\n- Houd belangrijke producten, auto's en onderwerpen goed zichtbaar; plaats tekst/ondertiteling niet over belangrijke onderdelen.\n- Zorg dat de eerste seconden visueel sterk zijn; houd het tempo passend bij het concept.\n- Gebruik alleen relevante, beschikbare beelden; vermijd onnodige effecten. Edit sluit aan op de premium uitstraling van Shortclips."}
${editing.aandachtspunten ? `\nKLANTSPECIFIEKE EDITINGVOORKEUREN:\n${editing.aandachtspunten}` : ""}

HEEL BELANGRIJK: presenteer nooit beelden, shots of opnamemomenten als daadwerkelijk beschikbaar wanneer die alleen uit het script worden afgeleid. Als een script bijvoorbeeld zegt dat een auto van binnen en buiten getoond wordt, adviseer dan daarop te letten, maar beweer niet dat die beelden er ook echt zijn. Maak onderscheid tussen algemene richtlijnen en instructies die echt uit het script volgen.`;

    const user = `Hieronder staan de scripts van één opnamesessie. Herken de afzonderlijke scripts. Analyseer per short het concept, de hook, de opbouw en de gewenste montage. Maak één overzichtelijke briefing voor het hele project.

Projectgegevens (gebruik wat beschikbaar is, verzin niets):
- Project/opnamesessie: ${input.projectName?.trim() || "(niet opgegeven)"}
- Editor: ${input.editorName?.trim() || "(niet opgegeven)"}
- Deadline: ${input.deadline?.trim() || "(niet opgegeven)"}

Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder omliggende tekst:
{
  "projectIntro": {
    "client": "${name}",
    "project": "...",
    "aantalShorts": 0,
    "editor": "...",
    "deadline": "...",
    "omschrijving": "korte omschrijving van het project",
    "algemeneAandachtspunten": ["..", ".."]
  },
  "shorts": [
    {
      "titel": "titel van het concept",
      "omschrijving": "korte omschrijving van de video",
      "doel": "wat het doel is van het concept",
      "hook": "wat belangrijk is aan de hook",
      "beelden": "welke beelden of momenten extra aandacht verdienen (als advies, niet als bewering dat ze bestaan)",
      "opbouw": "hoe de video logisch opgebouwd moet worden",
      "tekstelementen": "welke tekstuele elementen mogelijk nodig zijn",
      "montagekeuzes": "welke montagekeuzes helpen de kijker vast te houden",
      "nietVergeten": "wat absoluut niet vergeten mag worden"
    }
  ]
}

${scriptText.trim() ? `De scripts:\n\n${scriptText.trim()}` : "De scripts staan in het bijgevoegde document."}`;

    const res = await runJsonPrompt<EditorBriefing>({
      system,
      user,
      documents: docFrom(input.pdfBase64),
      maxTokens: 14000,
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
};

export async function generateReply(input: {
  clientId: string;
  messageText?: string;
  channelHint?: "whatsapp" | "email" | "auto";
  tone?: "standaard" | "korter" | "vriendelijker" | "directer" | "uitgebreider";
  images?: AiImage[];
}): Promise<AiActionResult<ReplyDraft>> {
  try {
    const viewer = await requirePermission("ai:read");
    assertClientAccess(viewer, input.clientId);
    if (!input.messageText?.trim() && (!input.images || input.images.length === 0)) {
      return { ok: false, message: "Plak het klantbericht of upload een screenshot." };
    }

    const name = await clientName(input.clientId);
    const profile = await getClientAiProfile(input.clientId);
    const comms = (profile?.communicationProfile as CommunicationProfile) ?? {};
    const facts = await getClientContextFacts(viewer, input.clientId);
    const knowledge = await centralKnowledgeText(["communicatie", "productie", "escalatie", "algemeen"]);

    const system = `${SHORTCLIPS_IDENTITY}

Je helpt een medewerker een professioneel conceptantwoord op te stellen voor een bericht van klant "${name}". Het antwoord is altijd een CONCEPT — er wordt niets automatisch verstuurd.

LIVE KLANTCONTEXT (uit ons dashboard):
${facts}
${comms.afspraken ? `\nAFSPRAKEN MET DEZE KLANT:\n${comms.afspraken}` : ""}

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

    const user = `Hier is een ontvangen klantbericht (als tekst en/of screenshot). Lees het, bepaal of het een WhatsApp-bericht of e-mail is${input.channelHint && input.channelHint !== "auto" ? ` (hint: ${input.channelHint})` : ""}, begrijp wat de klant vraagt, en stel één passend conceptantwoord op in de Shortclips-stijl.${toneInstr}

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
    await saveOutput({
      clientId: input.clientId,
      tool: "message",
      title: res.data.channel === "email" ? "E-mailconcept" : "WhatsApp-concept",
      inputSummary: (input.messageText ?? "Screenshot").slice(0, 200),
      output: res.data,
      userId: viewer.id,
    });
    await auditLog({ viewer, action: "ai.reply_generated", entityType: "client", entityId: input.clientId, clientId: input.clientId, changes: { needsJarno: res.data.needsJarno } });
    return { ok: true, data: res.data };
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
