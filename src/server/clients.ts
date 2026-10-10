import "server-only";
import { notFound } from "next/navigation";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  activityEvents,
  aiInsights,
  clientContacts,
  clientKnowledge,
  clientPackages,
  clientReports,
  clients,
  contentCalendar,
  contracts,
  deliverables,
  files,
  invoices,
  productionDays,
  scripts,
  socialAccounts,
  tasks,
  users,
  clientIntegrations,
} from "@/db/schema";
import { assertClientAccess, scopeToClients, type Viewer } from "@/server/auth/context";

/** Overzichtslijst met de cijfers die je in één oogopslag wilt zien. */
export async function listClients(viewer: Viewer) {
  const rows = await db
    .select({
      id: clients.id,
      slug: clients.slug,
      name: clients.name,
      sector: clients.sector,
      color: clients.color,
      logoUrl: clients.logoUrl,
      status: clients.status,
      riskLevel: clients.riskLevel,
      riskReason: clients.riskReason,
      monthlyRevenue: clients.monthlyRevenue,
      monthlyVideoQuota: clients.monthlyVideoQuota,
      startedOn: clients.startedOn,
      lastActivityAt: clients.lastActivityAt,
      coordinatorName: users.fullName,
      publishedThisMonth: sql<number>`(
        select count(*) from deliverables d
        where d.client_id = clients.id and d.deleted_at is null
          and d.published_at >= date_trunc('month', now())
      )`,
      inProduction: sql<number>`(
        select count(*) from deliverables d
        where d.client_id = clients.id and d.deleted_at is null
          and d.status not in ('published','analysis_available')
      )`,
      awaitingClient: sql<number>`(
        select count(*) from deliverables d
        where d.client_id = clients.id and d.deleted_at is null
          and d.status in ('client_review','client_revision')
      )`,
      nextShoot: sql<string | null>`(
        select min(pd.scheduled_on) from production_days pd
        where pd.client_id = clients.id and pd.deleted_at is null
          and pd.status <> 'cancelled' and pd.scheduled_on >= current_date
      )`,
      openTasks: sql<number>`(
        select count(*) from tasks t
        where t.client_id = clients.id and t.deleted_at is null
          and t.status in ('todo','in_progress','blocked')
      )`,
    })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(isNull(clients.deletedAt), scopeToClients(viewer, clients.id)))
    .orderBy(asc(clients.name));

  return rows;
}

