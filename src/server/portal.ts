import "server-only";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  activityEvents,
  clientContacts,
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
      weHandlePosting: clients.weHandlePosting,
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
          // Alleen goedgekeurde-en-gedeelde planning (of al online) is zichtbaar.
          or(eq(contentCalendar.clientApproved, true), eq(contentCalendar.status, "published")),
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

  // Scripts die aan de eerstvolgende ingeplande opnamedag hangen, zodat de klant
  // op het overzicht meteen ziet dat de scripts voor die dag al klaarstaan.
  // Alleen voor een échte opnamedag uit de planning (productionDays) — een losse
  // agenda-afspraak heeft geen gekoppelde scripts.
  const shootDayId = upcomingShoot[0]?.id ?? null;
  const shootScripts = shootDayId
    ? await db
        .select({ id: scripts.id, title: scripts.title, status: scripts.status })
        .from(scripts)
        .where(and(eq(scripts.clientId, clientId), eq(scripts.productionDayId, shootDayId), isNull(scripts.deletedAt)))
        .orderBy(asc(scripts.title))
    : [];

  return {
    client,
    recentlyPublished,
    shootScripts,
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

export type PortalTopVideo = {
  id: string;
  title: string;
  platform: string;
  views: number;
  likes: number;
  comments: number;
  publishedAt: string | null;
  url: string | null;
  thumbnailUrl: string | null;
};

export type PortalPlatformResult = {
  platform: string;
  views: number;
  reach: number;
  engagements: number;
  followerGrowth: number;
  likes: number;
  videoCount: number;
  bestVideo: { title: string; views: number; url: string | null } | null;
};

export type PortalSeriesPoint = { date: string; views: number; reach: number; engagements: number; followers: number };

export type PortalMilestone = { lifetimeViews: number; reached: number | null; next: number | null; progressPct: number };

export type PortalResultMetrics = { views: number; reach: number; engagements: number; followerGrowth: number; publishedVideos: number };

export type PortalResults = {
  days: number;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  metrics: PortalResultMetrics;
  prev: PortalResultMetrics;
  deltas: { views: number | null; reach: number | null; engagements: number | null; followerGrowth: number | null; publishedVideos: number | null };
  byPlatform: PortalPlatformResult[];
  series: PortalSeriesPoint[];
  topVideos: PortalTopVideo[];
  /** Alle gepubliceerde video's uit de periode met hun cijfers, van veel → weinig weergaven. */
  allVideos: PortalTopVideo[];
  likes: number;
  comments: number;
  valuableInteractions: number;
  avgWatchSeconds: number;
  insight: string | null;
  insights: string[];
  milestone: PortalMilestone | null;
  lastUpdated: string | null;
  hasData: boolean;
};

export type PortalResultsOpts = { days?: number; from?: string; to?: string; periodKey?: string };

/**
 * Resultaten met inzicht (§Resultaten): kerncijfers over de gekozen periode,
 * de verandering t.o.v. de vorige even lange periode, en een korte "wat valt
 * op"-samenvatting — allemaal uit de echte cijfers (Metricool via daily_metrics).
 */
export async function getPortalResults(viewer: Viewer, opts: PortalResultsOpts = {}): Promise<PortalResults> {
  const clientId = viewer.clientId;
  if (!clientId) notFound();
  return computePortalResults(clientId, opts);
}

/**
 * Interne voorbeeldweergave: precies de cijfers die de klant in zijn eigen
 * portaal ziet, maar opvraagbaar door het kantoorteam voor een specifieke klant
 * (hard gescoped op klanttoegang). Zo kan het team zien hoe de resultaten er in
 * het klantportaal uitzien.
 */
export async function getPortalResultsForClient(viewer: Viewer, clientId: string, opts: PortalResultsOpts = {}): Promise<PortalResults> {
  assertClientAccess(viewer, clientId);
  return computePortalResults(clientId, opts);
}

const MILESTONE_THRESHOLDS = [100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000];

const PLATFORM_LABELS: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook", linkedin: "LinkedIn" };
function PLATFORM_LABEL(p: string): string {
  return PLATFORM_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

function rowsOf<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[])) ?? [];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function computePortalResults(clientId: string, opts: PortalResultsOpts): Promise<PortalResults> {
  // Periode-venster bepalen: preset (days) of eigen periode (from/to).
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const end = opts.to ? new Date(`${opts.to}T12:00:00Z`) : today;
  const start = opts.from ? new Date(`${opts.from}T12:00:00Z`) : new Date(end.getTime() - ((opts.days ?? 30) - 1) * 86_400_000);
  const lenDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (lenDays - 1) * 86_400_000);
  const [startIso, endIso, prevStartIso, prevEndIso] = [isoDay(start), isoDay(end), isoDay(prevStart), isoDay(prevEnd)];
  const periodKey = opts.periodKey ?? (opts.from ? "custom" : String(opts.days ?? 30));

  // Kerncijfers huidige + vorige periode, plus laatst-gemeten-datum.
  const [totalsRes, lifetimeRes] = await Promise.all([
    db.execute(sql`
      with cur as (
        select coalesce(sum(views),0)::int v, coalesce(sum(reach),0)::int r,
               coalesce(sum(engagements),0)::int e, coalesce(sum(follower_delta),0)::int f,
               coalesce(sum(likes),0)::int lk, coalesce(sum(comments),0)::int cm,
               coalesce(sum(shares),0)::int sh, coalesce(sum(saves),0)::int sv,
               coalesce(sum(watch_seconds),0)::int ws, coalesce(sum(video_views),0)::int vv
        from daily_metrics where client_id = ${clientId} and measured_on between ${startIso} and ${endIso}
      ), prev as (
        select coalesce(sum(views),0)::int v, coalesce(sum(reach),0)::int r,
               coalesce(sum(engagements),0)::int e, coalesce(sum(follower_delta),0)::int f,
               count(distinct measured_on)::int pdays
        from daily_metrics where client_id = ${clientId} and measured_on between ${prevStartIso} and ${prevEndIso}
      ), pubcur as (
        select count(distinct deliverable_id)::int c from publications
        where client_id = ${clientId} and status = 'published' and published_at is not null
          and published_at::date between ${startIso} and ${endIso}
      ), pubprev as (
        select count(distinct deliverable_id)::int c from publications
        where client_id = ${clientId} and status = 'published' and published_at is not null
          and published_at::date between ${prevStartIso} and ${prevEndIso}
      )
      select cur.v cv, cur.r cr, cur.e ce, cur.f cf, cur.lk clk, cur.cm ccm, cur.sh csh, cur.sv csv, cur.ws cws, cur.vv cvv,
             prev.v pv, prev.r pr, prev.e pe, prev.f pf, prev.pdays ppd, pubcur.c pubc, pubprev.c pubp
      from cur, prev, pubcur, pubprev
    `),
    db.execute(sql`select coalesce(sum(views),0)::bigint lv, max(measured_on)::text lu from daily_metrics where client_id = ${clientId}`),
  ]);

  const row = rowsOf<Record<string, number>>(totalsRes)[0] ?? {};
  const life = rowsOf<Record<string, unknown>>(lifetimeRes)[0] ?? {};
  const n = (k: string) => Number(row[k] ?? 0);

  const metrics: PortalResultMetrics = { views: n("cv"), reach: n("cr"), engagements: n("ce"), followerGrowth: n("cf"), publishedVideos: n("pubc") };
  const prev: PortalResultMetrics = { views: n("pv"), reach: n("pr"), engagements: n("pe"), followerGrowth: n("pf"), publishedVideos: n("pubp") };
  const likes = n("clk");
  const comments = n("ccm");
  const valuableInteractions = n("csh") + n("csv");
  const videoViews = n("cvv");
  const avgWatchSeconds = videoViews > 0 ? Math.round(n("cws") / videoViews) : 0;

  // Alleen vergelijken als de vorige periode voldoende dagen data had — anders
  // geeft een bijna-lege basis onzinnige percentages (bv. +3000%).
  const prevCovered = n("ppd") >= Math.ceil(lenDays * 0.8);
  const pct = (c: number, p: number): number | null => (prevCovered && p > 0 ? Math.round(((c - p) / p) * 100) : null);
  const deltas = {
    views: pct(metrics.views, prev.views),
    reach: pct(metrics.reach, prev.reach),
    engagements: pct(metrics.engagements, prev.engagements),
    followerGrowth: pct(metrics.followerGrowth, prev.followerGrowth),
    publishedVideos: pct(metrics.publishedVideos, prev.publishedVideos),
  };

  const hasData = metrics.views + metrics.reach + metrics.engagements + Math.abs(metrics.followerGrowth) > 0;

  // Per-platform, dagelijkse tijdreeks en best presterende video's — parallel.
  const [platRes, seriesRes, videoRes] = await Promise.all([
    db.execute(sql`
      select platform,
             coalesce(sum(views),0)::int v, coalesce(sum(reach),0)::int r,
             coalesce(sum(engagements),0)::int e, coalesce(sum(follower_delta),0)::int f,
             coalesce(sum(likes),0)::int lk, coalesce(sum(posts_published),0)::int pv
      from daily_metrics
      where client_id = ${clientId} and platform is not null and measured_on between ${startIso} and ${endIso}
      group by platform
      having coalesce(sum(views),0) + coalesce(sum(reach),0) > 0
      order by coalesce(sum(views),0) desc
    `),
    db.execute(sql`
      select measured_on::text d,
             coalesce(sum(views),0)::int v, coalesce(sum(reach),0)::int r,
             coalesce(sum(engagements),0)::int e, coalesce(sum(follower_delta),0)::int f
      from daily_metrics
      where client_id = ${clientId} and measured_on between ${startIso} and ${endIso}
      group by measured_on order by measured_on
    `),
    db.execute(sql`
      with latest as (
        select distinct on (sm.publication_id)
          sm.publication_id, sm.platform, sm.views, sm.likes, sm.comments
        from social_metrics sm
        where sm.client_id = ${clientId} and sm.measured_on between ${startIso} and ${endIso}
        order by sm.publication_id, sm.measured_on desc
      )
      select l.publication_id pid, l.platform, l.views, l.likes, l.comments,
             p.external_url url, p.published_at::text pub, p.deliverable_id did, p.caption,
             d.title dtitle, d.thumbnail_url dthumb, cc.cover_url cover
      from latest l
      join publications p on p.id = l.publication_id
      left join deliverables d on d.id = p.deliverable_id
      left join content_calendar cc on cc.id = p.calendar_item_id
      order by l.views desc
      limit 100
    `),
  ]);

  const videoRows = rowsOf<Record<string, unknown>>(videoRes);
  const bestPerPlatform = new Map<string, number>();
  const bestVideoPerPlatform = new Map<string, { title: string; views: number; url: string | null }>();
  // Beste video per platform bepalen voor de platformkaarten.
  const titleFor = (v: Record<string, unknown>): string => {
    const dt = v.dtitle ? cleanVideoTitle(String(v.dtitle)) : "";
    if (dt) return dt;
    const cap = v.caption ? String(v.caption).split("\n")[0]!.trim() : "";
    if (cap) return cap.length > 70 ? `${cap.slice(0, 67)}…` : cap;
    return `Video op ${PLATFORM_LABEL(String(v.platform))}`;
  };
  for (const v of videoRows) {
    const plat = String(v.platform);
    const views = Number(v.views ?? 0);
    if (views > (bestPerPlatform.get(plat) ?? -1)) {
      bestPerPlatform.set(plat, views);
      bestVideoPerPlatform.set(plat, { title: titleFor(v), views, url: v.url ? String(v.url) : null });
    }
  }

  const platRows = rowsOf<Record<string, unknown>>(platRes);
  const byPlatform: PortalPlatformResult[] = platRows.map((p) => ({
    platform: String(p.platform),
    views: Number(p.v ?? 0),
    reach: Number(p.r ?? 0),
    engagements: Number(p.e ?? 0),
    followerGrowth: Number(p.f ?? 0),
    likes: Number(p.lk ?? 0),
    videoCount: Number(p.pv ?? 0),
    bestVideo: bestVideoPerPlatform.get(String(p.platform)) ?? null,
  }));

  const series: PortalSeriesPoint[] = rowsOf<Record<string, unknown>>(seriesRes).map((s) => ({
    date: String(s.d),
    views: Number(s.v ?? 0),
    reach: Number(s.r ?? 0),
    engagements: Number(s.e ?? 0),
    followers: Number(s.f ?? 0),
  }));

  // Top-video's: per video (deliverable) de sterkste publicatie, daarna de beste 3.
  const byDeliverable = new Map<string, Record<string, unknown>>();
  for (const v of videoRows) {
    const key = v.did ? String(v.did) : String(v.pid);
    const existing = byDeliverable.get(key);
    if (!existing || Number(v.views ?? 0) > Number(existing.views ?? 0)) byDeliverable.set(key, v);
  }
  const toTopVideo = (v: Record<string, unknown>): PortalTopVideo => ({
    id: String(v.pid),
    title: titleFor(v),
    platform: String(v.platform),
    views: Number(v.views ?? 0),
    likes: Number(v.likes ?? 0),
    comments: Number(v.comments ?? 0),
    publishedAt: v.pub ? String(v.pub).slice(0, 10) : null,
    url: v.url ? String(v.url) : null,
    thumbnailUrl: v.dthumb ? String(v.dthumb) : v.cover ? String(v.cover) : null,
  });
  const allVideos: PortalTopVideo[] = [...byDeliverable.values()]
    .sort((a, b) => Number(b.views ?? 0) - Number(a.views ?? 0))
    .map(toTopVideo);
  const topVideos: PortalTopVideo[] = allVideos.slice(0, 3);

  // Mijlpaal: hoogste drempel die het totaal aantal weergaven (sinds we meten) bereikte.
  const lifetimeViews = Number(life.lv ?? 0);
  const reached = [...MILESTONE_THRESHOLDS].reverse().find((t) => lifetimeViews >= t) ?? null;
  const next = MILESTONE_THRESHOLDS.find((t) => lifetimeViews < t) ?? null;
  const milestone: PortalMilestone | null = lifetimeViews > 0 ? { lifetimeViews, reached, next, progressPct: next ? Math.round((lifetimeViews / next) * 100) : 100 } : null;
  const lastUpdated = life.lu ? String(life.lu) : null;

  // "Wat valt op": korte, begrijpelijke punten — uitsluitend wat de cijfers onderbouwen.
  const nf = new Intl.NumberFormat("nl-NL");
  const insights: string[] = [];
  if (hasData) {
    if (deltas.reach !== null && Math.abs(deltas.reach) >= 5) {
      insights.push(`Jullie video's bereikten ${deltas.reach > 0 ? `${deltas.reach}% méér` : `${Math.abs(deltas.reach)}% minder`} mensen dan de vorige periode.`);
    } else {
      insights.push(`Jullie content bereikte ${nf.format(metrics.reach)} mensen deze periode.`);
    }
    if (byPlatform.length >= 2) insights.push(`${PLATFORM_LABEL(byPlatform[0]!.platform)} is jullie grootste platform qua weergaven.`);
    if (topVideos[0]) insights.push(`De best presterende video behaalde ${nf.format(topVideos[0].views)} weergaven.`);
    if (metrics.followerGrowth > 0) insights.push(`Jullie kregen ${nf.format(metrics.followerGrowth)} nieuwe volger${metrics.followerGrowth === 1 ? "" : "s"} deze periode.`);
  }
  const insight = insights.length ? insights.join(" ") : null;

  return {
    days: lenDays,
    periodKey,
    periodStart: startIso,
    periodEnd: endIso,
    metrics,
    prev,
    deltas,
    byPlatform,
    series,
    topVideos,
    allVideos,
    likes,
    comments,
    valuableInteractions,
    avgWatchSeconds,
    insight,
    insights: insights.slice(0, 4),
    milestone,
    lastUpdated,
    hasData,
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
      productionDayId: deliverables.productionDayId,
      sessionDate: productionDays.scheduledOn,
      sessionTitle: productionDays.title,
    })
    .from(deliverables)
    .leftJoin(productionDays, eq(productionDays.id, deliverables.productionDayId))
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
    .select({ externalUrl: clientIntegrations.externalUrl })
    .from(clientIntegrations)
    .where(and(eq(clientIntegrations.clientId, clientId), eq(clientIntegrations.provider, "frameio")))
    .limit(1);
  if (!link) return null;
  // Alleen een échte, deelbare klant-link teruggeven. De interne project-URL
  // (next.frame.io/project/...) vereist een Frame.io-login en is NIET voor klanten;
  // die gebruiken we uitsluitend intern om de sync aan de klant te koppelen.
  return link.externalUrl ?? null;
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
  platforms: string[];
  upcomingShoots: number;
}> {
  const clientId = viewer.clientId;
  if (!clientId) notFound();
  const today = new Date().toISOString().slice(0, 10);

  const [client] = await db
    .select({ quota: clients.monthlyVideoQuota, startedOn: clients.startedOn })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);

  // Platforms waarop we voor deze klant publiceren — afgeleid uit de contentplanning.
  const platformRows = await db
    .select({ platforms: contentCalendar.platforms })
    .from(contentCalendar)
    .where(and(eq(contentCalendar.clientId, clientId), isNull(contentCalendar.deletedAt)))
    .limit(500);
  const platformSet = new Set<string>();
  for (const r of platformRows) for (const p of ((r.platforms as string[]) ?? [])) if (p) platformSet.add(p);

  // Aantal toekomstige, geplande opnamedagen.
  const [{ n: shootCount } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(productionDays)
    .where(and(eq(productionDays.clientId, clientId), isNull(productionDays.deletedAt), gte(productionDays.scheduledOn, today), sql`${productionDays.status} <> 'cancelled'`));

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
    platforms: [...platformSet],
    upcomingShoots: Number(shootCount ?? 0),
  };
}

