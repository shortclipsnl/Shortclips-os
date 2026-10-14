"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients } from "@/db/schema";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { getClientReport } from "@/server/client-report";

export type ActionResult = { ok: boolean; message?: string };

function wrap(fn: () => Promise<ActionResult>) {
  return fn().catch((e) => {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message } as ActionResult;
    throw e;
  });
}

function currentPeriod(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7); // YYYY-MM
}
function periodTitle(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const name = new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  return `Maandrapport ${name}`;
}

/**
 * Automatisch een maandrapport (concept) samenstellen uit de echte cijfers.
 * Idempotent per klant+maand: bestaat er al een rapport, dan verversen we de
 * cijfers/samenvatting maar laten we de publicatiestatus en handmatige notitie
 * staan. Publiceren doet de coördinator los (CC keurt goed → portaal).
 */
export async function generateMonthlyReport(slug: string, period = currentPeriod()): Promise<ActionResult> {
  return wrap(async () => {
    const viewer = await requirePermission("reports:write");
    const report = await getClientReport(slug, 30);
    assertClientAccess(viewer, report.client.id);

    const summary = report.observations.length ? report.observations.join(" ") : "Nog onvoldoende data voor een onderbouwde samenvatting.";
    const values = {
      clientId: report.client.id,
      periodType: "month" as const,
      period,
      title: periodTitle(period),
      summary,
      metrics: report.totals,
      generatedById: viewer.id,
      updatedAt: new Date(),
    };

    const [existing] = await db
      .select({ id: clientReports.id })
      .from(clientReports)
      .where(and(eq(clientReports.clientId, report.client.id), eq(clientReports.period, period)))
      .limit(1);

    if (existing) {
      // Publicatiestatus + handmatige notitie niet overschrijven.
      await db.update(clientReports).set({ title: values.title, summary, metrics: values.metrics, generatedById: viewer.id, updatedAt: new Date() }).where(eq(clientReports.id, existing.id));
    } else {
      await db.insert(clientReports).values(values);
    }

    revalidatePath(`/clients/${slug}`);
    return { ok: true };
  });
}

async function setPublished(reportId: string, published: boolean, slug?: string): Promise<ActionResult> {
  return wrap(async () => {
    const viewer = await requirePermission("reports:write");
    const [report] = await db
      .select({ clientId: clientReports.clientId, slug: clients.slug })
      .from(clientReports)
      .innerJoin(clients, eq(clients.id, clientReports.clientId))
      .where(eq(clientReports.id, reportId))
      .limit(1);
    if (!report) return { ok: false, message: "Rapport niet gevonden." };
    assertClientAccess(viewer, report.clientId);

    await db
      .update(clientReports)
      .set({ isPublished: published, publishedAt: published ? new Date() : null, updatedAt: new Date() })
      .where(eq(clientReports.id, reportId));

    revalidatePath(`/clients/${slug ?? report.slug}`);
    return { ok: true };
  });
}

/** Rapport goedkeuren en publiceren naar het klantportaal. */
export async function publishReport(reportId: string): Promise<ActionResult> {
  return setPublished(reportId, true);
}

/** Publicatie terugtrekken (weer concept, verdwijnt uit het portaal). */
export async function unpublishReport(reportId: string): Promise<ActionResult> {
  return setPublished(reportId, false);
}