/** Alles wat de klantpagina nodig heeft, in één keer opgehaald. */
export async function getClientHub(viewer: Viewer, slug: string) {
  const [client] = await db
    .select({
      id: clients.id,
      slug: clients.slug,
      name: clients.name,
      legalName: clients.legalName,
      sector: clients.sector,
      website: clients.website,
      logoUrl: clients.logoUrl,
      color: clients.color,
      status: clients.status,
      riskLevel: clients.riskLevel,
      riskReason: clients.riskReason,
      startedOn: clients.startedOn,
      monthlyVideoQuota: clients.monthlyVideoQuota,
      monthlyRevenue: clients.monthlyRevenue,
      editCostPerVideo: clients.editCostPerVideo,
      contractMonths: clients.contractMonths,
      endedOn: clients.endedOn,
      extraRevenue: clients.extraRevenue,
      netMonthlyMonday: clients.netMonthlyMonday,
      lastContactAt: clients.lastContactAt,
      lastActivityAt: clients.lastActivityAt,
      notes: clients.notes,
      coordinatorId: clients.coordinatorId,
      coordinatorName: users.fullName,
      videographerId: clients.videographerId,
    })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
    .limit(1);

  if (!client) notFound();
  // Harde grens: een gebruiker mag nooit een klant openen buiten zijn toegang,
  // ook niet door de slug in de URL te veranderen.
  assertClientAccess(viewer, client.id);

  const canSeeFinance = viewer.permissions.has("finance:read");

  const [
    contacts,
    packages,
    contract,
    videographer,
    videos,
    scriptRows,
    shoots,
    calendar,
    knowledge,
    fileRows,
    taskRows,
    reports,
    insights,
    timeline,
    socials,
    integrations,
    invoiceRows,
    metrics,
  ] = await Promise.all([
    db.select().from(clientContacts)
      .where(and(eq(clientContacts.clientId, client.id), isNull(clientContacts.deletedAt)))
      .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.fullName)),

    db.select().from(clientPackages)
      .where(and(eq(clientPackages.clientId, client.id), eq(clientPackages.isActive, true))),

    db.select().from(contracts)
      .where(and(eq(contracts.clientId, client.id), isNull(contracts.deletedAt)))
      .orderBy(desc(contracts.startsOn)).limit(1),

    client.videographerId
      ? db.select({ id: users.id, fullName: users.fullName }).from(users)
          .where(eq(users.id, client.videographerId)).limit(1)
      : Promise.resolve([]),

    db.select({
      id: deliverables.id, title: deliverables.title, status: deliverables.status,
      statusChangedAt: deliverables.statusChangedAt, dueOn: deliverables.dueOn,
      publishedAt: deliverables.publishedAt, editorName: users.fullName,
      currentVersion: deliverables.currentVersion,
      clientRevisionRounds: deliverables.clientRevisionRounds,
    })
      .from(deliverables)
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(eq(deliverables.clientId, client.id), isNull(deliverables.deletedAt)))
      .orderBy(desc(deliverables.statusChangedAt)).limit(60),

    db.select({
      id: scripts.id, title: scripts.title, status: scripts.status,
      pillar: scripts.pillar, updatedAt: scripts.updatedAt,
      shootOn: productionDays.scheduledOn,
    })
      .from(scripts)
      .leftJoin(productionDays, eq(productionDays.id, scripts.productionDayId))
      .where(and(eq(scripts.clientId, client.id), isNull(scripts.deletedAt)))
      .orderBy(desc(scripts.updatedAt)).limit(40),

    db.select({
      id: productionDays.id, title: productionDays.title,
      scheduledOn: productionDays.scheduledOn, status: productionDays.status,
      locationName: productionDays.locationName,
      scriptCount: sql<number>`(select count(*) from scripts sc where sc.production_day_id = production_days.id and sc.deleted_at is null)`,
    })
      .from(productionDays)
      .where(and(eq(productionDays.clientId, client.id), isNull(productionDays.deletedAt)))
      .orderBy(desc(productionDays.scheduledOn)).limit(20),

    db.select({
      id: contentCalendar.id, title: contentCalendar.title,
      scheduledOn: contentCalendar.scheduledOn, status: contentCalendar.status,
      platforms: contentCalendar.platforms,
    })
      .from(contentCalendar)
      .where(and(eq(contentCalendar.clientId, client.id), isNull(contentCalendar.deletedAt)))
      .orderBy(desc(contentCalendar.scheduledOn)).limit(30),

    db.select().from(clientKnowledge)
      .where(and(eq(clientKnowledge.clientId, client.id), isNull(clientKnowledge.deletedAt)))
      .orderBy(desc(clientKnowledge.isPinned), asc(clientKnowledge.category)),

    db.select({
      id: files.id, name: files.name, category: files.category,
      isFolder: files.isFolder, externalUrl: files.externalUrl,
      modifiedAt: files.modifiedAt, sizeBytes: files.sizeBytes, source: files.source,
    })
      .from(files)
      .where(and(eq(files.clientId, client.id), isNull(files.deletedAt)))
      .orderBy(desc(files.isFolder), desc(files.modifiedAt)).limit(80),

    db.select({
      id: tasks.id, title: tasks.title, status: tasks.status,
      priority: tasks.priority, dueOn: tasks.dueOn, assigneeName: users.fullName,
    })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(eq(tasks.clientId, client.id), isNull(tasks.deletedAt), inArray(tasks.status, ["todo", "in_progress", "blocked"])))
      .orderBy(asc(tasks.dueOn)).limit(20),

    db.select().from(clientReports)
      .where(and(eq(clientReports.clientId, client.id), isNull(clientReports.deletedAt)))
      .orderBy(desc(clientReports.period)).limit(12),

    db.select().from(aiInsights)
      .where(and(eq(aiInsights.clientId, client.id), isNull(aiInsights.deletedAt), isNull(aiInsights.dismissedAt)))
      .orderBy(desc(aiInsights.generatedAt)).limit(12),

    db.select({
      id: activityEvents.id, type: activityEvents.type, title: activityEvents.title,
      body: activityEvents.body, occurredAt: activityEvents.occurredAt,
      actorName: activityEvents.actorName, isClientVisible: activityEvents.isClientVisible,
    })
      .from(activityEvents)
      .where(eq(activityEvents.clientId, client.id))
      .orderBy(desc(activityEvents.occurredAt)).limit(60),

    db.select().from(socialAccounts)
      .where(and(eq(socialAccounts.clientId, client.id), eq(socialAccounts.isActive, true))),

    db.select().from(clientIntegrations)
      .where(eq(clientIntegrations.clientId, client.id)),

    canSeeFinance
      ? db.select({
          id: invoices.id, number: invoices.number, status: invoices.status,
          total: invoices.total, issuedOn: invoices.issuedOn, dueOn: invoices.dueOn,
          period: invoices.period, amountPaid: invoices.amountPaid,
        })
          .from(invoices)
          .where(and(eq(invoices.clientId, client.id), isNull(invoices.deletedAt)))
          .orderBy(desc(invoices.issuedOn)).limit(12)
      : Promise.resolve([]),

    // Resultaten van de afgelopen 30 dagen
    db.execute(sql`
      select
        coalesce(sum(dm.views), 0)::int  as views,
        coalesce(sum(dm.reach), 0)::int  as reach,
        coalesce(sum(dm.engagements), 0)::int as engagements,
        coalesce(sum(dm.follower_delta), 0)::int as follower_growth
      from daily_metrics dm
      where dm.client_id = ${client.id}
        and dm.measured_on >= current_date - interval '30 days'
    `),
  ]);

  const metricRow = ((metrics as unknown as { rows?: Array<Record<string, number>> }).rows ??
    (metrics as unknown as Array<Record<string, number>>))[0] ?? {
    views: 0, reach: 0, engagements: 0, follower_growth: 0,
  };

  return {
    client,
    contacts,
    package: packages[0] ?? null,
    contract: contract[0] ?? null,
    videographer: videographer[0] ?? null,
    videos,
    scripts: scriptRows,
    shoots,
    calendar,
    knowledge,
    files: fileRows,
    tasks: taskRows,
    reports,
    insights,
    timeline,
    socials,
    integrations,
    invoices: invoiceRows,
    metrics: {
      views: Number(metricRow.views ?? 0),
      reach: Number(metricRow.reach ?? 0),
      engagements: Number(metricRow.engagements ?? 0),
      followerGrowth: Number(metricRow.follower_growth ?? 0),
    },
    canSeeFinance,
  };
}

