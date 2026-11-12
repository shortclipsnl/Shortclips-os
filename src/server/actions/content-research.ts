"use server";

import { after } from "next/server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentChatConversations, contentChatMessages, contentCompetitors, contentIdeas } from "@/db/schema";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { aiConfigured, runChat, type ChatMessage } from "@/server/ai/client";
import { SHORTCLIPS_IDENTITY } from "@/server/ai/identity";
import { auditLog } from "@/server/audit";
import { latestRun, runContentResearchJob, startContentResearchRun } from "@/server/content-research/run";
import { ensureStyleProfile, saveStyleNotes } from "@/server/content-research/style";
import { buildContentContext } from "@/server/content-research/service";
import {
  addAcceptedConcept,
  addRejectedConcept,
  loadDna,
  normalizeDna,
  saveDna,
  type ContentDna,
} from "@/server/content-research/content-dna";

export type ActionResult = { ok: boolean; message?: string };

const CHAT_SYSTEM = `${SHORTCLIPS_IDENTITY}

Je bent de creatieve contentstrateeg van Shortclips en spart met het team over organische video-ideeën voor één specifieke klant. Je kent deze klant: eerdere scripts, feedback, opgeslagen ideeën, het Content DNA en wat er aantoonbaar werkt (hieronder). Blijf klantspecifiek en concreet, verzin geen cijfers of nepvoorbeelden, en vermijd standaard-AI-ideeën. Geef, waar passend, kant-en-klare hooks. Antwoord in het Nederlands.`;

const MAX_MESSAGES = 30;

