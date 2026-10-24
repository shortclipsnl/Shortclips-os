import "server-only";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  activityEvents,
  clientIntegrations,
  clientPackages,
  clientReports,
  clients,
  contentCalendar,
  contracts,
  deliverables,
  files,
  productionDays,
  reviewComments,
  reviewThreads,
  scripts,
  users,
} from "@/db/schema";
import { assertClientAccess, type Viewer } from "@/server/auth/context";
import { nextShootForClient, upcomingAppointmentsForClient } from "@/server/appointments";
import { syncCalendarIfStale } from "@/server/jobs/calendar-sync";
import { cleanVideoTitle } from "@/lib/portal-status";

/**
 * Alles wat het klantportaal toont — en niets meer.
 *
 * Elke query filtert hard op de klant van de ingelogde gebruiker. Interne
 * statussen, interne opmerkingen, marges, editorgegevens en andere klanten
 * komen hier principieel niet voorbij.
 */

/** Vouwt dubbele video's (formaatvarianten) samen op schone titel — overal
 *  dezelfde logica, zodat de aantallen op homepage en Video's gelijk zijn. */
function dedupByTitle<T extends { title: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const key = r.title.toLowerCase().replace(/[?!.…\s]+$/g, "").trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(r);
  }
  return out;
}

export async function getPortalData(viewer: Viewer) {
  const clientId = viewer.clientId;
  if (!clientId) notFound();

  // Houd de Google Agenda vers in het portaal: elke keer dat een klant het
  // portaal opent, controleren we of de laatste sync >15 min geleden is en
  // verversen we 'm zo nodig op de achtergrond. Zo zien klanten wijzigingen in
  // de agenda snel, los van wanneer het team een interne pagina opent of de
  // nachtelijke/dagelijkse cron draait.
  await syncCalendarIfStale(15);

  const [client] = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      color: clients.color,
      logoUrl: clients.logoUrl,
      monthlyVideoQuota: clients.monthlyVideoQuota,
      startedOn: clients.startedOn,
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
          // Alleen écht "jouw beoordeling" is actie nodig; "In aanpassing"
          // (client_revision) is aan ons — die staat bij "in productie".
          eq(deliverables.status, "client_review"),
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
          inArray(deliverables.status, [
            "recorded", "footage_upload", "awaiting_editor", "editing",
            "internal_review", "editor_revision", "client_revision",
            "approved", "ready_to_publish", "scheduled",
          ]),
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

  // Onlangs online gezet: video's die gisteren of vandaag zijn gepubliceerd
  // (uit de publicatiekalender, gevoed vanuit o.a. Google Agenda). Hiermee
  // tonen we op het dashboard een melding "we hebben deze video geplaatst —
  // leuk om 'm even te bekijken", de ochtend nadat een video online is gezet.
  const yesterdayIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const recentlyPublished = (
    await db
      .select({
        id: contentCalendar.id,
        title: contentCalendar.title,
        scheduledOn: contentCalendar.scheduledOn,
        platforms: contentCalendar.platforms,
        deliverableId: contentCalendar.deliverableId,
      })
      .from(contentCalendar)
      .where(
        and(
          eq(contentCalendar.clientId, clientId),
          isNull(contentCalendar.deletedAt),
          eq(contentCalendar.status, "published"),
          gte(contentCalendar.scheduledOn, yesterdayIso),
          lte(contentCalendar.scheduledOn, today),
        ),
      )
      .orderBy(desc(contentCalendar.scheduledOn))
      .limit(6)
  ).map((r) => ({ ...r, title: cleanVideoTitle(r.title), platforms: (r.platforms as string[]) ?? [] }));

  return {
    client,
    recentlyPublished,
    awaitingApproval: awaitingApproval.map((v) => ({ ...v, title: cleanVideoTitle(v.title) })),
    scriptsToReview,
    inProgress: inProgress.map((v) => ({ ...v, title: cleanVideoTitle(v.title) })),
    published: dedupByTitle(published.map((v) => ({ ...v, title: cleanVideoTitle(v.title) }))),
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

export type PortalPlatformResult = {
  platform: string;
  views: number;
  reach: number;
  engagements: number;
  followerGrowth: number;
};

export type PortalResults = {
  days: number;
  metrics: { views: number; reach: number; engagements: number; followerGrowth: number };
  deltas: { views: number | null; reach: number | null; engagements: number | null };
  byPlatform: PortalPlatformResult[];
  likes: number;
  comments: number;
  valuableInteractions: number;
  avgWatchSeconds: number;
  insight: string | null;
  hasData: boolean;
};

/**
 * Resultaten met inzicht (§Resultaten): kerncijfers over de gekozen periode,
 * de verandering t.o.v. de vorige even lange periode, en een korte "wat valt
 * op"-samenvatting — allemaal uit de echte cijfers (Metricool via daily_metrics).
 */
export async function getPortalResults(viewer: Viewer, days = 30): Promise<PortalResults> {
  const clientId = viewer.clientId;
  if (!clientId) notFound();
  return computePortalResults(clientId, days);
}

/**
 * Interne voorbeeldweergave: precies de cijfers die de klant in zijn eigen
 * portaal ziet, maar opvraagbaar door het kantoorteam voor een specifieke klant
 * (hard gescoped op klanttoegang). Zo kan het team zien hoe de resultaten er in
 * het klantportaal uitzien.
 */
export async function getPortalResultsForClient(viewer: Viewer, clientId: string, days = 30): Promise<PortalResults> {
  assertClientAccess(viewer, clientId);
  return computePortalResults(clientId, days);
}

async function computePortalResults(clientId: string, days: number): Promise<PortalResults> {
  const res = await db.execute(sql`
    with cur as (
      select coalesce(sum(views),0)::int v, coalesce(sum(reach),0)::int r,
             coalesce(sum(engagements),0)::int e, coalesce(sum(follower_delta),0)::int f,
             coalesce(sum(likes),0)::int lk, coalesce(sum(comments),0)::int cm,
             coalesce(sum(shares),0)::int sh, coalesce(sum(saves),0)::int sv,
             coalesce(sum(watch_seconds),0)::int ws, coalesce(sum(video_views),0)::int vv
      from daily_metrics
      where client_id = ${clientId}
        and measured_on >= current_date - (${days} * interval '1 day')
    ), prev as (
      select coalesce(sum(views),0)::int v, coalesce(sum(reach),0)::int r,
             coalesce(sum(engagements),0)::int e, coalesce(sum(follower_delta),0)::int f,
             count(*)::int n
      from daily_metrics
      where client_id = ${clientId}
        and measured_on >= current_date - (${2 * days} * interval '1 day')
        and measured_on <  current_date - (${days} * interval '1 day')
    )
    select cur.v cv, cur.r cr, cur.e ce, cur.f cf, cur.lk clk, cur.cm ccm, cur.sh csh, cur.sv csv, cur.ws cws, cur.vv cvv,
           prev.v pv, prev.r pr, prev.e pe, prev.f pf, prev.n pn
    from cur, prev
  `);

  const row =
    ((res as unknown as { rows?: Array<Record<string, number>> }).rows ??
      (res as unknown as Array<Record<string, number>>))[0] ?? {};

  const n = (k: string) => Number(row[k] ?? 0);
  const cur = { views: n("cv"), reach: n("cr"), engagements: n("ce"), followerGrowth: n("cf") };
  const prev = { views: n("pv"), reach: n("pr"), engagements: n("pe") };
  const likes = n("clk");
  const comments = n("ccm");
  const valuableInteractions = n("csh") + n("csv");
  const videoViews = n("cvv");
  const avgWatchSeconds = videoViews > 0 ? Math.round(n("cws") / videoViews) : 0;
  // Alleen vergelijken als de vorige periode voldoende data heeft — anders geeft
  // een bijna-lege basis onzinnige percentages (bv. +3000%).
  const prevCovered = n("pn") >= Math.ceil(days * 0.8);
  const pct = (c: number, p: number): number | null =>
    prevCovered && p > 0 ? Math.round(((c - p) / p) * 100) : null;
  const deltas = {
    views: pct(cur.views, prev.views),
    reach: pct(cur.reach, prev.reach),
    engagements: pct(cur.engagements, prev.engagements),
  };

  const hasData = cur.views + cur.reach + cur.engagements + Math.abs(cur.followerGrowth) > 0;

  // Per-platform uitsplitsing over dezelfde periode.
  const platRes = await db.execute(sql`
    select platform,
           coalesce(sum(views),0)::int v, coalesce(sum(reach),0)::int r,
           coalesce(sum(engagements),0)::int e, coalesce(sum(follower_delta),0)::int f
    from daily_metrics
    where client_id = ${clientId}
      and platform is not null
      and measured_on >= current_date - (${days} * interval '1 day')
    group by platform
    having coalesce(sum(views),0) + coalesce(sum(reach),0) > 0
    order by coalesce(sum(views),0) desc
  `);
  const platRows =
    (platRes as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
    (platRes as unknown as Array<Record<string, unknown>>);
  const byPlatform: PortalPlatformResult[] = platRows.map((p) => ({
    platform: String(p.platform),
    views: Number(p.v ?? 0),
    reach: Number(p.r ?? 0),
    engagements: Number(p.e ?? 0),
    followerGrowth: Number(p.f ?? 0),
  }));

  // "Wat valt op": alleen stellen wat de cijfers onderbouwen.
  let insight: string | null = null;
  if (hasData) {
    const nf = new Intl.NumberFormat("nl-NL");
    const parts: string[] = [];
    parts.push(`Je content is deze periode ${nf.format(cur.views)} keer bekeken en bereikte ${nf.format(cur.reach)} mensen.`);
    if (deltas.reach !== null) {
      if (deltas.reach > 4) parts.push(`Dat is ${deltas.reach}% meer bereik dan de vorige ${days} dagen — mooie groei.`);
      else if (deltas.reach < -4) parts.push(`Het bereik ligt ${Math.abs(deltas.reach)}% lager dan de vorige ${days} dagen; we sturen bij op de onderwerpen die het best werken.`);
      else parts.push(`Het bereik is stabiel t.o.v. de vorige ${days} dagen.`);
    }
    if (avgWatchSeconds > 0) parts.push(`Kijkers bleven gemiddeld ${avgWatchSeconds} seconden kijken.`);
    if (cur.followerGrowth > 0) parts.push(`Je kwam er ${cur.followerGrowth} volger${cur.followerGrowth === 1 ? "" : "s"} bij.`);
    insight = parts.join(" ");
  }

  return { days, metrics: cur, deltas, byPlatform, likes, comments, valuableInteractions, avgWatchSeconds, insight, hasData };
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
      statusChangedAt: deliverables.statusChangedAt,
      approvedAt: deliverables.approvedAt,
      publishedAt: deliverables.publishedAt,
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
    video: { ...video, title: cleanVideoTitle(video.title) },
    threads: threads.map((t) => ({ ...t, comments: comments.filter((c) => c.threadId === t.id) })),
  };
}

const IN_PRODUCTION_STATUSES = [
  "recorded", "footage_upload", "awaiting_editor", "editing", "internal_review",
  "editor_revision", "client_revision", "approved", "ready_to_publish", "scheduled",
] as const;

/** Alle video's van de klant, gegroepeerd voor de video-omgeving (§24). */
export async function getPortalVideos(viewer: Viewer) {
  const clientId = viewer.clientId;
  if (!clientId) notFound();

  const rows = await db
    .select({
      id: deliverables.id,
      title: deliverables.title,
      status: deliverables.status,
      frameUrl: deliverables.frameUrl,
      frameAssetId: deliverables.frameAssetId,
      thumbnailUrl: deliverables.thumbnailUrl,
      publishedAt: deliverables.publishedAt,
      plannedPublishOn: deliverables.plannedPublishOn,
      statusChangedAt: deliverables.statusChangedAt,
    })
    .from(deliverables)
    .where(and(eq(deliverables.clientId, clientId), isNull(deliverables.deletedAt)))
    .orderBy(desc(deliverables.publishedAt), desc(deliverables.statusChangedAt))
    .limit(1000);

  const clean = rows.map((v) => ({ ...v, title: cleanVideoTitle(v.title) }));

  // Gepubliceerd: één kaart per video. Frame levert per video meerdere bestanden
  // (9:16/4:5/1:1, .mov/.mp4) die naar dezelfde schone titel opschonen — die
  // vouwen we samen (nieuwste eerst, want gesorteerd op publishedAt). De Monday-
  // afgeleide titels (bv. "KKFH") vouwen we bewust NIET samen.
  const gepubliceerd = dedupByTitle(clean.filter((v) => v.status === "published"));

  return {
    actieNodig: clean.filter((v) => v.status === "client_review"),
    inProductie: clean.filter((v) => (IN_PRODUCTION_STATUSES as readonly string[]).includes(v.status)),
    gepubliceerd,
    totaal: rows.length,
  };
}

/**
 * De Frame.io-reviewlink van deze klant — daar bekijkt en beoordeelt de klant
 * z'n video's. Frame.io blijft de review-omgeving; het portaal verwijst ernaar.
 */
export async function getPortalFrameUrl(viewer: Viewer): Promise<string | null> {
  const clientId = viewer.clientId;
  if (!clientId) return null;
  const [link] = await db
    .select({ externalId: clientIntegrations.externalId, externalUrl: clientIntegrations.externalUrl })
    .from(clientIntegrations)
    .where(and(eq(clientIntegrations.clientId, clientId), eq(clientIntegrations.provider, "frameio")))
    .limit(1);
  if (!link) return null;
  if (link.externalUrl) return link.externalUrl;
  return link.externalId ? `https://next.frame.io/project/${link.externalId}` : null;
}

/**
 * De samenwerking in cijfers (§samenwerkingsoverzicht): wat is afgesproken en
 * sinds wanneer. De lopende afspraken zelf staan op de Werkwijze-pagina.
 */
export async function getPortalCollaboration(viewer: Viewer): Promise<{
  monthlyQuota: number;
  packageName: string | null;
  shootDaysPerMonth: number;
  startedOn: string | null;
  contract: { startsOn: string; endsOn: string | null; noticePeriodDays: number } | null;
}> {
  const clientId = viewer.clientId;
  if (!clientId) notFound();

  const [client] = await db
    .select({ quota: clients.monthlyVideoQuota, startedOn: clients.startedOn })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);

  // Afgesproken pakket: als het quota-veld leeg is, val terug op het actieve pakket.
  const [pkg] = await db
    .select({ name: clientPackages.name, videosPerMonth: clientPackages.videosPerMonth, shootDays: clientPackages.shootDaysPerMonth })
    .from(clientPackages)
    .where(and(eq(clientPackages.clientId, clientId), eq(clientPackages.isActive, true)))
    .orderBy(desc(clientPackages.startsOn))
    .limit(1);

  const [contract] = await db
    .select({
      startsOn: contracts.startsOn,
      endsOn: contracts.endsOn,
      noticePeriodDays: contracts.noticePeriodDays,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.clientId, clientId),
        eq(contracts.status, "active"),
        isNull(contracts.deletedAt),
      ),
    )
    .orderBy(desc(contracts.startsOn))
    .limit(1);

  return {
    monthlyQuota: (client?.quota ?? 0) || (pkg?.videosPerMonth ?? 0),
    packageName: pkg?.name ?? null,
    shootDaysPerMonth: pkg?.shootDays ?? 0,
    startedOn: client?.startedOn ?? null,
    contract: contract ?? null,
  };
}

