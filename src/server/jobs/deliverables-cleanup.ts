import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, mondayMappings, qcChecks } from "@/db/schema";
import { QC_TEMPLATE } from "@/server/qc";
import { snapToWorkingDay } from "@/lib/workdays";
import { monday } from "@/server/integrations/monday";

/* Hetzelfde EDITING DASHBOARD-bord als de import (voor de updated_at-datum). */
const EDITING_BOARD = "5060995925";

/** Statussen waarbij de video de interne controle voorbij is (bij de klant of
 *  verder) — QC is dan in de praktijk gehaald. */
const QC_DONE_STATUSES = new Set([
  "client_review",
  "client_revision",
  "approved",
  "ready_to_publish",
  "scheduled",
  "published",
]);

/**
 * Eenmalige opschoning van de uit Monday geïmporteerde video's, zodat ze goed
 * leesbaar en kloppend zijn (bevindingen uit het portaalonderzoek):
 *  1. Titels: video's die alleen de klantnaam als titel hebben krijgen een
 *     onderscheidbare titel "<klant> #n".
 *  2. Deadlines: opleverdatums die op een weekend vallen schuiven naar de
 *     voorgaande vrijdag (een deadline hoort niet op een niet-werkdag).
 *  3. QC: video's die al bij de klant (of verder) staan krijgen de 8 QC-punten
 *     afgevinkt (die controle is dan feitelijk gehaald), i.p.v. "0 van 8".
 *  4. Tijd in fase: statusChangedAt wordt gezet op de echte laatste-wijziging-
 *     datum uit Monday (updated_at), zodat "dagen in fase" klopt i.p.v. 0.
 * Idempotent: een tweede run verandert niets meer.
 */
export async function cleanupDeliverables(): Promise<{
  ok: boolean;
  titlesFixed: number;
  weekendDeadlinesFixed: number;
  qcSeeded: number;
  phaseDatesFixed: number;
}> {
  const rows = await db
    .select({
      id: deliverables.id,
      clientId: deliverables.clientId,
      title: deliverables.title,
      dueOn: deliverables.dueOn,
      status: deliverables.status,
      clientName: clients.name,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .where(isNull(deliverables.deletedAt))
    .orderBy(deliverables.clientId, deliverables.createdAt);

  let titlesFixed = 0;
  let weekendDeadlinesFixed = 0;
  let qcSeeded = 0;

  const renameSeq = new Map<string, number>();

  for (const r of rows) {
    // 1) Titel onderscheidbaar maken waar hij gelijk is aan de klantnaam.
    const bareTitle = r.title.trim();
    if (bareTitle === r.clientName.trim() || bareTitle === "" || bareTitle === "Editing-project") {
      const n = (renameSeq.get(r.clientId) ?? 0) + 1;
      renameSeq.set(r.clientId, n);
      await db.update(deliverables).set({ title: `${r.clientName} #${n}`, updatedAt: new Date() }).where(eq(deliverables.id, r.id));
      titlesFixed++;
    }

    // 2) Weekend-deadline naar de voorgaande werkdag.
    if (r.dueOn) {
      const snapped = snapToWorkingDay(r.dueOn);
      if (snapped !== r.dueOn) {
        await db.update(deliverables).set({ dueOn: snapped, updatedAt: new Date() }).where(eq(deliverables.id, r.id));
        weekendDeadlinesFixed++;
      }
    }

    // 3) QC afvinken voor video's die al bij de klant of verder zijn.
    if (QC_DONE_STATUSES.has(r.status)) {
      const existing = await db.select({ id: qcChecks.id }).from(qcChecks).where(eq(qcChecks.deliverableId, r.id)).limit(1);
      if (existing.length === 0) {
        await db
          .insert(qcChecks)
          .values(QC_TEMPLATE.map((label, i) => ({ deliverableId: r.id, label, sortOrder: i, done: true, doneAt: new Date() })))
          .onConflictDoNothing();
        qcSeeded++;
      }
    }
  }

  // 4) "Dagen in fase" herstellen uit Monday's echte updated_at. Alleen als
  //    Monday bereikbaar is; anders overslaan (gaat vanzelf goed vanaf nu).
  let phaseDatesFixed = 0;
  try {
    const items = await monday.listItems(EDITING_BOARD, 300);
    const updatedById = new Map(items.map((i) => [i.id, i.updated_at]));
    const maps = await db
      .select({ entityId: mondayMappings.entityId, itemId: mondayMappings.itemId })
      .from(mondayMappings)
      .where(eq(mondayMappings.entityType, "editing_item"));
    for (const m of maps) {
      const u = m.itemId ? updatedById.get(m.itemId) : undefined;
      if (u && m.entityId) {
        const when = new Date(u);
        if (!Number.isNaN(when.getTime())) {
          await db.update(deliverables).set({ statusChangedAt: when }).where(eq(deliverables.id, m.entityId));
          phaseDatesFixed++;
        }
      }
    }
  } catch {
    /* Monday niet beschikbaar — sla het statusdatum-herstel over. */
  }

  return { ok: true, titlesFixed, weekendDeadlinesFixed, qcSeeded, phaseDatesFixed };
}
