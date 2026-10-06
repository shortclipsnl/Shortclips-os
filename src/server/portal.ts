import "server-only";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  activityEvents,
  clientReports,
  clients,
  contentCalendar,
  deliverables,
  files,
  productionDays,
  reviewComments,
  reviewThreads,
  scripts,
  users,
} from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { nextShootForClient, upcomingAppointmentsForClient } from "@/server/appointments";

/**
 * Alles wat het klantportaal toont — en niets meer.
 *
 * Elke query filtert hard op de klant van de ingelogde gebruiker. Interne
 * statussen, interne opmerkingen, marges, editorgegevens en andere klanten
 * komen hier principieel niet voorbij.
 */

export async function getPortalData(viewer: Viewer) {
  const clientId = viewer.clientId;
  if (!clientId) notFound();

  const [client] = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      color: clients.color,
      logoUrl: clients.logoUrl,
      monthlyVideoQuota: clients.monthlyVideoQuota,
      coordinatorName: users.fullName,
      coordinatorEmail: users.email,
    })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);

  if (!client) notFound();

  const today = new Date().toISOString().slice(0, 10);

  const [
    awaitingApproval,
    scriptsToReview,
    inProgress,
    published,
    upcomingShoot,
    calendar,
    reports,
    documents,
    timeline,
    metrics,
    appointments,
  ] = await Promise.all([
    // Video's die op de klant wachten
    db.select({
      id: deliverables.id,
      title: deliverables.title,
      status: deliverables.status,
      statusChangedAt: deliverables.statusChangedAt,
      frameUrl: deliverables.frameUrl,
      thumbnailUrl: deliverables.thumbnailUrl,
    })
      .from(deliverables)
      .where(
        and(
          eq(deliverables.clientId, clientId),
          isNull(deliverables.deletedAt),
          inArray(deliverables.status, ["client_review", "client_revision"]),
        ),
      )
      .orderBy(asc(deliverables.statusChangedAt)),

    db.select({
      id: scripts.id, title: scripts.title, hook: scripts.hook,
      body: scripts.body, cta: scripts.cta, updatedAt: scripts.updatedAt,
    })
      .from(scripts)
      .where(
        and(
          eq(scripts.clientId, clientId),
          isNull(scripts.deletedAt),
          eq(scripts.status, "client_review"),
        ),
      )
      .orderBy(asc(scripts.updatedAt)),

    db.select({
      id: deliverables.id, title: deliverables.title, status: deliverables.status,
      plannedPublishOn: deliverables.plannedPublishOn,
    })
      .from(deliverables)
      .where(
        and(
          eq(deliverables.clientId, clientId),
          isNull(deliverables.deletedAt),
          inArray(deliverables.status, ["editing", "approved", "ready_to_publish", "scheduled"]),
        ),
      )
      .orderBy(asc(deliverables.plannedPublishOn))
      .limit(20),

    db.select({
      id: deliverables.id, title: deliverables.title,
      publishedAt: deliverables.publishedAt, thumbnailUrl: deliverables.thumbnailUrl,
    })
      .from(deliverables)
      .where(
        and(
          eq(deliverables.clientId, clientId),
          isNull(deliverables.deletedAt),
          eq(deliverables.status, "published"),
        ),
      )
      .orderBy(desc(deliverables.publishedAt))
      .limit(500),

    db.select({
      id: productionDays.id, title: productionDays.title,
      scheduledOn: productionDays.scheduledOn, startTime: productionDays.startTime,
      locationName: productionDays.locationName,
    })
      .from(productionDays)
      .where(
        and(
          eq(productionDays.clientId, clientId),
          isNull(productionDays.deletedAt),
          gte(productionDays.scheduledOn, today),
        ),
      )
      .orderBy(asc(productionDays.scheduledOn))
      .limit(3),

    // Publicatiekalender: alleen datum, titel en platform — geen interne status.
    db.select({
      id: contentCalendar.id, title: contentCalendar.title,
      scheduledOn: contentCalendar.scheduledOn, platforms: contentCalendar.platforms,
      status: contentCalendar.status,
    })
      .from(contentCalendar)
      .where(
        and(
          eq(contentCalendar.clientId, clientId),
          isNull(contentCalendar.deletedAt),
          gte(contentCalendar.scheduledOn, today),
          inArray(contentCalendar.status, ["scheduled", "ready", "published"]),
        ),
      )
      .orderBy(asc(contentCalendar.scheduledOn))
      .limit(20),

    db.select()
      .from(clientReports)
      .where(
        and(
          eq(clientReports.clientId, clientId),
          isNull(clientReports.deletedAt),
          eq(clientReports.isPublished, true),
        ),
      )
      .orderBy(desc(clientReports.period))
      .limit(12),

    db.select({
      id: files.id, name: files.name, category: files.category,
      externalUrl: files.externalUrl, modifiedAt: files.modifiedAt,
    })
      .from(files)
      .where(
        and(
          eq(files.clientId, clientId),
          isNull(files.deletedAt),
          eq(files.isFolder, false),
          inArray(files.category, ["Rapportages", "Strategie", "Video"]),
        ),
      )
      .orderBy(desc(files.modifiedAt))
      .limit(20),

    // Alleen gebeurtenissen die expliciet voor de klant bedoeld zijn.
    db.select({
      id: activityEvents.id, type: activityEvents.type, title: activityEvents.title,
      occurredAt: activityEvents.occurredAt,
    })
      .from(activityEvents)
      .where(
        and(eq(activityEvents.clientId, clientId), eq(activityEvents.isClientVisible, true)),
      )
      .orderBy(desc(activityEvents.occurredAt))
      .limit(20),

    db.execute(sql`
      select
        coalesce(sum(dm.views), 0)::int as views,
        coalesce(sum(dm.reach), 0)::int as reach,
        coalesce(sum(dm.engagements), 0)::int as engagements,
        coalesce(sum(dm.follower_delta), 0)::int as follower_growth
      from daily_metrics dm
      where dm.client_id = ${clientId}
        and dm.measured_on >= current_date - interval '30 days'
    `),
    // Afspraken uit Google Agenda die aan deze klant zijn gekoppeld.
    upcomingAppointmentsForClient(clientId, 8),
  ]);

  const metricRow =
    ((metrics as unknown as { rows?: Array<Record<string, number>> }).rows ??
      (metrics as unknown as Array<Record<string, number>>))[0] ?? {};

  // "Volgende opname": eerst de handmatige/Monday-opnamedag; is die er niet,
  // dan de eerstvolgende opname uit Google Agenda, zodat de kaart echte data
  // toont zodra de agenda gekoppeld is.
  let nextShoot = upcomingShoot[0] ?? null;
  if (!nextShoot) {
    const ev = await nextShootForClient(clientId);
    if (ev) {
      const tz = "Europe/Amsterdam";
      nextShoot = {
        id: ev.id,
        title: ev.title ?? "Opnamedag",
        scheduledOn: ev.startsAt.toLocaleDateString("en-CA", { timeZone: tz }),
        startTime: ev.allDay
          ? null
          : ev.startsAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: tz }),
        locationName: ev.location ?? null,
      };
    }
  }

  return {
    client,
    awaitingApproval,
    scriptsToReview,
    inProgress,
    published,
    upcomingShoot: nextShoot,
    upcomingShoots: upcomingShoot,
    appointments,
    calendar,
    reports,
    documents,
    timeline,
    metrics: {
      views: Number(metricRow.views ?? 0),
      reach: Number(metricRow.reach ?? 0),
      engagements: Number(metricRow.engagements ?? 0),
      followerGrowth: Number(metricRow.follower_growth ?? 0),
    },
  };
}