export type PortalContactPerson = {
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
};

/**
 * De contactpersonen van de klant bij ShortClips (§29): de vaste coördinator en
 * — indien bekend — de videograaf van de laatste/komende opname. Telefoon en
 * WhatsApp komen uit het telefoonveld van het teamlid (zodra ingevuld).
 */
export async function getPortalContact(viewer: Viewer): Promise<{
  clientName: string;
  coordinator: PortalContactPerson | null;
  videographer: PortalContactPerson | null;
}> {
  const clientId = viewer.clientId;
  if (!clientId) notFound();

  const [client] = await db
    .select({
      name: clients.name,
      coordinatorName: users.fullName,
      coordinatorEmail: users.email,
      coordinatorPhone: users.phone,
      coordinatorAvatar: users.avatarUrl,
    })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);

  // Videograaf van de meest recente opnamedag; anders de vaste videograaf.
  let [shoot] = await db
    .select({
      name: users.fullName,
      email: users.email,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
    })
    .from(productionDays)
    .innerJoin(users, eq(users.id, productionDays.videographerId))
    .where(and(eq(productionDays.clientId, clientId), isNull(productionDays.deletedAt)))
    .orderBy(desc(productionDays.scheduledOn))
    .limit(1);

  if (!shoot) {
    // De vaste videograaf met een ingevuld telefoonnummer (echte contactgegevens).
    [shoot] = await db
      .select({ name: users.fullName, email: users.email, phone: users.phone, avatarUrl: users.avatarUrl })
      .from(users)
      .where(
        and(
          eq(users.primaryRole, "videographer"),
          isNull(users.deletedAt),
          isNotNull(users.phone),
        ),
      )
      .orderBy(asc(users.createdAt))
      .limit(1);
  }

  return {
    clientName: client?.name ?? "",
    coordinator: client?.coordinatorName
      ? {
          name: client.coordinatorName,
          role: "Vaste contactpersoon",
          email: client.coordinatorEmail,
          phone: client.coordinatorPhone,
          avatarUrl: client.coordinatorAvatar ?? null,
        }
      : null,
    videographer: shoot
      ? { name: shoot.name, role: "Videograaf", email: shoot.email, phone: shoot.phone, avatarUrl: shoot.avatarUrl ?? null }
      : null,
  };
}
