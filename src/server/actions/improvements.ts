"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientImprovements, clients, users } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { notify } from "@/server/notifications";
import { aiConfigured, runJsonPrompt } from "@/server/ai/client";
import { getClientReport } from "@/server/client-report";
import { currentPeriod, normalizeImprovement, type ImprovementContent } from "@/server/improvements";

export type ActionResult = { ok: boolean; message?: string; reason?: "no_provider" };

async function slugOf(clientId: string): Promise<{ slug: string; name: string } | null> {
  const [c] = await db.select({ slug: clients.slug, name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
  return c ?? null;
}

/** Concept-verbeterplan opslaan (handmatig bewerken), per klant + huidige maand. */
async function upsertConcept(clientId: string, content: ImprovementContent, userId: string) {
  const period = currentPeriod();
  await db
    .insert(clientImprovements)
    .values({ clientId, period, content, status: "concept", createdById: userId })
    .onConflictDoUpdate({ target: [clientImprovements.clientId, clientImprovements.period], set: { content, updatedAt: new Date() } });
}

/** AI: genereert een concept-verbeterplan op basis van de resultaten van de klant. */
export async function generateImprovementPlan(clientId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai:read");
    assertClientAccess(viewer, clientId);
    if (!aiConfigured()) return { ok: false, reason: "no_provider", message: "Er is nog geen AI-sleutel ingesteld." };
    const c = await slugOf(clientId);
    if (!c) return { ok: false, message: "Klant niet gevonden." };

    const report = await getClientReport(c.slug, 90, true);
    const sys = `Je bent een senior contentstrateeg bij Shortclips, een Nederlands short-videobureau. Je schrijft een kort, concreet verbeterplan voor een klant op basis van echte cijfers. Begrijpelijke taal, geen marketingjargon, geen verzonnen cijfers. Elke lijst 2 à 4 korte punten.`;
    const user = `Resultaten van klant "${c.name}" (laatste 90 dagen):
${JSON.stringify({ totals: report.totals, perPlatform: report.perPlatform, observations: report.observations, months: report.months }).slice(0, 6000)}

Geef UITSLUITEND geldige JSON terug in exact dit formaat:
{
  "watWerkt": ["wat werkte goed..."],
  "watMinder": ["wat presteerde minder..."],
  "volgendeWeek": ["wat we komende week anders doen..."],
  "volgendeMaand": ["wat we komende maand testen/verbeteren..."],
  "formats": ["welke formats we vaker inzetten..."],
  "optimalisaties": ["concrete optimalisaties..."]
}`;
    const res = await runJsonPrompt<ImprovementContent>({ system: sys, user, maxTokens: 2000 });
    if (!res.ok) return res.reason === "no_provider" ? { ok: false, reason: "no_provider", message: "Geen AI-sleutel." } : { ok: false, message: res.error ?? "Genereren mislukt." };

    await upsertConcept(clientId, normalizeImprovement(res.data), viewer.id);
    await auditLog({ viewer, action: "improvement.generated", entityType: "client", entityId: clientId, clientId });
    revalidatePath(`/analytics/${c.slug}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Handmatig bewerken/opslaan van het concept-verbeterplan. */
export async function saveImprovementPlan(clientId: string, content: ImprovementContent): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai:read");
    assertClientAccess(viewer, clientId);
    await upsertConcept(clientId, normalizeImprovement(content), viewer.id);
    const c = await slugOf(clientId);
    if (c) revalidatePath(`/analytics/${c.slug}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Goedkeuren en delen met de klant: zichtbaar op de resultatenpagina. */
export async function approveImprovementPlan(clientId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai:read");
    assertClientAccess(viewer, clientId);
    const period = currentPeriod();
    const updated = await db
      .update(clientImprovements)
      .set({ status: "approved", approvedAt: new Date(), approvedById: viewer.id, updatedAt: new Date() })
      .where(and(eq(clientImprovements.clientId, clientId), eq(clientImprovements.period, period)))
      .returning({ id: clientImprovements.id });
    if (updated.length === 0) return { ok: false, message: "Er is nog geen verbeterplan om te delen. Stel er eerst één op." };

    await auditLog({ viewer, action: "improvement.approved", entityType: "client", entityId: clientId, clientId });
    await recordActivity({ clientId, type: "improvement.shared", title: "Nieuw verbeterplan gedeeld", isClientVisible: true });
    // Portaalgebruikers van deze klant een melding geven.
    const portalUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.clientId, clientId), eq(users.primaryRole, "client"), eq(users.status, "active"), isNull(users.deletedAt)));
    if (portalUsers.length > 0) {
      await notify({
        userIds: portalUsers.map((u) => u.id),
        clientId,
        level: "info",
        type: "improvement_shared",
        title: "We hebben je resultaten geanalyseerd",
        body: "Bekijk wat goed werkte en wat we voor je gaan verbeteren.",
        href: "/portal/resultaten",
        entityType: "client",
        entityId: clientId,
        dedupeKey: `improvement_shared:${clientId}:${period}`,
      }).catch(() => undefined);
    }
    const c = await slugOf(clientId);
    if (c) revalidatePath(`/analytics/${c.slug}`);
    revalidatePath("/portal/resultaten");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
