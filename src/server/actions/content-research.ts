"use server";

import { after } from "next/server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentChatConversations, contentChatMessages, contentIdeas } from "@/db/schema";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { aiConfigured, runChat, type ChatMessage } from "@/server/ai/client";
import { SHORTCLIPS_IDENTITY } from "@/server/ai/identity";
import { auditLog } from "@/server/audit";
import { hasActiveRun, runContentResearchJob, startContentResearchRun } from "@/server/content-research/run";
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
    if (await hasActiveRun(clientId)) return { ok: false, message: "Er loopt al een onderzoek voor deze klant." };

    const runId = await startContentResearchRun(clientId, viewer.id);
    // Het zware onderzoek draait na de response (overleeft navigatie); de cron
    // vangt gemiste/mislukte rondes op.
    after(async () => {
      try {
        await runContentResearchJob(runId);
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

/** Markeer het idee als doorgestuurd en geef de prefill-URL naar de scriptgenerator. */
export async function forwardIdeaToGenerator(ideaId: string): Promise<ActionResult & { url?: string }> {
  try {
    const { viewer, idea } = await loadIdeaScoped(requirePermission("content_research:write"), ideaId);
    if (!idea) return { ok: false, message: "Idee niet gevonden." };
    await db.update(contentIdeas).set({ status: "doorgestuurd", updatedAt: new Date() }).where(eq(contentIdeas.id, ideaId));
    await auditLog({ viewer, action: "content_research.idea_doorgestuurd", entityType: "content_idea", entityId: ideaId, clientId: idea.clientId });
    revalidatePath(`/ai/content-research/${idea.clientId}`);
    return { ok: true, url: `/ai/scriptgenerator?client=${idea.clientId}&idea=${idea.id}` };
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
