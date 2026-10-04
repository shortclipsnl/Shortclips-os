import "server-only";
import { and, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  contentCalendar,
  contracts,
  deliverables,
  invoices,
  productionDays,
} from "@/db/schema";
import { dispatch } from "@/server/automation";
import { runJob } from "./runner";

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

/**
 * De dagelijkse en uurlijkse signaleringen. Deze taken zoeken situaties op die
 * aandacht vragen en laten de automation engine de bijbehorende acties doen.
 * Zo staan de regels op één plek in plaats van verspreid door de code.
 */
export async function runDailySignals() {
  return runJob("monday", "signals.daily", {}, async (ctx) => {
    // 1. Contracten die binnen 60 dagen aflopen
    const expiring = await db
      .select({
        id: contracts.id,
        clientId: contracts.clientId,
        endsOn: contracts.endsOn,
        clientName: clients.name,
        coordinatorId: clients.coordinatorId,
        slug: clients.slug,
      })
      .from(contracts)
      .innerJoin(clients, eq(clients.id, contracts.clientId))
      .where(
        and(
          eq(contracts.status, "active"),
          isNull(contracts.deletedAt),
          lte(contracts.endsOn, day(60)),
          gte(contracts.endsOn, day(0)),
        ),
      );

    for (const contract of expiring) {
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.daily",
        clientId: contract.clientId,
        entityType: "contract",
        entityId: contract.id,
        data: {
          contractEndsInDays: 60,
          title: `Contract ${contract.clientName} loopt af op ${contract.endsOn}`,
          coordinatorId: contract.coordinatorId,
          href: `/clients/${contract.slug}?tab=contract`,
        },
      });
    }
    ctx.log(`${expiring.length} aflopende contracten gesignaleerd`);

    // 2. Video's die te lang op klantfeedback wachten
    const stale = await db
      .select({
        id: deliverables.id,
        clientId: deliverables.clientId,
        title: deliverables.title,
        coordinatorId: clients.coordinatorId,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(
        and(
          isNull(deliverables.deletedAt),
          inArray(deliverables.status, ["client_review", "client_revision"]),
          lt(deliverables.statusChangedAt, sql`now() - interval '5 days'`),
        ),
      );

    for (const video of stale) {
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.daily",
        clientId: video.clientId,
        entityType: "deliverable",
        entityId: video.id,
        data: {
          awaitingClientDays: 5,
          title: video.title,
          coordinatorId: video.coordinatorId,
          href: `/videos/${video.id}`,
        },
      });
    }
    ctx.log(`${stale.length} video's wachten te lang op de klant`);

    // 3. Vervallen facturen
    const overdue = await db
      .select({ id: invoices.id, clientId: invoices.clientId, number: invoices.number })
      .from(invoices)
      .where(
        and(
          isNull(invoices.deletedAt),
          inArray(invoices.status, ["sent", "partially_paid"]),
          lt(invoices.dueOn, day(0)),
        ),
      );

    for (const invoice of overdue) {
      ctx.counters.processed++;
      await db.update(invoices).set({ status: "overdue" }).where(eq(invoices.id, invoice.id));
      await dispatch({
        trigger: "schedule.daily",
        clientId: invoice.clientId,
        entityType: "invoice",
        entityId: invoice.id,
        data: { invoiceOverdue: true, title: `Factuur ${invoice.number} is vervallen` },
      });
    }
    ctx.log(`${overdue.length} vervallen facturen`);

    // 4. Publicaties die morgen live moeten maar nog niet klaar zijn
    const tomorrow = await db
      .select({
        id: contentCalendar.id,
        clientId: contentCalendar.clientId,
        title: contentCalendar.title,
        status: contentCalendar.status,
      })
      .from(contentCalendar)
      .where(
        and(
          isNull(contentCalendar.deletedAt),
          eq(contentCalendar.scheduledOn, day(1)),
          inArray(contentCalendar.status, ["to_prepare", "ready"]),
        ),
      );

    for (const item of tomorrow) {
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.daily",
        clientId: item.clientId,
        entityType: "calendar_item",
        entityId: item.id,
        data: {
          publishInDays: 1,
          statusNot: ["scheduled", "published"],
          title: `Morgen publiceren: ${item.title}`,
          href: "/calendar",
        },
      });
    }
    ctx.log(`${tomorrow.length} publicaties morgen`);
  });
}

/** Uurlijkse controle op opnames die binnen 48 uur niet rond zijn. */
export async function runHourlySignals() {
  return runJob("monday", "signals.hourly", {}, async (ctx) => {
    const soon = await db
      .select({
        id: productionDays.id,
        clientId: productionDays.clientId,
        title: productionDays.title,
        clientName: clients.name,
        coordinatorId: clients.coordinatorId,
        openBlockers: sql<number>`(
          select count(*) from production_checklist_items ci
          where ci.production_day_id = production_days.id and ci.is_blocking = true and ci.is_done = false
        )`,
        unapproved: sql<number>`(
          select count(*) from scripts sc
          where sc.production_day_id = production_days.id and sc.deleted_at is null
            and sc.status not in ('approved','ready_to_shoot','shot')
        )`,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(
        and(
          isNull(productionDays.deletedAt),
          gte(productionDays.scheduledOn, day(0)),
          lte(productionDays.scheduledOn, day(2)),
          inArray(productionDays.status, ["planned", "confirmed"]),
        ),
      );

    for (const shoot of soon) {
      const blockers = Number(shoot.openBlockers) + Number(shoot.unapproved);
      if (blockers === 0) continue;
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.hourly",
        clientId: shoot.clientId,
        entityType: "production_day",
        entityId: shoot.id,
        data: {
          shootWithinHours: 48,
          scriptsApproved: false,
          title: `Opname ${shoot.clientName} is nog niet rond`,
          coordinatorId: shoot.coordinatorId,
          href: `/productions/${shoot.id}`,
        },
      });
    }
    ctx.log(`${ctx.counters.processed} opnames met openstaande punten`);
  });
}
