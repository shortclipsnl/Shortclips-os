"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { aiOutputs, clients, scripts } from "@/db/schema";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { aiConfigured, runJsonPrompt } from "@/server/ai/client";
import { getClientAiProfile, captionProfileToText, centralKnowledgeText, type CaptionProfile } from "@/server/ai/knowledge";
import { getIntelligenceOverview } from "@/server/video-intelligence/intelligence";
import { estimateSpeakingTime, findSimilarScripts, gatherFeedbackContext, DEFAULT_WPM, type SpeakingEstimate, type FeedbackContext } from "@/server/script-control";

export type ScriptControlAi = {
  hookType?: string[];
  hookOordeel?: string;
  watGoed?: string[];
  watBeter?: string[];
  watAanpassen?: string[];
  kijkersreis?: string[];
  natuurlijkTaalgebruik?: string[];
  feitenTeControleren?: string[];
  alternatieveHooks?: string[];
  verbeterdScript?: { hook?: string; body?: string; cta?: string };
};
export type ScriptControlResult = {
  scriptId: string;
  speaking: SpeakingEstimate;
  similar: Array<{ id: string; title: string; status: string; pillar: string | null; format: string | null }>;
  feedback: FeedbackContext;
  ai: ScriptControlAi | null;
  aiReady: boolean;
  generatedAt: string;
};
type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

const SYSTEM = `Je bent script-analist voor Shortclips, een bureau voor organische short video's (TikTok/Reels/Shorts). Beoordeel of een script geschikt is voor sterke, resultaatgerichte short content volgens de interne richtlijnen. Onderbouw elk punt met wat daadwerkelijk in het script staat. Scheid bewezen observatie van creatieve verwachting. Verzin nooit cijfers of productspecificaties: markeer onbevestigde feitelijke claims (prijzen, specificaties, percentages, vergelijkingen) als "Handmatige controle nodig". Behoud bij een herschrijf het oorspronkelijke concept en de tone of voice van de klant. Geef uitsluitend geldige JSON terug.`;

export async function controleScript(scriptId: string): Promise<ActionResult<ScriptControlResult>> {
  try {
    const viewer = await requirePermission("ai:read");
    const [s] = await db
      .select({ id: scripts.id, clientId: scripts.clientId, title: scripts.title, hook: scripts.hook, body: scripts.body, cta: scripts.cta, pillar: scripts.pillar, format: scripts.format, clientSlug: clients.slug, clientName: clients.name })
      .from(scripts)
      .innerJoin(clients, eq(clients.id, scripts.clientId))
      .where(eq(scripts.id, scriptId))
      .limit(1);
    if (!s) return { ok: false, message: "Script niet gevonden." };
    assertClientAccess(viewer, s.clientId);

    // Kalibreer het spreektempo met het gemiddelde van de klant uit VI (indien beschikbaar).
    const intel = await getIntelligenceOverview(viewer, s.clientSlug);
    const wpm = intel.speech?.avgWpm && intel.speech.avgWpm > 60 ? intel.speech.avgWpm : DEFAULT_WPM;

    const [similar, feedback] = await Promise.all([
      findSimilarScripts(s.clientId, scriptId, s.pillar, s.format),
      gatherFeedbackContext(s.clientId),
    ]);
    const speaking = estimateSpeakingTime({ hook: s.hook, body: s.body, cta: s.cta }, wpm);

    let ai: ScriptControlAi | null = null;
    if (aiConfigured()) {
      const profile = await getClientAiProfile(s.clientId);
      const central = await centralKnowledgeText(["schrijfstijl", "branding", "kwaliteit"]);
      const context = [
        feedback.afspraken ? `Communicatie-afspraken met de klant:\n${feedback.afspraken}` : "",
        feedback.aandachtspunten ? `Editing-aandachtspunten:\n${feedback.aandachtspunten}` : "",
        feedback.recenteKlantopmerkingen.length ? `Recente klant-opmerkingen op eerdere video's:\n- ${feedback.recenteKlantopmerkingen.join("\n- ")}` : "",
        profile ? captionProfileToText(profile.captionProfile as CaptionProfile) : "",
        central,
        intel.speech?.avgWpm ? `Gemiddelde spreeksnelheid van deze klant uit Video Intelligence: ${intel.speech.avgWpm} wpm.` : "",
      ].filter(Boolean).join("\n\n");

      const res = await runJsonPrompt<ScriptControlAi>({
        system: SYSTEM,
        user: `Klant: ${s.clientName}. Format: ${s.format ?? "onbekend"}. Pijler: ${s.pillar ?? "onbekend"}.\nGeschatte spreektijd: ~${speaking.seconds}s (${speaking.words} woorden @ ${wpm} wpm).\n\nSCRIPT\nHook: ${s.hook ?? "(leeg)"}\nMiddenstuk: ${s.body ?? "(leeg)"}\nCTA: ${s.cta ?? "(leeg)"}\n\nCONTEXT (eerdere feedback + stijl)\n${context || "(geen context beschikbaar)"}\n\nBeoordeel volgens de Shortclips-richtlijnen (hook direct duidelijk, nieuwsgierigheid passend bij format, hooktype, middenstuk-tempo/informatiedichtheid/logica, CTA passend + evt. poll/save, natuurlijk uitspreekbaar taalgebruik + mogelijke struikelpunten, volledige kijkersreis, feitelijke claims). Geef JSON:\n{\n "hookType": string[],\n "hookOordeel": string,\n "watGoed": string[],\n "watBeter": string[],\n "watAanpassen": string[],\n "kijkersreis": string[],\n "natuurlijkTaalgebruik": string[],\n "feitenTeControleren": string[],\n "alternatieveHooks": string[],  // 3 sterkere openingen, met korte reden\n "verbeterdScript": { "hook": string, "body": string, "cta": string }  // zelfde concept + tone\n}`,
        maxTokens: 4000,
      });
      if (res.ok) ai = res.data;
    }

    const result: ScriptControlResult = { scriptId, speaking, similar, feedback, ai, aiReady: aiConfigured(), generatedAt: new Date().toISOString() };
    await db.insert(aiOutputs).values({
      clientId: s.clientId, tool: "scriptcontrole", title: s.title ?? "Scriptcontrole",
      inputSummary: scriptId, output: result as unknown as Record<string, unknown>, createdById: viewer.id,
    });
    await auditLog({ viewer, action: "script.control", entityType: "script", entityId: scriptId, clientId: s.clientId });
    revalidatePath(`/scripts/${scriptId}`);
    return { ok: true, data: result };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Neemt (na bevestiging) het verbeterde script over — overschrijft nooit automatisch. */
export async function applyImprovedScript(input: { scriptId: string; hook?: string; body?: string; cta?: string }): Promise<{ ok: boolean; message?: string }> {
  try {
    const viewer = await requirePermission("scripts:write");
    const [s] = await db.select({ clientId: scripts.clientId }).from(scripts).where(eq(scripts.id, input.scriptId)).limit(1);
    if (!s) return { ok: false, message: "Script niet gevonden." };
    assertClientAccess(viewer, s.clientId);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.hook !== undefined) set.hook = input.hook;
    if (input.body !== undefined) set.body = input.body;
    if (input.cta !== undefined) set.cta = input.cta;
    await db.update(scripts).set(set).where(eq(scripts.id, input.scriptId));
    await auditLog({ viewer, action: "script.apply_improved", entityType: "script", entityId: input.scriptId, clientId: s.clientId });
    revalidatePath(`/scripts/${input.scriptId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