/** Klantfeedback op één video — uitsluitend de draden die voor de klant zijn. */
export async function getPortalVideo(viewer: Viewer, videoId: string) {
  const clientId = viewer.clientId;
  if (!clientId) notFound();

  const [video] = await db
    .select({
      id: deliverables.id,
      title: deliverables.title,
      status: deliverables.status,
      frameUrl: deliverables.frameUrl,
      plannedPublishOn: deliverables.plannedPublishOn,
      clientId: deliverables.clientId,
    })
    .from(deliverables)
    .where(
      and(
        eq(deliverables.id, videoId),
        eq(deliverables.clientId, clientId),
        isNull(deliverables.deletedAt),
      ),
    )
    .limit(1);

  if (!video) notFound();

  const threads = await db
    .select({
      id: reviewThreads.id,
      timecodeMs: reviewThreads.timecodeMs,
      isResolved: reviewThreads.isResolved,
      createdAt: reviewThreads.createdAt,
    })
    .from(reviewThreads)
    .where(
      and(
        eq(reviewThreads.deliverableId, videoId),
        eq(reviewThreads.visibility, "client"),
        isNull(reviewThreads.deletedAt),
      ),
    )
    .orderBy(asc(reviewThreads.createdAt));

  const comments = threads.length
    ? await db
        .select({
          id: reviewComments.id,
          threadId: reviewComments.threadId,
          body: reviewComments.body,
          authorName: reviewComments.authorName,
          createdAt: reviewComments.createdAt,
        })
        .from(reviewComments)
        .where(
          and(
            inArray(reviewComments.threadId, threads.map((t) => t.id)),
            isNull(reviewComments.deletedAt),
          ),
        )
        .orderBy(asc(reviewComments.createdAt))
    : [];

  return {
    video,
    threads: threads.map((t) => ({ ...t, comments: comments.filter((c) => c.threadId === t.id) })),
  };
}
