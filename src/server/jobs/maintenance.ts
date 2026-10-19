import "server-only";
import { and, eq, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
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
          // Periode = de einddatum zelf: verlengt het contract (nieuwe einddatum),
          // dan hoort daar een nieuwe sleutel (en taak) bij.
          periodKey: contract.endsOn,
          title: `Contract ${contract.clientName} loopt af op ${contract.endsOn}`,
          coordinatorId: contract.coordinatorId,
          href: `/clients/${contract.slug}?tab=contract`,
        },
      });
    }
    ctx.log(`${expiring.length} aflopende contracten gesignaleerd`);

    // 1b. Contract-aftelling op vaste mijlpalen (45 / 7 / 0 dagen voor einde).
    const tierByDate = new Map<string, number>([
      [day(45), 45],
      [day(28), 28],
      [day(7), 7],
      [day(0), 0],
    ]);
    const tierContracts = await db
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
          inArray(contracts.endsOn, [day(45), day(28), day(7), day(0)]),
        ),
      );

    for (const contract of tierContracts) {
      const tier = tierByDate.get(contract.endsOn ?? "");
      if (tier === undefined) continue;
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.daily",
        clientId: contract.clientId,
        entityType: "contract",
        entityId: contract.id,
        data: {
          contractDaysLeft: tier,
          dedupe: `contract-${tier}`,
          title:
            tier === 0
              ? `Contract ${contract.clientName} verloopt vandaag`
              : `Contract ${contract.clientName} loopt over ${tier} dagen af`,
          coordinatorId: contract.coordinatorId,
          href: `/clients/${contract.slug}?tab=contract`,
        },
      });
    }
    ctx.log(`${tierContracts.length} contracten op een mijlpaal (45/28/7/0 dagen)`);

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

    // 5. Opnames over 7 of 2 dagen zonder videograaf (Monday: "Wie gaat filmen?").
    const shootTier = new Map<string, number>([
      [day(7), 7],
      [day(2), 2],
    ]);
    const shootsNoFilmer = await db
      .select({
        id: productionDays.id,
        clientId: productionDays.clientId,
        scheduledOn: productionDays.scheduledOn,
        title: productionDays.title,
        coordinatorId: productionDays.coordinatorId,
      })
      .from(productionDays)
      .where(
        and(
          isNull(productionDays.deletedAt),
          isNull(productionDays.videographerId),
          inArray(productionDays.scheduledOn, [day(7), day(2)]),
          inArray(productionDays.status, ["planned", "confirmed"]),
        ),
      );

    for (const shoot of shootsNoFilmer) {
      const tier = shootTier.get(shoot.scheduledOn ?? "");
      if (tier === undefined) continue;
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.daily",
        clientId: shoot.clientId,
        entityType: "production_day",
        entityId: shoot.id,
        data: {
          videographerMissing: true,
          shootDaysLeft: tier,
          dedupe: `shoot-nofilmer-${tier}`,
          title: `Opname over ${tier} dagen zonder videograaf: ${shoot.title}`,
          coordinatorId: shoot.coordinatorId,
          href: `/productions/${shoot.id}`,
        },
      });
    }
    ctx.log(`${shootsNoFilmer.length} opnames zonder videograaf (7/2 dagen)`);
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

/** Maandag van de huidige week (voor wekelijkse dedupe). */
function mondayIso(): string {
  const d = new Date();
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d.toISOString().slice(0, 10);
}

/**
 * Signaleert actieve klanten zonder geplande volgende opname (Deel 2.1). Slaat
 * bewust gepauzeerde klanten en klanten met voldoende contentvoorraad over, en
 * stuurt de verantwoordelijke coördinator één melding per week (dedupe).
 */