export type ClientHub = Awaited<ReturnType<typeof getClientHub>>;

/** Compacte lijst voor de Klantenbeheer-console: status, verantwoordelijke,
 *  shorts/maand en of er een (echte) portaallogin is. */
export async function listClientsAdmin(viewer: Viewer) {
  return db
    .select({
      id: clients.id,
      slug: clients.slug,
      name: clients.name,
      color: clients.color,
      status: clients.status,
      monthlyVideoQuota: clients.monthlyVideoQuota,
      coordinatorName: users.fullName,
      portalEmail: sql<string | null>`(
        select u.email from users u
        where u.client_id = clients.id and u.primary_role = 'client'
          and u.status = 'active' and u.deleted_at is null
        order by u.created_at asc limit 1
      )`,
    })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(isNull(clients.deletedAt), scopeToClients(viewer, clients.id)))
    .orderBy(asc(clients.name));
}

/** Interne teamleden die als coördinator of videograaf toewijsbaar zijn. */
export async function listAssignableUsers() {
  return db
    .select({ id: users.id, fullName: users.fullName, primaryRole: users.primaryRole })
    .from(users)
    .where(and(ne(users.primaryRole, "client"), eq(users.status, "active"), isNull(users.deletedAt)))
    .orderBy(asc(users.fullName));
}

/** De bewerkbare velden van één klant + primaire contactpersoon, voor Klantenbeheer. */
export async function getClientForEdit(viewer: Viewer, slug: string) {
  const [client] = await db
    .select({
      id: clients.id,
      slug: clients.slug,
      name: clients.name,
      legalName: clients.legalName,
      sector: clients.sector,
      website: clients.website,
      logoUrl: clients.logoUrl,
      color: clients.color,
      status: clients.status,
      coordinatorId: clients.coordinatorId,
      videographerId: clients.videographerId,
      monthlyVideoQuota: clients.monthlyVideoQuota,
      monthlyRevenue: clients.monthlyRevenue,
      startedOn: clients.startedOn,
      notes: clients.notes,
      managedFields: clients.managedFields,
    })
    .from(clients)
    .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) notFound();
  assertClientAccess(viewer, client.id);

  const [contact] = await db
    .select({
      id: clientContacts.id,
      fullName: clientContacts.fullName,
      email: clientContacts.email,
      phone: clientContacts.phone,
    })
    .from(clientContacts)
    .where(and(eq(clientContacts.clientId, client.id), isNull(clientContacts.deletedAt)))
    .orderBy(desc(clientContacts.isPrimary))
    .limit(1);

  const integrations = await db
    .select({
      id: clientIntegrations.id,
      provider: clientIntegrations.provider,
      externalName: clientIntegrations.externalName,
      externalUrl: clientIntegrations.externalUrl,
      isActive: clientIntegrations.isActive,
    })
    .from(clientIntegrations)
    .where(eq(clientIntegrations.clientId, client.id))
    .orderBy(asc(clientIntegrations.provider));

  return { client, contact: contact ?? null, integrations };
}
