"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientKnowledge, clients } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";

export type SaveKnowledgeResult = { ok: true; id: string } | { ok: false; message: string };

/**
 * Legt een gecontroleerde, geleerde klantvoorkeur vast in client_knowledge.
 * Dit is de "leer"-functie: nieuwe inzichten uit AI-werk en feedback worden —
 * ná bevestiging door een medewerker — opgeslagen en voeden toekomstige AI.
 * Nooit automatisch: altijd een bewuste actie.
 */
export async function saveClientKnowledge(input: {
  clientId: string;
  category: string;
  title: string;
  body: string;
  tags?: string[];
  source?: "manual" | "ai_suggested";
}): Promise<SaveKnowledgeResult> {
  try {
    const viewer = await requirePermission("ai:read");
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title || !body) return { ok: false, message: "Geef een korte titel en de voorkeur zelf op." };

    const [client] = await db
      .select({ id: clients.id, slug: clients.slug })
      .from(clients)
      .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)))
      .limit(1);
    if (!client) return { ok: false, message: "Klant niet gevonden." };
    assertClientAccess(viewer, client.id);

    const category = input.category.trim().slice(0, 64) || "fact";
    const [created] = await db
      .insert(clientKnowledge)
      .values({
        clientId: client.id,
        category,
        title: title.slice(0, 200),
        body,
        tags: input.tags ?? [],
        source: input.source ?? "manual",
        createdById: viewer.id,
      })
      .returning({ id: clientKnowledge.id });

    await auditLog({ viewer, action: "client.knowledge_saved", entityType: "client", entityId: client.id, clientId: client.id, changes: { category, title } });
    revalidatePath(`/clients/${client.slug}`);
    return { ok: true, id: created!.id };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
