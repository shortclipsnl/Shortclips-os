import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientKnowledge, aiKnowledge } from "@/db/schema";
import type { ContentType } from "@/server/actions/script-generate";

/**
 * Lerende scriptfeedback, gescheiden per contenttype (advertentie vs organisch).
 *
 * Wanneer een medewerker een script corrigeert, kan die correctie bewust als
 * regel worden onthouden — met een gekozen reikwijdte. Zo wordt een eenmalige
 * instructie nooit automatisch een permanente regel, en lopen advertentie- en
 * organische feedback niet door elkaar. De generator leest deze regels mee bij
 * het schrijven (patronen uit goedgekeurde correcties), maar wijzigt nooit
 * zelfstandig zijn basisinstructies.
 *
 * Opslag (hergebruik van bestaande kennis-tabellen, geen aparte module):
 *  - klantspecifiek  → client_knowledge, categorie "<contenttype>_correctie"
 *  - algemene regel  → ai_knowledge,     categorie "schrijfregel_algemeen"
 *  - contenttype-regel → ai_knowledge,   categorie "schrijfregel_<contenttype>"
 *  - eenmalig/campagne → NIET opgeslagen (alleen die ene aanpassing).
 */

export type FeedbackScope = "klant" | "algemeen" | "contenttype" | "eenmalig";

const clientCat = (ct: ContentType) => `${ct}_correctie`;
const ruleCat = (ct: ContentType) => `schrijfregel_${ct}`;
const ALGEMEEN = "schrijfregel_algemeen";

export type LearnedRule = { id: string; scope: "klant" | "centraal"; category: string; title: string; body: string };

/** Slaat een correctie op als regel (afhankelijk van de reikwijdte). */
export async function saveScriptFeedback(input: {
  clientId?: string | null;
  contentType: ContentType;
  scope: FeedbackScope;
  instruction: string;
  viewerId: string;
}): Promise<{ ok: true; saved: boolean }> {
  const body = (input.instruction ?? "").trim().slice(0, 2000);
  if (!body) return { ok: true, saved: false };
  const title = body.replace(/\s+/g, " ").slice(0, 120);

  if (input.scope === "eenmalig") return { ok: true, saved: false };

  if (input.scope === "klant") {
    if (!input.clientId) return { ok: true, saved: false };
    await db.insert(clientKnowledge).values({
      clientId: input.clientId,
      category: clientCat(input.contentType),
      title,
      body,
      source: "scriptgenerator",
      createdById: input.viewerId,
    });
    return { ok: true, saved: true };
  }

  // Centrale regel (algemeen of contenttype-specifiek).
  const category = input.scope === "algemeen" ? ALGEMEEN : ruleCat(input.contentType);
  await db.insert(aiKnowledge).values({ category, title, body });
  return { ok: true, saved: true };
}

/** Tekstblok met de geleerde regels die bij dit contenttype horen (voor de prompt). */
export async function learnedFeedbackText(clientId: string | null | undefined, contentType: ContentType): Promise<string> {
  const parts: string[] = [];

  // Centrale regels: algemeen + specifiek voor dit contenttype.
  const central = await db
    .select({ category: aiKnowledge.category, title: aiKnowledge.title, body: aiKnowledge.body })
    .from(aiKnowledge)
    .where(and(inArray(aiKnowledge.category, [ALGEMEEN, ruleCat(contentType)]), isNull(aiKnowledge.deletedAt)))
    .orderBy(desc(aiKnowledge.updatedAt))
    .limit(30)
    .catch(() => []);
  if (central.length) {
    parts.push(`Geleerde ${contentType === "advertentie" ? "advertentie" : "organische"}- en algemene schrijfregels (door het team vastgelegd — volg deze):\n${central.map((r) => `- ${r.body}`).join("\n")}`);
  }

  // Klantspecifieke correcties voor dit contenttype.
  if (clientId) {
    const rows = await db
      .select({ title: clientKnowledge.title, body: clientKnowledge.body })
      .from(clientKnowledge)
      .where(and(eq(clientKnowledge.clientId, clientId), eq(clientKnowledge.category, clientCat(contentType)), isNull(clientKnowledge.deletedAt)))
      .orderBy(desc(clientKnowledge.isPinned), desc(clientKnowledge.createdAt))
      .limit(20)
      .catch(() => []);
    if (rows.length) {
      parts.push(`Eerdere ${contentType === "advertentie" ? "advertentie" : "organische"}-correcties van deze klant (verwerk deze standaard):\n${rows.map((r) => `- ${r.body}`).join("\n")}`);
    }
  }

  return parts.join("\n\n");
}

/** Lijst van geleerde regels voor beheer in de UI (klant + centraal, per contenttype). */
export async function listScriptFeedback(clientId: string | null | undefined, contentType: ContentType): Promise<LearnedRule[]> {
  const out: LearnedRule[] = [];
  const central = await db
    .select({ id: aiKnowledge.id, category: aiKnowledge.category, title: aiKnowledge.title, body: aiKnowledge.body })
    .from(aiKnowledge)
    .where(and(inArray(aiKnowledge.category, [ALGEMEEN, ruleCat(contentType)]), isNull(aiKnowledge.deletedAt)))
    .orderBy(desc(aiKnowledge.updatedAt)).limit(30).catch(() => []);
  for (const r of central) out.push({ id: r.id, scope: "centraal", category: r.category, title: r.title, body: r.body });

  if (clientId) {
    const rows = await db
      .select({ id: clientKnowledge.id, category: clientKnowledge.category, title: clientKnowledge.title, body: clientKnowledge.body })
      .from(clientKnowledge)
      .where(and(eq(clientKnowledge.clientId, clientId), eq(clientKnowledge.category, clientCat(contentType)), isNull(clientKnowledge.deletedAt)))
      .orderBy(desc(clientKnowledge.createdAt)).limit(20).catch(() => []);
    for (const r of rows) out.push({ id: r.id, scope: "klant", category: r.category, title: r.title, body: r.body });
  }
  return out;
}

/** Verwijdert een geleerde regel (soft delete). */
export async function deleteScriptFeedback(id: string, scope: "klant" | "centraal"): Promise<void> {
  if (scope === "centraal") await db.update(aiKnowledge).set({ deletedAt: new Date() }).where(eq(aiKnowledge.id, id));
  else await db.update(clientKnowledge).set({ deletedAt: new Date() }).where(eq(clientKnowledge.id, id));
}