function dedupeHash(titel: string, concept: string): string {
  const norm = `${titel} ${concept}`.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

/** Laadt een idee en dwingt klanttoegang af. */
async function loadIdeaScoped(viewerPromise: ReturnType<typeof requirePermission>, ideaId: string) {
  const viewer = await viewerPromise;
  const [idea] = await db
    .select()
    .from(contentIdeas)
    .where(and(eq(contentIdeas.id, ideaId), isNull(contentIdeas.deletedAt)))
    .limit(1);
  if (!idea) return { viewer, idea: null as null };
  assertClientAccess(viewer, idea.clientId);
  return { viewer, idea };
}

/** Start (of herstart) een onderzoeksronde voor een klant. */
export async function startResearch(clientId: string): Promise<ActionResult & { runId?: string }> {
  try {
    const viewer = await requirePermission("content_research:write");
    assertClientAccess(viewer, clientId);
    // Status is leidend: voor inactieve klanten (paused/churned) wordt géén nieuw
    // onderzoek gestart. Bestaande onderzoeken en ideeën blijven gewoon bestaan.
    const [c] = await db.select({ status: clients.status }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (c && (c.status === "paused" || c.status === "churned")) {
      return { ok: false, message: "Deze klant staat op inactief — er wordt geen nieuw onderzoek gestart. Zet de klant weer op actief in Klantbeheer." };
    }
    if (!aiConfigured()) return { ok: false, message: "Er is nog geen AI-sleutel ingesteld (ANTHROPIC_API_KEY)." };
    const last = await latestRun(clientId);
    if (last && last.status === "bezig" && !last.stale) return { ok: false, message: "Er loopt al een onderzoek voor deze klant." };

    // Een vastgelopen ronde hervatten we (de briefing blijft bewaard), anders nieuw.
    const runId = last && last.status === "bezig" && last.stale ? last.id : await startContentResearchRun(clientId, viewer.id);
    // De fases draaien na de response (overleeft navigatie). Wat niet meer in deze
    // aanroep past, start in een eigen aanroep; anders pakt de cron het op.
    after(async () => {
      try {
        // Past de volgende fase niet meer, dan start de job zelf de doorstart.
        await runContentResearchJob(runId, { budgetMs: 240_000 });
      } catch {
        /* status blijft 'bezig' → de cron pikt 'm op */
      }
    });

    await auditLog({ viewer, action: "content_research.started", entityType: "content_research_run", entityId: runId, clientId });
    revalidatePath("/ai/content-research");
    revalidatePath(`/ai/content-research/${clientId}`);
    return { ok: true, runId };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

async function setIdeaStatus(ideaId: string, status: string, extra?: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { viewer, idea } = await loadIdeaScoped(requirePermission("content_research:write"), ideaId);
    if (!idea) return { ok: false, message: "Idee niet gevonden." };
    await db.update(contentIdeas).set({ status: status as never, ...extra, updatedAt: new Date() }).where(eq(contentIdeas.id, ideaId));
    await auditLog({ viewer, action: `content_research.idea_${status}`, entityType: "content_idea", entityId: ideaId, clientId: idea.clientId });
    revalidatePath(`/ai/content-research/${idea.clientId}`);
    revalidatePath("/ai/content-research");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function favoriteIdea(ideaId: string): Promise<ActionResult> {
  const { idea } = await loadIdeaScoped(requirePermission("content_research:write"), ideaId);
  if (idea) await addAcceptedConcept(idea.clientId, idea.titel);
  return setIdeaStatus(ideaId, "favoriet");
}

export async function saveIdea(ideaId: string): Promise<ActionResult> {
  return setIdeaStatus(ideaId, "opgeslagen");
}

export async function archiveIdea(ideaId: string): Promise<ActionResult> {
  return setIdeaStatus(ideaId, "gearchiveerd");
}

/** Wijs een idee af met een reden; het Content DNA leert hiervan. */
export async function rejectIdea(ideaId: string, reason: string): Promise<ActionResult> {
  try {
    const { viewer, idea } = await loadIdeaScoped(requirePermission("content_research:write"), ideaId);
    if (!idea) return { ok: false, message: "Idee niet gevonden." };
    const r = (reason ?? "").trim().slice(0, 500);
    await db.update(contentIdeas).set({ status: "afgewezen", rejectionReason: r || null, updatedAt: new Date() }).where(eq(contentIdeas.id, ideaId));
    await addRejectedConcept(idea.clientId, r ? `${idea.titel} — ${r}` : idea.titel, viewer.id);
    await auditLog({ viewer, action: "content_research.idea_afgewezen", entityType: "content_idea", entityId: ideaId, clientId: idea.clientId });
    revalidatePath(`/ai/content-research/${idea.clientId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Al gebruikt (eerder gemaakt of elders opgepakt): blijft zichtbaar in het archief. */
export async function markIdeaUsed(ideaId: string): Promise<ActionResult> {
  return setIdeaStatus(ideaId, "gebruikt");
}

/** Terug naar "nieuw" (bijv. per ongeluk gemarkeerd). Een doorgestuurd idee blijft gekoppeld. */
export async function resetIdea(ideaId: string): Promise<ActionResult> {
  return setIdeaStatus(ideaId, "nieuw", { rejectionReason: null });
}

/**
 * Stuurt het idee door naar de Scriptgenerator van de juiste klant. Idempotent:
 * een tweede klik maakt geen tweede overdracht, maar opent dezelfde (met de
 * melding dat het al eerder is doorgestuurd en, indien bekend, het script).
 */
export async function forwardIdeaToGenerator(ideaId: string): Promise<ActionResult & { url?: string; alreadyForwarded?: boolean; scriptLink?: string | null }> {
  try {
    const { viewer, idea } = await loadIdeaScoped(requirePermission("content_research:write"), ideaId);
    if (!idea) return { ok: false, message: "Idee niet gevonden." };
    const url = `/ai/scriptgenerator?client=${idea.clientId}&idea=${idea.id}`;
    if (idea.forwardedAt) {
      return { ok: true, url, alreadyForwarded: true, scriptLink: idea.scriptLink };
    }
    // Voorwaardelijke update: bij twee gelijktijdige klikken wint er één.
    const updated = await db
      .update(contentIdeas)
      .set({ status: "doorgestuurd", forwardedAt: new Date(), forwardedById: viewer.id, updatedAt: new Date() })
      .where(and(eq(contentIdeas.id, ideaId), isNull(contentIdeas.forwardedAt)))
      .returning({ id: contentIdeas.id });
    if (updated.length > 0) {
      await addAcceptedConcept(idea.clientId, idea.titel).catch(() => undefined);
      await auditLog({ viewer, action: "content_research.idea_doorgestuurd", entityType: "content_idea", entityId: ideaId, clientId: idea.clientId });
    }
    revalidatePath(`/ai/content-research/${idea.clientId}`);
    revalidatePath("/ai/content-research");
    return { ok: true, url, alreadyForwarded: updated.length === 0 };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/**
 * Vanuit de Scriptgenerator: koppel het opgeslagen script (bibliotheek en/of
 * Drive-PDF) aan het idee. Zo is de keten idee → script → publicatie → resultaat
 * te volgen. Overschrijft een bestaande koppeling niet met leeg.
 */
export async function linkIdeaScript(input: { ideaId: string; scriptId?: string | null; driveLink?: string | null }): Promise<ActionResult> {
  try {
    const { idea } = await loadIdeaScoped(requirePermission("scripts:write"), input.ideaId);
    if (!idea) return { ok: false, message: "Idee niet gevonden." };
    const patch: Partial<typeof contentIdeas.$inferInsert> = { updatedAt: new Date() };
    if (input.scriptId && !idea.forwardedScriptId) patch.forwardedScriptId = input.scriptId;
    if (input.driveLink && /^https:\/\//.test(input.driveLink)) patch.scriptLink = input.driveLink;
    if (!idea.forwardedAt) {
      patch.forwardedAt = new Date();
      patch.status = "doorgestuurd";
    }
    await db.update(contentIdeas).set(patch).where(eq(contentIdeas.id, input.ideaId));
    revalidatePath(`/ai/content-research/${idea.clientId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/**
 * Eigen richting voor het middenstuk ("laat vooral de prijzen zien", "met Bas in
 * beeld"). Wordt bewaard op het idee en gaat mee naar de Script Engine en de kopie.
 */
export async function saveMiddenstukRichting(ideaId: string, text: string): Promise<ActionResult> {
  try {
    const { idea } = await loadIdeaScoped(requirePermission("content_research:write"), ideaId);
    if (!idea) return { ok: false, message: "Idee niet gevonden." };
    const value = (text ?? "").trim().slice(0, 1000) || null;
    await db.update(contentIdeas).set({ middenstukRichting: value, updatedAt: new Date() }).where(eq(contentIdeas.id, ideaId));
    revalidatePath(`/ai/content-research/${idea.clientId}`);
    revalidatePath("/ai/content-research");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/* ---------------- Concurrenten per klant ---------------- */

function cleanHandle(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  return s ? s.slice(0, 160) : null;
}

export async function addCompetitor(input: { clientId: string; naam: string; url?: string; tiktok?: string; instagram?: string; youtube?: string; notitie?: string }): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("content_research:write");
    assertClientAccess(viewer, input.clientId);
    const naam = (input.naam ?? "").trim().slice(0, 160);
    if (!naam) return { ok: false, message: "Geef de concurrent een naam." };
    const url = (input.url ?? "").trim();
    const [dupe] = await db
      .select({ id: contentCompetitors.id, actief: contentCompetitors.actief })
      .from(contentCompetitors)
      .where(and(eq(contentCompetitors.clientId, input.clientId), isNull(contentCompetitors.deletedAt), sql`lower(${contentCompetitors.naam}) = ${naam.toLowerCase()}`))
      .limit(1);
    if (dupe) {
      if (!dupe.actief) await db.update(contentCompetitors).set({ actief: true, updatedAt: new Date() }).where(eq(contentCompetitors.id, dupe.id));
      revalidatePath(`/ai/content-research/${input.clientId}`);
      return { ok: true, message: dupe.actief ? "Deze concurrent stond er al." : "Weer meegenomen in het onderzoek." };
    }
    await db.insert(contentCompetitors).values({
      clientId: input.clientId,
      naam,
      url: /^https?:\/\//.test(url) ? url : url ? `https://${url}` : null,
      tiktok: cleanHandle(input.tiktok),
      instagram: cleanHandle(input.instagram),
      youtube: cleanHandle(input.youtube),
      notitie: (input.notitie ?? "").trim().slice(0, 500) || null,
      bron: "team",
      actief: true,
      createdById: viewer.id,
    });
    await auditLog({ viewer, action: "content_research.competitor_added", entityType: "client", entityId: input.clientId, clientId: input.clientId, changes: { naam } });
    revalidatePath(`/ai/content-research/${input.clientId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/**
 * Aan/uit voor het onderzoek. "Uit" is ook hoe je een AI-voorstel verwijdert: zo
 * onthoudt het systeem dat het team deze concurrent niet wil en stelt het hem
 * niet opnieuw voor.
 */
export async function setCompetitorActive(id: string, actief: boolean): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("content_research:write");
    const [c] = await db.select({ clientId: contentCompetitors.clientId }).from(contentCompetitors).where(eq(contentCompetitors.id, id)).limit(1);
    if (!c) return { ok: false, message: "Concurrent niet gevonden." };
    assertClientAccess(viewer, c.clientId);
    await db.update(contentCompetitors).set({ actief, updatedAt: new Date() }).where(eq(contentCompetitors.id, id));
    revalidatePath(`/ai/content-research/${c.clientId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Handmatig bewerken van het Content DNA. */
export async function updateDna(input: { clientId: string; profile: ContentDna; manualNotes?: string }): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("content_research:write");
    assertClientAccess(viewer, input.clientId);
    const { manualNotes: existingNotes } = await loadDna(input.clientId);
    await saveDna({
      clientId: input.clientId,
      dna: normalizeDna(input.profile),
      manualNotes: input.manualNotes !== undefined ? input.manualNotes.slice(0, 4000) : existingNotes,
      updatedById: viewer.id,
    });
    await auditLog({ viewer, action: "content_research.dna_updated", entityType: "content_research_profile", entityId: input.clientId, clientId: input.clientId });
    revalidatePath(`/ai/content-research/${input.clientId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/* ---------------- Spar met AI (klantspecifieke chat) ---------------- */

type ChatResult = { ok: true; reply: string; conversationId: string; title: string } | { ok: false; message: string };

export async function contentChat(input: { clientId: string; conversationId?: string; messages: ChatMessage[] }): Promise<ChatResult> {
  try {
    const viewer = await requirePermission("content_research:write");
    assertClientAccess(viewer, input.clientId);
    if (!aiConfigured()) return { ok: false, message: "De AI-chat staat uit (ANTHROPIC_API_KEY ontbreekt)." };

    const messages = (input.messages ?? [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))
      .slice(-MAX_MESSAGES);
    if (messages.length === 0 || messages[messages.length - 1]!.role !== "user") return { ok: false, message: "Stuur een bericht." };

    const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, input.clientId)).limit(1);
    const clientName = client?.name ?? "deze klant";

    let convId = input.conversationId ?? null;
    let title = "Nieuw gesprek";
    if (convId) {
      const [c] = await db
        .select({ id: contentChatConversations.id, clientId: contentChatConversations.clientId, title: contentChatConversations.title })
        .from(contentChatConversations)
        .where(and(eq(contentChatConversations.id, convId), isNull(contentChatConversations.deletedAt)))
        .limit(1);
      if (!c || c.clientId !== input.clientId) return { ok: false, message: "Gesprek niet gevonden." };
      title = c.title;
    }

    const context = await buildContentContext(viewer, input.clientId, clientName);
    const res = await runChat({
      system: `${CHAT_SYSTEM}\n\n==================\nKLANTCONTEXT\n==================\n${context}`,
      messages,
      maxTokens: 4000,
      cacheSystem: true,
    });
    if (!res.ok) return { ok: false, message: "Geen antwoord gekregen. Probeer het nog eens." };

    const lastUser = messages[messages.length - 1]!.content;
    if (!convId) {
      title = lastUser.replace(/\s+/g, " ").trim().slice(0, 80) || "Nieuw gesprek";
      const [created] = await db
        .insert(contentChatConversations)
        .values({ clientId: input.clientId, title, lastMessageAt: new Date(), createdById: viewer.id })
        .returning({ id: contentChatConversations.id });
      convId = created!.id;
    } else {
      await db.update(contentChatConversations).set({ lastMessageAt: new Date(), updatedAt: new Date() }).where(eq(contentChatConversations.id, convId));
    }
    await db.insert(contentChatMessages).values([
      { conversationId: convId, role: "user", content: lastUser },
      { conversationId: convId, role: "assistant", content: res.text },
    ]);

    revalidatePath(`/ai/content-research/${input.clientId}`);
    return { ok: true, reply: res.text, conversationId: convId, title };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function getContentConversation(clientId: string, id: string): Promise<{ ok: true; title: string; messages: ChatMessage[] } | { ok: false; message: string }> {
  const viewer = await requirePermission("content_research:read");
  assertClientAccess(viewer, clientId);
  const [c] = await db
    .select({ id: contentChatConversations.id, clientId: contentChatConversations.clientId, title: contentChatConversations.title })
    .from(contentChatConversations)
    .where(and(eq(contentChatConversations.id, id), isNull(contentChatConversations.deletedAt)))
    .limit(1);
  if (!c || c.clientId !== clientId) return { ok: false, message: "Gesprek niet gevonden." };
  const msgs = await db
    .select({ role: contentChatMessages.role, content: contentChatMessages.content })
    .from(contentChatMessages)
    .where(eq(contentChatMessages.conversationId, id))
    .orderBy(asc(contentChatMessages.createdAt));
  return { ok: true, title: c.title, messages: msgs.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })) };
}

export async function deleteContentConversation(clientId: string, id: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("content_research:write");
    assertClientAccess(viewer, clientId);
    await db.update(contentChatConversations).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(contentChatConversations.id, id), eq(contentChatConversations.clientId, clientId)));
    revalidatePath(`/ai/content-research/${clientId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Sla een idee op dat uit een gesprek komt. */
export async function saveIdeaFromChat(input: { clientId: string; titel: string; concept?: string; hooks?: string[] }): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("content_research:write");
    assertClientAccess(viewer, input.clientId);
    const titel = (input.titel ?? "").trim().slice(0, 240);
    if (!titel) return { ok: false, message: "Geef het idee een titel." };
    const concept = (input.concept ?? "").trim();
    const hooks = Array.isArray(input.hooks) ? input.hooks.map((h) => String(h).trim()).filter(Boolean).slice(0, 5) : [];
    await db.insert(contentIdeas).values({
      clientId: input.clientId,
      titel,
      concept,
      hooks: hooks as unknown as Record<string, unknown>,
      status: "opgeslagen",
      dedupeHash: dedupeHash(titel, concept),
      createdById: viewer.id,
    });
    await auditLog({ viewer, action: "content_research.idea_from_chat", entityType: "content_idea", entityId: input.clientId, clientId: input.clientId });
    revalidatePath(`/ai/content-research/${input.clientId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Teamcorrecties op het stijlprofiel ("dit past wel/niet bij de klant"). */
export async function saveStyleCorrections(clientId: string, notes: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("content_research:write");
    assertClientAccess(viewer, clientId);
    await saveStyleNotes(clientId, notes.trim().slice(0, 4000), viewer.id);
    await auditLog({ viewer, action: "content_research.style_notes", entityType: "client", entityId: clientId, clientId });
    revalidatePath(`/ai/content-research/${clientId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Stijlprofiel nu opnieuw opbouwen uit de scripts in Drive (draait na de response). */
export async function refreshStyleProfile(clientId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("content_research:write");
    assertClientAccess(viewer, clientId);
    if (!aiConfigured()) return { ok: false, message: "Er is nog geen AI-sleutel ingesteld (ANTHROPIC_API_KEY)." };
    const [c] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!c) return { ok: false, message: "Klant niet gevonden." };
    after(async () => {
      try {
        await ensureStyleProfile(clientId, c.name, { force: true });
        revalidatePath(`/ai/content-research/${clientId}`);
      } catch {
        /* volgende onderzoeksronde probeert het opnieuw */
      }
    });
    return { ok: true, message: "Het stijlprofiel wordt opnieuw opgebouwd uit de scripts (±1 minuut)." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