export async function runClientsWithoutShootSignal() {
  return runJob("monday", "signals.clients_without_shoot", {}, async (ctx) => {
    const week = mondayIso();
    const res = await db.execute(sql`
      select c.id, c.name, c.slug, c.coordinator_id,
        coalesce(c.monthly_video_quota, 0)::int quota,
        (select max(pd.scheduled_on) from production_days pd where pd.client_id = c.id and pd.deleted_at is null) last_shoot,
        (select count(*) from deliverables d where d.client_id = c.id and d.deleted_at is null
           and d.status in ('approved','ready_to_publish','scheduled'))::int voorraad
      from clients c
      where c.deleted_at is null and c.status = 'active'
        and not exists (
          select 1 from production_days pd
          where pd.client_id = c.id and pd.deleted_at is null
            and pd.status <> 'cancelled' and pd.scheduled_on >= current_date
        )`);
    const rows = ((res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<{
      id: string; name: string; slug: string; coordinator_id: string | null; quota: number; last_shoot: string | null; voorraad: number;
    }>;

    // Per coördinator bundelen: één melding met alle klanten zonder opname,
    // i.p.v. een stortvloed van (bijna) identieke losse meldingen.
    const byCoord = new Map<string, string[]>();
    for (const c of rows) {
      ctx.counters.processed++;
      // Voldoende voorraad (minstens één maand publicaties klaar) → geen waarschuwing.
      if (c.voorraad >= Math.max(c.quota, 1)) continue;
      if (!c.coordinator_id) continue; // zonder verantwoordelijke geen gerichte melding
      const list = byCoord.get(c.coordinator_id) ?? [];
      list.push(c.name);
      byCoord.set(c.coordinator_id, list);
    }
    for (const [coordId, names] of byCoord) {
      await notify({
        userIds: [coordId],
        type: "client_without_shoot",
        level: "warning",
        title: names.length === 1 ? `${names[0]} heeft geen volgende opname gepland` : `${names.length} klanten zonder geplande opname`,
        body: names.length === 1 ? "Plan een opnamedag in." : `${names.join(", ")} → plan opnamedagen in.`,
        href: "/productions",
        dedupeKey: `client_without_shoot:${coordId}:${week}`,
      });
      ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} gebundelde meldingen voor klanten zonder opname`);
  });
}

/**
 * Zorgt voor precies één open automatische to-do per dedupe-sleutel (zelfde
 * patroon als de automation engine). Geeft true terug als er een nieuwe taak is
 * aangemaakt. Gebruikt voor de opname-herinneringen hieronder.
 */
async function ensureTask(input: {
  clientId: string | null;
  title: string;
  assigneeId: string | null;
  dueOn: string | null;
  priority?: "normal" | "high" | "urgent";
  entityType: string;
  entityId: string;
  dedupeKey: string;
}): Promise<boolean> {
  const existing = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.dedupeKey, input.dedupeKey), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`))
    .limit(1);
  if (existing[0]) return false;
  const [row] = await db
    .insert(tasks)
    .values({
      clientId: input.clientId,
      title: input.title,
      assigneeId: input.assigneeId,
      dueOn: input.dueOn,
      priority: input.priority ?? "normal",
      status: "todo",
      entityType: input.entityType,
      entityId: input.entityId,
      source: "automation",
      dedupeKey: input.dedupeKey,
    })
    .onConflictDoNothing()
    .returning({ id: tasks.id });
  return Boolean(row);
}

/**
 * Script-herinnering als to-do: zodra een opname binnen 7 dagen valt en de
 * scripting nog niet 'final' is, krijgt de verantwoordelijke coördinator een
 * to-do "script afronden/afstemmen". Eén open taak per opname (dedupe); verdwijnt
 * vanzelf zodra hij afgevinkt wordt.
 */
export async function runScriptTodoReminders() {
  return runJob("monday", "reminders.script_todo", {}, async (ctx) => {
    const today = day(0);
    const in7 = day(7);
    const rows = await db
      .select({
        id: productionDays.id,
        scheduledOn: productionDays.scheduledOn,
        clientId: productionDays.clientId,
        clientName: clients.name,
        coordA: productionDays.coordinatorId,
        coordB: clients.coordinatorId,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(
        and(
          isNull(productionDays.deletedAt),
          ne(productionDays.status, "cancelled"),
          gte(productionDays.scheduledOn, today),
          lte(productionDays.scheduledOn, in7),
          ne(productionDays.scriptingStatus, "final"),
        ),
      );
    for (const r of rows) {
      ctx.counters.processed++;
      const created = await ensureTask({
        clientId: r.clientId,
        title: `Script afronden/afstemmen — ${r.clientName} (opname ${r.scheduledOn})`,
        assigneeId: r.coordA ?? r.coordB ?? null,
        dueOn: today,
        priority: "high",
        entityType: "production_day",
        entityId: r.id,
        dedupeKey: `script_todo:${r.id}`,
      });
      if (created) ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} script-to-do's aangemaakt`);
  });
}

/**
 * Na-opname-herinnering als to-do: voor opnames van de afgelopen 2 dagen krijgt
 * de verantwoordelijke coördinator een to-do "stuur de klant een berichtje over
 * de editing". Eén open taak per opname (dedupe).
 */
export async function runPostShootTodoReminders() {
  return runJob("monday", "reminders.post_shoot_todo", {}, async (ctx) => {
    const today = day(0);
    const from = day(-2);
    const rows = await db
      .select({
        id: productionDays.id,
        scheduledOn: productionDays.scheduledOn,
        clientId: productionDays.clientId,
        clientName: clients.name,
        coordA: productionDays.coordinatorId,
        coordB: clients.coordinatorId,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(
        and(
          isNull(productionDays.deletedAt),
          ne(productionDays.status, "cancelled"),
          gte(productionDays.scheduledOn, from),
          lte(productionDays.scheduledOn, today),
        ),
      );
    for (const r of rows) {
      ctx.counters.processed++;
      const created = await ensureTask({
        clientId: r.clientId,
        title: `Stuur ${r.clientName} een berichtje over de editing (opname ${r.scheduledOn})`,
        assigneeId: r.coordA ?? r.coordB ?? null,
        dueOn: today,
        priority: "normal",
        entityType: "production_day",
        entityId: r.id,
        dedupeKey: `postshoot_msg:${r.id}`,
      });
      if (created) ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} na-opname-to-do's aangemaakt`);
  });
}
