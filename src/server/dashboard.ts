import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  sql,
} from "drizzle-orm";
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
import { scopeToClients, type Viewer } from "@/server/auth/context";
import { currentPeriod } from "@/lib/format";
import {
  type VideoStage,
} from "@/lib/statuses";

/**
 * Alle cijfers voor het hoofddashboard.
 *
 * Uitgangspunt: het dashboard moet actiegericht zijn. Elk blok beantwoordt een
 * concrete vraag ("wat ligt stil?", "wie moet wat doen?") en verwijst door naar
 * de plek waar je het oplost.
 */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const ACTIVE_STAGES: VideoStage[] = [
  "recorded",
  "footage_upload",
  "awaiting_editor",
  "editing",
  "internal_review",
  "editor_revision",
  "client_review",
  "client_revision",
  "approved",
  "ready_to_publish",
];

/**
 * Statussen die "klaar" betekenen (editing afgerond). Een video met zo'n status
 * is nooit "over de deadline", ook niet als de einddatum in het verleden ligt.
 * Dezelfde definitie als DONE_STATUSES in editing.ts (de autoritatieve bron),
 * zodat Vandaag en de Editing-pagina altijd overeenkomen.
 */
const DONE_STAGES = new Set<string>(["approved", "ready_to_publish", "scheduled", "published", "analysis_available"]);

/** Statussen die écht nog onderhanden zijn — gebruikt voor "over de deadline". */
const LATE_STAGES: VideoStage[] = ACTIVE_STAGES.filter((s) => !DONE_STAGES.has(s));

export type PipelineBucket = {
  status: string;
  total: number;
  overdue: number;
};

