import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, qcChecks } from "@/db/schema";
import { assertClientAccess, type Viewer } from "@/server/auth/context";

/**
 * Vaste kwaliteitscontrole-punten voor een short, af te vinken vóór de video
 * naar de klant gaat. Zo is QC niet langer "nergens vastgelegd".
 */
export const QC_TEMPLATE = [
  "Juiste beeldverhouding (9:16) en resolutie",
  "Sterke hook in de eerste 3 seconden",
  "Audio schoon: geen ruis, goed niveau",
  "Ondertiteling correct en goed leesbaar",
  "Merk/huisstijl (kleuren, logo) kloppen",
  "Lengte past bij het platform",
  "Caption en CTA aanwezig",
  "Geen storende cuts of typefouten in beeld",
] as const;

export type QcItem = { id: string; label: string; done: boolean; doneAt: string | null; sortOrder: number };

/** Zorgt dat de QC-punten bestaan voor deze video en geeft ze (met voortgang) terug. */
export async function getQcChecklist(
  viewer: Viewer,
  deliverableId: string,
): Promise<{ items: QcItem[]; doneCount: number; total: number; complete: boolean }> {
  const [d] = await db
    .select({ id: deliverables.id, clientId: deliverables.clientId })
    .from(deliverables)
    .where(eq(deliverables.id, deliverableId))
    .limit(1);
  if (d) assertClientAccess(viewer, d.clientId);

  let rows = await db
    .select({ id: qcChecks.id, label: qcChecks.label, done: qcChecks.done, doneAt: qcChecks.doneAt, sortOrder: qcChecks.sortOrder })
    .from(qcChecks)
    .where(eq(qcChecks.deliverableId, deliverableId))
    .orderBy(asc(qcChecks.sortOrder));

  // Lui aanmaken: eerste keer dat de checklist wordt bekeken.
  if (rows.length === 0 && d) {
    await db
      .insert(qcChecks)
      .values(QC_TEMPLATE.map((label, i) => ({ deliverableId, label, sortOrder: i })))
      .onConflictDoNothing();
    rows = await db
      .select({ id: qcChecks.id, label: qcChecks.label, done: qcChecks.done, doneAt: qcChecks.doneAt, sortOrder: qcChecks.sortOrder })
      .from(qcChecks)
      .where(eq(qcChecks.deliverableId, deliverableId))
      .orderBy(asc(qcChecks.sortOrder));
  }

  const items: QcItem[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    done: r.done,
    doneAt: r.doneAt ? r.doneAt.toISOString() : null,
    sortOrder: r.sortOrder,
  }));
  const doneCount = items.filter((i) => i.done).length;
  return { items, doneCount, total: items.length, complete: items.length > 0 && doneCount === items.length };
}

/** Compacte QC-voortgang voor lijsten (zonder de template aan te maken). */
export async function qcProgress(deliverableId: string): Promise<{ done: number; total: number } | null> {
  const rows = await db.select({ done: qcChecks.done }).from(qcChecks).where(eq(qcChecks.deliverableId, deliverableId));
  if (rows.length === 0) return null;
  return { done: rows.filter((r) => r.done).length, total: rows.length };
}

/** Alleen voor de actie: één check zetten binnen de eigen klanttoegang. */
export async function assertQcAccess(viewer: Viewer, qcId: string): Promise<boolean> {
  const [row] = await db
    .select({ clientId: deliverables.clientId })
    .from(qcChecks)
    .innerJoin(deliverables, eq(deliverables.id, qcChecks.deliverableId))
    .where(eq(qcChecks.id, qcId))
    .limit(1);
  if (!row) return false;
  assertClientAccess(viewer, row.clientId);
  return true;
}