export type PortalProfile = {
  company: { name: string; legalName: string | null; logoUrl: string | null; color: string | null; sector: string | null; website: string | null; description: string | null };
  startedOn: string | null;
  daysTogether: number | null;
  monthsTogether: number | null;
  monthlyQuota: number;
  packageName: string | null;
  shootDaysPerMonth: number;
  platforms: string[];
  upcomingShoots: number;
  contract: { startsOn: string; endsOn: string | null; noticePeriodDays: number } | null;
  stats: { shortsProduced: number; opnamesDone: number };
  clientContacts: Array<{ name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean }>;
};

/**
 * Alles voor de samenwerkingspagina (het "klantprofiel"): bedrijfsgegevens, de
 * afspraken (hergebruikt getPortalCollaboration), de contactpersonen van de klant,
 * en een paar samenwerkingsstatistieken. Volledig klant-gescoped; ontbrekende
 * velden komen als null terug (niet verzinnen).
 */
export async function getPortalProfile(viewer: Viewer): Promise<PortalProfile> {
  const clientId = viewer.clientId;
  if (!clientId) notFound();
  const today = new Date().toISOString().slice(0, 10);

  const collab = await getPortalCollaboration(viewer);

  const [client] = await db
    .select({ name: clients.name, legalName: clients.legalName, logoUrl: clients.logoUrl, color: clients.color, sector: clients.sector, website: clients.website, description: clients.description })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) notFound();

  const [[producedRow], [opnamesRow], contacts] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(deliverables).where(and(eq(deliverables.clientId, clientId), isNull(deliverables.deletedAt), eq(deliverables.status, "published"))),
    db.select({ n: sql<number>`count(*)` }).from(productionDays).where(and(eq(productionDays.clientId, clientId), isNull(productionDays.deletedAt), sql`${productionDays.status} <> 'cancelled'`, sql`${productionDays.scheduledOn} < ${today}`)),
    db.select({ name: clientContacts.fullName, role: clientContacts.role, email: clientContacts.email, phone: clientContacts.phone, isPrimary: clientContacts.isPrimary })
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)))
      .orderBy(desc(clientContacts.isPrimary)),
  ]);

  const startIso = collab.contract?.startsOn ?? collab.startedOn ?? null;
  let daysTogether: number | null = null;
  let monthsTogether: number | null = null;
  if (startIso) {
    const start = new Date(`${startIso}T12:00:00`);
    const now = new Date();
    daysTogether = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
    monthsTogether = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()));
  }

  return {
    company: client,
    startedOn: collab.startedOn,
    daysTogether,
    monthsTogether,
    monthlyQuota: collab.monthlyQuota,
    packageName: collab.packageName,
    shootDaysPerMonth: collab.shootDaysPerMonth,
    platforms: collab.platforms,
    upcomingShoots: collab.upcomingShoots,
    contract: collab.contract,
    stats: { shortsProduced: Number(producedRow?.n ?? 0), opnamesDone: Number(opnamesRow?.n ?? 0) },
    clientContacts: contacts.map((c) => ({ name: c.name, role: c.role ?? null, email: c.email ?? null, phone: c.phone ?? null, isPrimary: c.isPrimary })),
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