export async function getDashboard(viewer: Viewer) {
  const clientScope = scopeToClients(viewer, clients.id);
  const deliverableScope = scopeToClients(viewer, deliverables.clientId);
  const scriptScope = scopeToClients(viewer, scripts.clientId);
  const dayScope = scopeToClients(viewer, productionDays.clientId);
  const taskScope = scopeToClients(viewer, tasks.clientId);
  const period = currentPeriod();

  const [
    clientRows,
    pipelineRows,
    lateVideos,
    stalledAtClient,
    scriptsAwaiting,
    upcomingShoots,
    clientsWithoutShoot,
    publishThisWeek,
    openTasks,
    editorLoad,
    financeRows,
    expiringContracts,
    quotaRows,
  ] = await Promise.all([
    // Klanten met risico, laatste activiteit en omzet
    db
      .select({
        id: clients.id,
        slug: clients.slug,
        name: clients.name,
        color: clients.color,
        status: clients.status,
        riskLevel: clients.riskLevel,
        riskReason: clients.riskReason,
        monthlyRevenue: clients.monthlyRevenue,
        monthlyVideoQuota: clients.monthlyVideoQuota,
        lastActivityAt: clients.lastActivityAt,
        lastContactAt: clients.lastContactAt,
        coordinatorName: users.fullName,
      })
      .from(clients)
      .leftJoin(users, eq(users.id, clients.coordinatorId))
      .where(and(isNull(clients.deletedAt), ne(clients.status, "churned"), clientScope)),

    // Pipeline: aantal per status
    db
      .select({
        status: deliverables.status,
        total: count(),
        oldest: sql<string>`min(deliverables.status_changed_at)`,
      })
      .from(deliverables)
      .where(and(isNull(deliverables.deletedAt), deliverableScope))
      .groupBy(deliverables.status),

    // Video's over de deadline heen
    db
      .select({
        id: deliverables.id,
        title: deliverables.title,
        status: deliverables.status,
        dueOn: deliverables.dueOn,
        statusChangedAt: deliverables.statusChangedAt,
        clientName: clients.name,
        clientSlug: clients.slug,
        clientColor: clients.color,
        editorName: users.fullName,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(
        and(
          isNull(deliverables.deletedAt),
          inArray(deliverables.status, LATE_STAGES),
          lt(deliverables.dueOn, today()),
          deliverableScope,
        ),
      )
      .orderBy(asc(deliverables.dueOn))
      .limit(12),

    // Wacht al lang op de klant
    db
      .select({
        id: deliverables.id,
        title: deliverables.title,
        statusChangedAt: deliverables.statusChangedAt,
        clientName: clients.name,
        clientSlug: clients.slug,
        clientColor: clients.color,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(
        and(
          isNull(deliverables.deletedAt),
          inArray(deliverables.status, ["client_review", "client_revision"]),
          deliverableScope,
        ),
      )
      .orderBy(asc(deliverables.statusChangedAt))
      .limit(10),

    // Scripts die nog goedgekeurd moeten worden
    db
      .select({
        id: scripts.id,
        title: scripts.title,
        status: scripts.status,
        clientName: clients.name,
        clientSlug: clients.slug,
        productionDayId: scripts.productionDayId,
        shootOn: productionDays.scheduledOn,
      })
      .from(scripts)
      .innerJoin(clients, eq(clients.id, scripts.clientId))
      .leftJoin(productionDays, eq(productionDays.id, scripts.productionDayId))
      .where(
        and(
          isNull(scripts.deletedAt),
          inArray(scripts.status, ["internal_review", "client_review", "revising"]),
          scriptScope,
        ),
      )
      .orderBy(asc(productionDays.scheduledOn))
      .limit(12),

    // Aankomende opnamedagen
    db
      .select({
        id: productionDays.id,
        title: productionDays.title,
        scheduledOn: productionDays.scheduledOn,
        startTime: productionDays.startTime,
        locationName: productionDays.locationName,
        status: productionDays.status,
        clientName: clients.name,
        clientSlug: clients.slug,
        clientColor: clients.color,
        clientLogo: clients.logoUrl,
        videographerName: users.fullName,
        openBlockers: sql<number>`(
          select count(*) from production_checklist_items ci
          where ci.production_day_id = production_days.id
            and ci.is_blocking = true and ci.is_done = false
        )`,
        unapprovedScripts: sql<number>`(
          select count(*) from scripts sc
          where sc.production_day_id = production_days.id
            and sc.status not in ('approved','ready_to_shoot','shot')
            and sc.deleted_at is null
        )`,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .leftJoin(users, eq(users.id, productionDays.videographerId))
      .where(
        and(
          isNull(productionDays.deletedAt),
          gte(productionDays.scheduledOn, today()),
          ne(productionDays.status, "cancelled"),
          dayScope,
        ),
      )
      .orderBy(asc(productionDays.scheduledOn))
      .limit(8),

    // Klanten zonder geplande opname
    db
      .select({
        id: clients.id,
        slug: clients.slug,
        name: clients.name,
        color: clients.color,
        lastShoot: sql<string | null>`(
          select max(pd.scheduled_on) from production_days pd
          where pd.client_id = clients.id and pd.deleted_at is null
        )`,
      })
      .from(clients)
      .where(
        and(
          isNull(clients.deletedAt),
          eq(clients.status, "active"),
          sql`not exists (
            select 1 from production_days pd
            where pd.client_id = clients.id
              and pd.deleted_at is null
              and pd.status <> 'cancelled'
              and pd.scheduled_on >= ${today()}
          )`,
          clientScope,
        ),
      ),

    // Publicaties deze week
    db
      .select({
        id: contentCalendar.id,
        title: contentCalendar.title,
        scheduledOn: contentCalendar.scheduledOn,
        status: contentCalendar.status,
        platforms: contentCalendar.platforms,
        clientName: clients.name,
        clientSlug: clients.slug,
        clientColor: clients.color,
      })
      .from(contentCalendar)
      .innerJoin(clients, eq(clients.id, contentCalendar.clientId))
      .where(
        and(
          isNull(contentCalendar.deletedAt),
          gte(contentCalendar.scheduledOn, today()),
          lte(contentCalendar.scheduledOn, dateIn(7)),
          scopeToClients(viewer, contentCalendar.clientId),
        ),
      )
      .orderBy(asc(contentCalendar.scheduledOn))
      .limit(20),

    // Openstaande taken per persoon
    db
      .select({
        assigneeId: tasks.assigneeId,
        assigneeName: users.fullName,
        total: count(),
        overdue: sql<number>`count(*) filter (where tasks.due_on < ${today()})`,
        urgent: sql<number>`count(*) filter (where tasks.priority in ('urgent','high'))`,
      })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(
        and(
          isNull(tasks.deletedAt),
          inArray(tasks.status, ["todo", "in_progress", "blocked"]),
          taskScope,
        ),
      )
      .groupBy(tasks.assigneeId, users.fullName)
      .orderBy(desc(count())),

    // Editorbelasting
    db
      .select({
        editorId: users.id,
        editorName: users.fullName,
        open: count(),
        overdue: sql<number>`count(*) filter (where deliverables.due_on < ${today()})`,
        dueSoon: sql<number>`count(*) filter (where deliverables.due_on >= ${today()} and deliverables.due_on <= ${dateIn(3)})`,
        nextDue: sql<string | null>`min(deliverables.due_on) filter (where deliverables.due_on >= ${today()})`,
      })
      .from(deliverables)
      .innerJoin(users, eq(users.id, deliverables.editorId))
      .where(
        and(
          isNull(deliverables.deletedAt),
          inArray(deliverables.status, ["editing", "editor_revision", "awaiting_editor"]),
          deliverableScope,
        ),
      )
      .groupBy(users.id, users.fullName)
      .orderBy(desc(count())),

    // Finance — alleen voor wie dat mag zien
    viewer.permissions.has("finance:read")
      ? db
          .select({
            status: invoices.status,
            total: sql<string>`coalesce(sum(${invoices.total}), 0)`,
            aantal: count(),
          })
          .from(invoices)
          .where(and(isNull(invoices.deletedAt), scopeToClients(viewer, invoices.clientId)))
          .groupBy(invoices.status)
      : Promise.resolve([]),

    // Contracten die binnenkort aflopen
    db
      .select({
        id: contracts.id,
        endsOn: contracts.endsOn,
        noticePeriodDays: contracts.noticePeriodDays,
        autoRenew: contracts.autoRenew,
        monthlyValue: contracts.monthlyValue,
        clientName: clients.name,
        clientSlug: clients.slug,
        clientColor: clients.color,
      })
      .from(contracts)
      .innerJoin(clients, eq(clients.id, contracts.clientId))
      .where(
        and(
          isNull(contracts.deletedAt),
          eq(contracts.status, "active"),
          lte(contracts.endsOn, dateIn(90)),
          scopeToClients(viewer, contracts.clientId),
        ),
      )
      .orderBy(asc(contracts.endsOn))
      .limit(8),

    // Geproduceerd deze maand per klant, tegen de afspraak
    db
      .select({
        clientId: deliverables.clientId,
        clientName: clients.name,
        clientSlug: clients.slug,
        quota: clients.monthlyVideoQuota,
        published: sql<number>`count(*) filter (where deliverables.status = 'published')`,
        inProgress: sql<number>`count(*) filter (where deliverables.status <> 'published')`,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(
        and(
          isNull(deliverables.deletedAt),
          gte(deliverables.createdAt, sql`date_trunc('month', now())`),
          deliverableScope,
        ),
      )
      .groupBy(deliverables.clientId, clients.name, clients.slug, clients.monthlyVideoQuota),
  ]);

  /* ---- Afgeleide cijfers ---- */

  const activeClients = clientRows.filter((c) => c.status === "active");
  const mrr = activeClients.reduce((sum, c) => sum + Number(c.monthlyRevenue), 0);
  const atRisk = clientRows.filter((c) => c.riskLevel === "high" || c.riskLevel === "medium");

  const pipeline: PipelineBucket[] = pipelineRows.map((row) => ({
    status: row.status,
    total: Number(row.total),
    overdue: 0,
  }));

  // Hoe lang staat de oudste video per status stil?
  const stageAges = new Map<string, number>();
  for (const row of pipelineRows) {
    if (!row.oldest) continue;
    const days = Math.floor((Date.now() - new Date(row.oldest).getTime()) / 86400000);
    stageAges.set(row.status, days);
  }

  const openVideos = pipeline
    .filter((p) => ACTIVE_STAGES.includes(p.status as VideoStage))
    .reduce((s, p) => s + p.total, 0);

  const awaitingEditor =
    pipeline.find((p) => p.status === "awaiting_editor")?.total ?? 0;
  const inInternalReview =
    pipeline.find((p) => p.status === "internal_review")?.total ?? 0;
  const atClient =
    (pipeline.find((p) => p.status === "client_review")?.total ?? 0) +
    (pipeline.find((p) => p.status === "client_revision")?.total ?? 0);

  const finance = {
    outstanding: financeRows
      .filter((r) => ["sent", "overdue", "partially_paid"].includes(r.status))
      .reduce((s, r) => s + Number(r.total), 0),
    overdue: financeRows
      .filter((r) => r.status === "overdue")
      .reduce((s, r) => s + Number(r.total), 0),
    overdueCount: financeRows
      .filter((r) => r.status === "overdue")
      .reduce((s, r) => s + Number(r.aantal), 0),
    paidThisPeriod: financeRows
      .filter((r) => r.status === "paid")
      .reduce((s, r) => s + Number(r.total), 0),
  };

  // Prognose: wat is er deze maand al gefactureerd plus wat nog komt.
  const forecast = mrr;

  const quotaGap = quotaRows
    .map((q) => ({
      ...q,
      published: Number(q.published),
      inProgress: Number(q.inProgress),
      gap: q.quota - Number(q.published) - Number(q.inProgress),
    }))
    .filter((q) => q.gap > 0)
    .sort((a, b) => b.gap - a.gap);

  const silentClients = [...clientRows]
    .filter((c) => c.lastActivityAt)
    .sort(
      (a, b) =>
        new Date(a.lastActivityAt!).getTime() - new Date(b.lastActivityAt!).getTime(),
    )
    .slice(0, 5);

  return {
    period,
    clients: {
      total: clientRows.length,
      active: activeClients.length,
      atRisk,
      silent: silentClients,
      withoutShoot: clientsWithoutShoot,
      quotaGap,
    },
    revenue: { mrr, forecast, ...finance },
    pipeline,
    stageAges,
    videos: {
      open: openVideos,
      awaitingEditor,
      inInternalReview,
      atClient,
      late: lateVideos,
      stalledAtClient,
    },
    scripts: scriptsAwaiting,
    shoots: upcomingShoots,
    publishThisWeek,
    tasks: openTasks.filter((t) => t.assigneeId),
    editors: editorLoad,
    contracts: expiringContracts,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;

/** De zes compacte kerncijfers bovenaan het dashboard. */
export async function getDashboardTopStats(viewer: Viewer) {
  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const today = day(0);
  const active = ["recorded", "footage_upload", "awaiting_editor", "editing", "internal_review", "editor_revision", "client_review", "client_revision", "approved", "ready_to_publish", "scheduled"] as const;
  // Voor deadline-tellingen tellen afgeronde statussen niet mee (gelijk aan de lijst hierboven).
  const openForDeadline = active.filter((s) => !DONE_STAGES.has(s));

  const [clientsRow, shootsRow, editingRow, dueSoonRow, overRow, tasksRow] = await Promise.all([
    db.select({ n: count() }).from(clients).where(and(isNull(clients.deletedAt), eq(clients.status, "active"), scopeToClients(viewer, clients.id))),
    db.select({ n: count() }).from(productionDays).where(and(isNull(productionDays.deletedAt), gte(productionDays.scheduledOn, today), lte(productionDays.scheduledOn, day(7)), ne(productionDays.status, "cancelled"), scopeToClients(viewer, productionDays.clientId))),
    db.select({ n: count() }).from(deliverables).where(and(isNull(deliverables.deletedAt), eq(deliverables.status, "editing"), scopeToClients(viewer, deliverables.clientId))),
    db.select({ n: count() }).from(deliverables).where(and(isNull(deliverables.deletedAt), gte(deliverables.dueOn, today), lte(deliverables.dueOn, day(5)), inArray(deliverables.status, openForDeadline), scopeToClients(viewer, deliverables.clientId))),
    db.select({ n: count() }).from(deliverables).where(and(isNull(deliverables.deletedAt), lt(deliverables.dueOn, today), inArray(deliverables.status, openForDeadline), scopeToClients(viewer, deliverables.clientId))),
    db.select({ n: count() }).from(tasks).where(and(isNull(tasks.deletedAt), inArray(tasks.status, ["todo", "in_progress", "blocked"]), scopeToClients(viewer, tasks.clientId))),
  ]);

  return {
    activeClients: Number(clientsRow[0]?.n ?? 0),
    opnamesThisWeek: Number(shootsRow[0]?.n ?? 0),
    inEditing: Number(editingRow[0]?.n ?? 0),
    dueSoon: Number(dueSoonRow[0]?.n ?? 0),
    overDeadline: Number(overRow[0]?.n ?? 0),
    openTasks: Number(tasksRow[0]?.n ?? 0),
  };
}
