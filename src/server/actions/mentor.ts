"use server";

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { mentorConversations, mentorMessages, mentorMemories } from "@/db/schema";
import { requireOwner, ForbiddenError } from "@/server/auth/context";
import { aiConfigured, runChat, type ChatMessage } from "@/server/ai/client";
import { MENTOR_SYSTEM, buildMentorContext } from "@/server/mentor";

type ChatResult = { ok: true; reply: string; conversationId: string; title: string } | { ok: false; message: string };
const MAX_MESSAGES = 30;

/** Eén mentorbeurt. Owner-only; bewaart het gesprek en voegt live bedrijfscontext toe. */
export async function mentorChat(input: { conversationId?: string; messages: ChatMessage[] }): Promise<ChatResult> {
  try {
    const viewer = await requireOwner();
    if (!aiConfigured()) return { ok: false, message: "De AI-mentor staat uit (ANTHROPIC_API_KEY ontbreekt)." };

    const messages = (input.messages ?? [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))
      .slice(-MAX_MESSAGES);
    if (messages.length === 0 || messages[messages.length - 1]!.role !== "user") return { ok: false, message: "Stuur een bericht." };

    let convId = input.conversationId ?? null;
    let title = "Nieuw gesprek";
    if (convId) {
      const [c] = await db.select({ id: mentorConversations.id, userId: mentorConversations.userId, title: mentorConversations.title })
        .from(mentorConversations).where(and(eq(mentorConversations.id, convId), isNull(mentorConversations.deletedAt))).limit(1);
      if (!c || c.userId !== viewer.id) return { ok: false, message: "Gesprek niet gevonden." };
      title = c.title;
    }

    const context = await buildMentorContext(viewer);
    const res = await runChat({
      system: `${MENTOR_SYSTEM}\n\n==================\nLIVE BEDRIJFSCONTEXT (uit het Shortclips-portaal)\n==================\n${context}`,
      messages,
      maxTokens: 4000,
    });
    if (!res.ok) return { ok: false, message: "De mentor gaf geen antwoord. Probeer het nog eens." };

    const lastUser = messages[messages.length - 1]!.content;
    if (!convId) {
      title = lastUser.replace(/\s+/g, " ").trim().slice(0, 80) || "Nieuw gesprek";
      const [created] = await db.insert(mentorConversations).values({ userId: viewer.id, title, lastMessageAt: new Date() }).returning({ id: mentorConversations.id });
      convId = created!.id;
    } else {
      await db.update(mentorConversations).set({ lastMessageAt: new Date(), updatedAt: new Date() }).where(eq(mentorConversations.id, convId));
    }
    await db.insert(mentorMessages).values([
      { conversationId: convId, role: "user", content: lastUser },
      { conversationId: convId, role: "assistant", content: res.text },
    ]);

    return { ok: true, reply: res.text, conversationId: convId, title };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function listMentorConversations() {
  const viewer = await requireOwner();
  return db.select({ id: mentorConversations.id, title: mentorConversations.title, pinnedAt: mentorConversations.pinnedAt, lastMessageAt: mentorConversations.lastMessageAt })
    .from(mentorConversations).where(and(eq(mentorConversations.userId, viewer.id), isNull(mentorConversations.deletedAt)))
    .orderBy(desc(mentorConversations.pinnedAt), desc(mentorConversations.lastMessageAt)).limit(100);
}

export async function getMentorConversation(id: string): Promise<{ ok: true; title: string; messages: ChatMessage[] } | { ok: false; message: string }> {
  const viewer = await requireOwner();
  const [c] = await db.select({ id: mentorConversations.id, userId: mentorConversations.userId, title: mentorConversations.title })
    .from(mentorConversations).where(and(eq(mentorConversations.id, id), isNull(mentorConversations.deletedAt))).limit(1);
  if (!c || c.userId !== viewer.id) return { ok: false, message: "Gesprek niet gevonden." };
  const msgs = await db.select({ role: mentorMessages.role, content: mentorMessages.content })
    .from(mentorMessages).where(eq(mentorMessages.conversationId, id)).orderBy(asc(mentorMessages.createdAt));
  return { ok: true, title: c.title, messages: msgs.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })) };
}

export async function renameMentorConversation(id: string, title: string): Promise<{ ok: true }> {
  const viewer = await requireOwner();
  const t = title.trim().slice(0, 200) || "Nieuw gesprek";
  await db.update(mentorConversations).set({ title: t, updatedAt: new Date() }).where(and(eq(mentorConversations.id, id), eq(mentorConversations.userId, viewer.id)));
  return { ok: true };
}
export async function pinMentorConversation(id: string, pinned: boolean): Promise<{ ok: true }> {
  const viewer = await requireOwner();
  await db.update(mentorConversations).set({ pinnedAt: pinned ? new Date() : null, updatedAt: new Date() }).where(and(eq(mentorConversations.id, id), eq(mentorConversations.userId, viewer.id)));
  return { ok: true };
}
export async function deleteMentorConversation(id: string): Promise<{ ok: true }> {
  const viewer = await requireOwner();
  await db.update(mentorConversations).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(mentorConversations.id, id), eq(mentorConversations.userId, viewer.id)));
  return { ok: true };
}

/* ---------------- Persoonlijk geheugen (Fase 5) ---------------- */

export type MentorMemory = { id: string; kind: string; content: string; status: string | null };
const MEM_KINDS = ["voorkeur", "feit", "beslissing", "actie", "inzicht"];

export async function listMentorMemories(): Promise<MentorMemory[]> {
  const viewer = await requireOwner();
  const rows = await db.select({ id: mentorMemories.id, kind: mentorMemories.kind, content: mentorMemories.content, status: mentorMemories.status })
    .from(mentorMemories).where(and(eq(mentorMemories.userId, viewer.id), isNull(mentorMemories.deletedAt)))
    .orderBy(desc(mentorMemories.createdAt)).limit(200);
  return rows;
}

export async function addMentorMemory(input: { kind: string; content: string }): Promise<{ ok: true; memory: MentorMemory } | { ok: false; message: string }> {
  const viewer = await requireOwner();
  const content = (input.content ?? "").trim().slice(0, 2000);
  if (!content) return { ok: false, message: "Leeg." };
  const kind = MEM_KINDS.includes(input.kind) ? input.kind : "inzicht";
  const status = kind === "actie" || kind === "beslissing" ? "open" : null;
  const [row] = await db.insert(mentorMemories).values({ userId: viewer.id, kind, content, status }).returning({ id: mentorMemories.id });
  return { ok: true, memory: { id: row!.id, kind, content, status } };
}

export async function updateMentorMemory(input: { id: string; content?: string; status?: string | null; kind?: string }): Promise<{ ok: true }> {
  const viewer = await requireOwner();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof input.content === "string") patch.content = input.content.trim().slice(0, 2000);
  if (input.status === null || input.status === "open" || input.status === "afgerond") patch.status = input.status;
  if (input.kind && MEM_KINDS.includes(input.kind)) patch.kind = input.kind;
  await db.update(mentorMemories).set(patch).where(and(eq(mentorMemories.id, input.id), eq(mentorMemories.userId, viewer.id), isNull(mentorMemories.deletedAt)));
  return { ok: true };
}

export async function deleteMentorMemory(id: string): Promise<{ ok: true }> {
  const viewer = await requireOwner();
  await db.update(mentorMemories).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(mentorMemories.id, id), eq(mentorMemories.userId, viewer.id)));
  return { ok: true };
}
