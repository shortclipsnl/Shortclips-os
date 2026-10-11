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
  scripts,
  tasks,
  users,
} from "@/db/schema";
import { dispatch } from "@/server/automation";
import { notify } from "@/server/notifications";
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

    // 2b. Scripts die te lang op klantcontrole wachten (>3 dagen)
    const staleScripts = await db
      .select({
        id: scripts.id,
        clientId: scripts.clientId,
        title: scripts.title,
        coordinatorId: clients.coordinatorId,
      })
      .from(scripts)
      .innerJoin(clients, eq(clients.id, scripts.clientId))
      .where(
        and(
          isNull(scripts.deletedAt),
          eq(scripts.status, "client_review"),
          lt(scripts.updatedAt, sql`now() - interval '3 days'`),
        ),
      );

    for (const script of staleScripts) {
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.daily",
        clientId: script.clientId,
        entityType: "script",
        entityId: script.id,
        data: {
          awaitingClientScriptDays: 3,
          title: `Script wacht op klant: ${script.title}`,
          coordinatorId: script.coordinatorId,
          href: `/scripts/${script.id}`,
        },
      });
    }
    ctx.log(`${staleScripts.length} scripts wachten te lang op de klant`);

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

/**
 * Dagelijkse deadline-herinnering per editor: één melding met het aantal video's
 * dat te laat is of waarvan de deadline binnen 2 dagen valt. In-app, dus geen
 * externe sleutel nodig. Dedupe per dag, zodat niemand dubbele meldingen krijgt.
 */
export async function runEditorDeadlineReminders() {
  return runJob("monday", "reminders.editor_deadlines", {}, async (ctx) => {
    const today = day(0);
    const soon = day(2);
    const editorStages = ["editing", "editor_revision", "awaiting_editor", "internal_review"] as const;

    const rows = await db
      .select({
        editorId: deliverables.editorId,
        editorName: users.fullName,
        overdue: sql<number>`count(*) filter (where ${deliverables.dueOn} < ${today})`,
        dueSoon: sql<number>`count(*) filter (where ${deliverables.dueOn} >= ${today} and ${deliverables.dueOn} <= ${soon})`,
      })
      .from(deliverables)
      .innerJoin(users, eq(users.id, deliverables.editorId))
      .where(
        and(
          isNull(deliverables.deletedAt),
          inArray(deliverables.status, [...editorStages]),
          lte(deliverables.dueOn, soon),
        ),
      )
      .groupBy(deliverables.editorId, users.fullName);

    for (const r of rows) {
      const overdue = Number(r.overdue);
      const dueSoon = Number(r.dueSoon);
      if (overdue + dueSoon === 0 || !r.editorId) continue;
      ctx.counters.processed++;
      const parts: string[] = [];
      if (overdue > 0) parts.push(`${overdue} te laat`);
      if (dueSoon > 0) parts.push(`${dueSoon} met deadline binnen 2 dagen`);
      await notify({
        userIds: [r.editorId],
        type: "editor_deadlines",
        level: overdue > 0 ? "warning" : "info",
        title: overdue > 0 ? "Je hebt video's over de deadline" : "Deadlines komen eraan",
        body: `${parts.join(" · ")}. Pak deze met voorrang op.`,
        href: "/videos?filter=mijn-werk",
        dedupeKey: `editor_deadlines:${r.editorId}:${today}`,
      });
      ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} editors een deadline-herinnering gestuurd`);
  });
}

/**
 * Dagelijkse taak-herinnering per teamlid: één melding met het aantal taken dat
 * te laat is of met een deadline binnen 2 dagen. In-app, dedupe per dag.
 */
export async function runTaskDeadlineReminders() {
  return runJob("monday", "reminders.task_deadlines", {}, async (ctx) => {
    const today = day(0);
    const soon = day(2);
    const rows = await db
      .select({
        assigneeId: tasks.assigneeId,
        overdue: sql<number>`count(*) filter (where ${tasks.dueOn} < ${today})`,
        dueSoon: sql<number>`count(*) filter (where ${tasks.dueOn} >= ${today} and ${tasks.dueOn} <= ${soon})`,
      })
      .from(tasks)
      .where(
        and(
          isNull(tasks.deletedAt),
          inArray(tasks.status, ["todo", "in_progress", "blocked"]),
          lte(tasks.dueOn, soon),
        ),
      )
      .groupBy(tasks.assigneeId);

    for (const r of rows) {
      if (!r.assigneeId) continue;
      const overdue = Number(r.overdue);
      const dueSoon = Number(r.dueSoon);
      if (overdue + dueSoon === 0) continue;
      ctx.counters.processed++;
      const parts: string[] = [];
      if (overdue > 0) parts.push(`${overdue} te laat`);
      if (dueSoon > 0) parts.push(`${dueSoon} binnen 2 dagen`);
      await notify({
        userIds: [r.assigneeId],
        type: "task_deadlines",
        level: overdue > 0 ? "warning" : "info",
        title: overdue > 0 ? "Je hebt taken over de deadline" : "Taken met een deadline",
        body: `${parts.join(" · ")}.`,
        href: "/tasks",
        dedupeKey: `task_deadlines:${r.assigneeId}:${today}`,
      });
      ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} teamleden een taak-herinnering gestuurd`);
  });
}
