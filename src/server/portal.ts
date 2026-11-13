import "server-only";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
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
import { cleanVideoTitle, cleanPlanningTitle } from "@/lib/portal-status";
import { getPublishedVideoResults, type PortalVideo } from "@/server/portal-videos";
import { isCumulativeSeries, toDailySeries } from "@/lib/metric-series";

export type { PortalVideo, PortalVideoPlatform } from "@/server/portal-videos";

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
          // Geannuleerde opnamedagen blijven in de database staan (agenda-sync),
          // maar mogen nooit als "volgende opnamedag" bij de klant verschijnen.
          ne(productionDays.status, "cancelled"),
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
        and dm.measured_on between current_date - interval '29 days' and current_date
    `),
    // Afspraken uit Google Agenda die aan deze klant zijn gekoppeld.
    upcomingAppointmentsForClient(clientId, 8),
  ]);

  const metricRow =
    ((metrics as unknown as { rows?: Array<Record<string, number>> }).rows ??
      (metrics as unknown as Array<Record<string, number>>))[0] ?? {};

  // "Volgende opname": eerst de handmatige opnamedag; is die er niet,
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
  ).map((r) => ({ ...r, title: cleanPlanningTitle(r.title, { fallback: "Nieuwe video" }), platforms: (r.platforms as string[]) ?? [] }));

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
    calendar: calendar.map((c) => ({ ...c, title: cleanPlanningTitle(c.title, { fallback: "Nieuwe video" }) })),
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
  shares: number;
  saves: number;
  reach: number;
  /** Gemiddelde kijktijd in seconden (null = niet geleverd door het platform). */
  avgWatchSeconds: number | null;
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

/** De vier kanalen waarop Shortclips voor klanten publiceert, in vaste volgorde. */
export const RESULT_PLATFORMS = ["instagram", "tiktok", "youtube", "facebook"] as const;

/**
 * Resultaten van één platform in de gekozen periode. `null` betekent: dit
 * cijfer levert het platform (via de koppeling) niet; we tonen dan "niet
 * beschikbaar" in plaats van een verzonnen 0.
 */
export type PortalPlatformDetail = {
  platform: string;
  /** data = cijfers in deze periode; stil = gekoppeld maar geen activiteit; niet-gekoppeld = geen cijfers via de koppeling. */
  state: "data" | "stil" | "niet-gekoppeld";
  views: number | null;
  /** kanaal = dagcijfers van het account; video = som van de video's die in de periode zijn geplaatst. */
  viewsFrom: "kanaal" | "video" | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  interactions: number | null;
  /** Interacties als percentage van de weergaven (1 decimaal). */
  engagementRate: number | null;
  followerGrowth: number | null;
  /** Aantal video's dat in de periode op dit platform is geplaatst. */
  videoCount: number;
  /** Groei t.o.v. de vorige even lange periode; alleen bij vergelijkbare dagcijfers. */
  growth: { views: number | null; interactions: number | null; followerGrowth: number | null };
  prev: { views: number | null; interactions: number | null; followerGrowth: number | null };
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
  /** Altijd de vier vaste platforms, met per cijfer of het beschikbaar is. */
  platforms: PortalPlatformDetail[];
  series: PortalSeriesPoint[];
  /** Dagreeks per platform (alleen platforms met dagcijfers). */
  seriesByPlatform: Record<string, PortalSeriesPoint[]>;
  topVideos: PortalTopVideo[];
  /** Alle gepubliceerde video's uit de periode met hun cijfers, van veel → weinig weergaven (één regel per video). */
  allVideos: PortalTopVideo[];
  /** Dezelfde video's met de uitsplitsing per platform en afspeelgegevens. */
  videos: PortalVideo[];
  likes: number;
  comments: number;
  valuableInteractions: number;
  avgWatchSeconds: number;
  insight: string | null;
  insights: string[];
  milestone: PortalMilestone | null;
  lastUpdated: string | null;
  hasData: boolean;
  /** Kanalen waarop we voor deze klant publiceren (uit de contentplanning). */
  plannedPlatforms: string[];
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
        select count(distinct coalesce(deliverable_id, id))::int c from publications
        where client_id = ${clientId} and status = 'published' and published_at is not null
          and published_at::date between ${startIso} and ${endIso}
      ), pubprev as (
        select count(distinct coalesce(deliverable_id, id))::int c from publications
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
  let likes = n("clk");
  let comments = n("ccm");
  let valuableInteractions = n("csh") + n("csv");
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

  let hasData = metrics.views + metrics.reach + metrics.engagements + Math.abs(metrics.followerGrowth) > 0;

  // Per-platform (huidige + vorige periode), dagreeks per platform, video's en gekoppelde kanalen — parallel.
  const [platRes, seriesRes, allVideosRaw, linkedRes] = await Promise.all([
    db.execute(sql`
      select platform,
             (measured_on between ${startIso} and ${endIso}) cur,
             coalesce(sum(views),0)::int v, coalesce(sum(reach),0)::int r,
             coalesce(sum(engagements),0)::int e, coalesce(sum(follower_delta),0)::int f,
             coalesce(sum(likes),0)::int lk, coalesce(sum(comments),0)::int cm,
             coalesce(sum(shares),0)::int sh, coalesce(sum(saves),0)::int sv,
             count(distinct measured_on)::int days
      from daily_metrics
      where client_id = ${clientId} and platform is not null and measured_on between ${prevStartIso} and ${endIso}
      group by 1, 2
    `),
    db.execute(sql`
      select measured_on::text d, platform,
             coalesce(sum(views),0)::int v, coalesce(sum(reach),0)::int r,
             coalesce(sum(engagements),0)::int e, coalesce(sum(follower_delta),0)::int f,
             coalesce(sum(likes),0)::int lk
      from daily_metrics
      where client_id = ${clientId} and measured_on between ${prevStartIso} and ${endIso}
      group by measured_on, platform order by measured_on
    `),
    getPublishedVideoResults(clientId),
    db.execute(sql`
      select distinct lower(n) n from (
        select jsonb_array_elements_text(case when jsonb_typeof(ci.config->'networks') = 'array' then ci.config->'networks' else '[]'::jsonb end) n
        from client_integrations ci where ci.client_id = ${clientId} and ci.provider = 'metricool' and ci.is_active
        union all
        select distinct platform::text from daily_metrics where client_id = ${clientId} and platform is not null
      ) x
    `),
  ]);

  type PlatAgg = { v: number; r: number; e: number; f: number; lk: number; cm: number; sh: number; sv: number; days: number };
  const curDaily = new Map<string, PlatAgg>();
  const prevDaily = new Map<string, PlatAgg>();
  for (const p of rowsOf<Record<string, unknown>>(platRes)) {
    const agg: PlatAgg = { v: Number(p.v ?? 0), r: Number(p.r ?? 0), e: Number(p.e ?? 0), f: Number(p.f ?? 0), lk: Number(p.lk ?? 0), cm: Number(p.cm ?? 0), sh: Number(p.sh ?? 0), sv: Number(p.sv ?? 0), days: Number(p.days ?? 0) };
    (p.cur === true || p.cur === "t" ? curDaily : prevDaily).set(String(p.platform), agg);
  }
  const linked = new Set(rowsOf<{ n: string }>(linkedRes).map((r) => String(r.n)));
  const seriesRows = rowsOf<Record<string, unknown>>(seriesRes);

  // Vangnet: sommige TikTok-accounts leverden de oplopende totaalstand van likes
  // als "dagcijfer". De koppeling zet dat nu om, maar oudere rijen kunnen het nog
  // bevatten; dan rekenen we hier met het echte aantal per dag.
  for (const [map, from, to] of [[curDaily, startIso, endIso], [prevDaily, prevStartIso, prevEndIso]] as const) {
    for (const [plat, agg] of map) {
      const days = seriesRows.filter((r) => String(r.platform) === plat && String(r.d) >= from && String(r.d) <= to);
      for (const [key, col] of [["lk", "lk"], ["e", "e"]] as const) {
        const pts = days.map((r) => ({ date: String(r.d), value: Number(r[col] ?? 0) }));
        if (isCumulativeSeries(pts)) agg[key] = toDailySeries(pts).reduce((a, p) => a + p.value, 0);
      }
    }
  }

  // Video's die in de periode (of de vorige periode) geplaatst zijn.
  const inWindow = (d: string, a: string, b: string) => d >= a && d <= b;
  const videos = allVideosRaw.filter((v) => inWindow(v.publishedAt, startIso, endIso));
  const prevVideos = allVideosRaw.filter((v) => inWindow(v.publishedAt, prevStartIso, prevEndIso));
  const postsOn = (list: PortalVideo[], plat: string) => list.flatMap((v) => v.platforms.filter((p) => p.platform === plat));
  const sumOf = (ps: PortalVideo["platforms"], k: "views" | "likes" | "comments" | "shares" | "saves") => ps.reduce((a, p) => a + p[k], 0);

  // Welke platforms tonen: de vier vaste, plus eventueel een ander kanaal met cijfers.
  const platformKeys: string[] = [...RESULT_PLATFORMS];
  for (const k of [...curDaily.keys(), ...videos.flatMap((v) => v.platforms.map((p) => p.platform))]) if (!platformKeys.includes(k)) platformKeys.push(k);

  const pctOf = (c: number, p: number): number | null => (p > 0 ? Math.round(((c - p) / p) * 100) : null);
  const platforms: PortalPlatformDetail[] = platformKeys.map((plat) => {
    const d = curDaily.get(plat);
    const pd = prevDaily.get(plat);
    const posts = postsOn(videos, plat);
    const prevPosts = postsOn(prevVideos, plat);
    const postViews = sumOf(posts, "views");
    const dailyComparable = !!d && !!pd && pd.days >= Math.ceil(lenDays * 0.8);

    let views: number | null = null;
    let viewsFrom: PortalPlatformDetail["viewsFrom"] = null;
    if (d && d.v > 0) { views = d.v; viewsFrom = "kanaal"; }
    else if (postViews > 0) { views = postViews; viewsFrom = "video"; }
    else if (posts.length > 0 || d) { views = 0; viewsFrom = d ? "kanaal" : "video"; }

    // Per cijfer: dagcijfers van het kanaal als het platform die levert, anders de som per video.
    // Komen de weergaven uit de video's, dan ook de likes e.d. (één bron per platform).
    const pick = (daily: number | undefined, post: number, measured: boolean): number | null =>
      viewsFrom !== "video" && daily && daily > 0 ? daily : measured ? post : null;
    const measuredPosts = posts.length > 0;
    const likes = pick(d?.lk, sumOf(posts, "likes"), measuredPosts);
    const comments = pick(d?.cm, sumOf(posts, "comments"), measuredPosts);
    const shares = pick(d?.sh, sumOf(posts, "shares"), measuredPosts);
    const postInteractions = sumOf(posts, "likes") + sumOf(posts, "comments") + sumOf(posts, "shares") + sumOf(posts, "saves");
    // Interacties uit dezelfde bron als de weergaven, zodat de betrokkenheid klopt.
    // (Facebook levert account-interacties incl. advertenties, maar weergaven alleen per video.)
    const interactionsFromDaily = viewsFrom !== "video" && !!d && d.e > 0;
    const interactions = interactionsFromDaily ? d!.e : measuredPosts ? postInteractions : null;
    const reach = d && d.r > 0 ? d.r : null;
    const followerGrowth = d && d.days > 0 ? d.f : null;
    const engagementRate = views && views > 0 && interactions !== null ? Math.round((interactions / views) * 1000) / 10 : null;

    const prevViewsVal = viewsFrom === "kanaal" ? (pd?.v ?? null) : prevPosts.length ? sumOf(prevPosts, "views") : null;
    const prevInteractions = interactionsFromDaily ? (pd?.e ?? null) : null;
    const prevFollowers = pd && pd.days > 0 ? pd.f : null;

    const hasAny = (views ?? 0) > 0 || (interactions ?? 0) > 0 || (followerGrowth ?? 0) !== 0 || posts.length > 0 || (reach ?? 0) > 0;
    const state: PortalPlatformDetail["state"] = hasAny ? "data" : linked.has(plat) ? "stil" : "niet-gekoppeld";

    return {
      platform: plat,
      state,
      views,
      viewsFrom,
      reach,
      likes,
      comments,
      shares,
      interactions,
      engagementRate,
      followerGrowth,
      videoCount: posts.length,
      growth: {
        // Groei alleen op dagcijfers met een volledige vorige periode; video-sommen
        // zijn niet eerlijk te vergelijken (oudere video's hadden langer de tijd).
        views: viewsFrom === "kanaal" && dailyComparable && views !== null ? pctOf(views, pd!.v) : null,
        interactions: interactionsFromDaily && dailyComparable ? pctOf(d!.e, pd!.e) : null,
        // Bij een heel kleine basis (bv. 4 → 196) zegt een percentage niets.
        followerGrowth: dailyComparable && followerGrowth !== null && pd!.f >= 10 ? pctOf(followerGrowth, pd!.f) : null,
      },
      prev: { views: prevViewsVal, interactions: prevInteractions, followerGrowth: prevFollowers },
    };
  });

  // Weergaven van platforms zonder dagcijfers (bv. Facebook-reels) tellen mee via hun video's.
  const videoBasedViews = platforms.filter((p) => p.viewsFrom === "video").reduce((a, p) => a + (p.views ?? 0), 0);
  const prevVideoBasedViews = platforms.filter((p) => p.viewsFrom === "video").reduce((a, p) => a + (p.prev.views ?? 0), 0);
  if (videoBasedViews > 0) {
    const channelViews = metrics.views;
    metrics.views = channelViews + videoBasedViews;
    prev.views = prev.views + prevVideoBasedViews;
    // Alleen een groeipercentage als het overgrote deel uit vergelijkbare dagcijfers komt.
    deltas.views = videoBasedViews <= metrics.views * 0.25 ? pct(metrics.views, prev.views) : null;
  }

  // Interacties totaal: som van de (gecorrigeerde) platformcijfers.
  metrics.engagements = platforms.reduce((a, p) => a + (p.interactions ?? 0), 0);
  prev.engagements = platforms.reduce((a, p) => a + (p.prev.interactions ?? 0), 0);
  deltas.engagements = pct(metrics.engagements, prev.engagements);

  // Likes, reacties, shares en opgeslagen: per platform de beste beschikbare bron, opgeteld.
  likes = platforms.reduce((a, p) => a + (p.likes ?? 0), 0);
  comments = platforms.reduce((a, p) => a + (p.comments ?? 0), 0);
  valuableInteractions =
    platforms.reduce((a, p) => a + (p.shares ?? 0), 0) +
    platforms.reduce((a, p) => {
      const d = curDaily.get(p.platform);
      return a + (d && d.sv > 0 ? d.sv : sumOf(postsOn(videos, p.platform), "saves"));
    }, 0);

  const byPlatform: PortalPlatformResult[] = platforms
    .filter((p) => p.state === "data" && ((p.views ?? 0) > 0 || (p.reach ?? 0) > 0 || (p.interactions ?? 0) > 0))
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .map((p) => {
      const best = videos
        .flatMap((v) => v.platforms.filter((x) => x.platform === p.platform).map((x) => ({ v, x })))
        .sort((a, b) => b.x.views - a.x.views)[0];
      return {
        platform: p.platform,
        views: p.views ?? 0,
        reach: p.reach ?? 0,
        engagements: p.interactions ?? 0,
        followerGrowth: p.followerGrowth ?? 0,
        likes: p.likes ?? 0,
        videoCount: p.videoCount,
        bestVideo: best ? { title: best.v.title, views: best.x.views, url: best.x.url } : null,
      };
    });

  const seriesMap = new Map<string, PortalSeriesPoint>();
  const seriesByPlatform: Record<string, PortalSeriesPoint[]> = {};
  for (const s of seriesRows) {
    const date = String(s.d);
    if (date < startIso) continue;
    const pt = { views: Number(s.v ?? 0), reach: Number(s.r ?? 0), engagements: Number(s.e ?? 0), followers: Number(s.f ?? 0) };
    const tot = seriesMap.get(date) ?? { date, views: 0, reach: 0, engagements: 0, followers: 0 };
    tot.views += pt.views; tot.reach += pt.reach; tot.engagements += pt.engagements; tot.followers += pt.followers;
    seriesMap.set(date, tot);
    if (s.platform) (seriesByPlatform[String(s.platform)] ??= []).push({ date, ...pt });
  }
  const series: PortalSeriesPoint[] = [...seriesMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  if (!hasData && (videos.length > 0 || metrics.views > 0)) hasData = true;

  // Eén regel per video (samengevoegd over platforms), van veel → weinig weergaven.
  const toTopVideo = (v: PortalVideo): PortalTopVideo => ({
    id: v.key,
    title: v.title,
    platform: v.platforms[0]?.platform ?? "instagram",
    views: v.views,
    likes: v.likes,
    comments: v.comments,
    shares: v.shares,
    saves: v.saves,
    reach: v.reach,
    avgWatchSeconds: v.avgWatchSeconds,
    publishedAt: v.publishedAt,
    url: v.externalUrl,
    thumbnailUrl: v.thumbUrl,
  });
  const allVideos: PortalTopVideo[] = videos.map(toTopVideo);
  const topVideos: PortalTopVideo[] = allVideos.slice(0, 3);

  const plannedRes = await db.execute(sql`
    select distinct p from content_calendar cc, jsonb_array_elements_text(case when jsonb_typeof(cc.platforms) = 'array' then cc.platforms else '[]'::jsonb end) p
    where cc.client_id = ${clientId} and cc.deleted_at is null`);
  const plannedPlatforms = rowsOf<{ p: string }>(plannedRes).map((r) => String(r.p)).filter(Boolean);

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
    } else if (metrics.reach > 0) {
      insights.push(`Jullie content bereikte ${nf.format(metrics.reach)} mensen deze periode.`);
    }
    if (byPlatform.length >= 2) insights.push(`${PLATFORM_LABEL(byPlatform[0]!.platform)} is jullie grootste platform qua weergaven.`);
    if (videos[0] && videos[0].views > 0) {
      insights.push(`De best presterende video behaalde ${nf.format(videos[0].views)} weergaven${videos[0].platforms.length > 1 ? ` op ${videos[0].platforms.length} platforms samen` : ""}.`);
    }
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
    platforms,
    series,
    seriesByPlatform,
    topVideos,
    allVideos,
    videos,
    likes,
    comments,
    valuableInteractions,
    avgWatchSeconds,
    insight,
    insights: insights.slice(0, 4),
    milestone,
    lastUpdated,
    hasData,
    plannedPlatforms,
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

// Écht nog in bewerking (wij zijn bezig).
const IN_PRODUCTION_STATUSES = [
  "recorded", "footage_upload", "awaiting_editor", "editing", "internal_review",
  "editor_revision", "client_revision",
] as const;
// Klaar en wacht op publicatie — hoort in een aparte "Ingepland"-groep.
const SCHEDULED_STATUSES = ["approved", "ready_to_publish", "scheduled"] as const;

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

  const clean = rows.map((v) => ({
    ...v,
    title: cleanVideoTitle(v.title),
    // Opnamedag-kop ook opschonen (agenda-lek), met nette terugval.
    sessionTitle: v.sessionTitle ? cleanPlanningTitle(v.sessionTitle, { fallback: "Opnamedag" }) : v.sessionTitle,
  }));

  // Gepubliceerd: één kaart per video. Frame levert per video meerdere bestanden
  // (9:16/4:5/1:1, .mov/.mp4) die naar dezelfde schone titel opschonen — die
  // vouwen we samen (nieuwste eerst, want gesorteerd op publishedAt). Afgeleide
  // code-titels (bv. "KKFH") vouwen we bewust NIET samen.
  const gepubliceerd = dedupByTitle(clean.filter((v) => v.status === "published"));

  // Ingepland sorteren op geplande publicatiedatum (vroegste eerst); items zonder
  // datum achteraan.
  const ingepland = clean
    .filter((v) => (SCHEDULED_STATUSES as readonly string[]).includes(v.status))
    .sort((a, b) => (a.plannedPublishOn ?? "9999").localeCompare(b.plannedPublishOn ?? "9999"));

  return {
    actieNodig: clean.filter((v) => v.status === "client_review"),
    inProductie: clean.filter((v) => (IN_PRODUCTION_STATUSES as readonly string[]).includes(v.status)),
    ingepland,
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
  contract: { startsOn: string | null; endsOn: string | null; noticePeriodDays: number } | null;
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
    .orderBy(sql`${contracts.startsOn} desc nulls last`, desc(contracts.createdAt))
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

export type PortalPackageProgress = {
  quota: number;
  onlineThisMonth: number;
  remaining: number;
  monthLabel: string;
};

/**
 * Pakketteller: hoeveel video's er deze maand al online staan t.o.v. het
 * afgesproken aantal per maand, en hoeveel er nog komen. Beantwoordt de
 * veelgestelde vraag "hoeveel video's hebben we nog?". Null als er geen
 * maandafspraak is.
 */
export async function getPortalPackageProgress(viewer: Viewer): Promise<PortalPackageProgress | null> {
  const clientId = viewer.clientId;
  if (!clientId) return null;
  const [c] = await db
    .select({ quota: clients.monthlyVideoQuota })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  const quota = Number(c?.quota ?? 0);
  if (quota <= 0) return null;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deliverables)
    .where(and(
      eq(deliverables.clientId, clientId),
      isNull(deliverables.deletedAt),
      eq(deliverables.status, "published"),
      sql`${deliverables.publishedAt} >= date_trunc('month', now())`,
    ));
  const onlineThisMonth = Number(row?.n ?? 0);
  const monthLabel = new Date().toLocaleDateString("nl-NL", { month: "long", timeZone: "Europe/Amsterdam" });
  return { quota, onlineThisMonth, remaining: Math.max(0, quota - onlineThisMonth), monthLabel };
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
  contract: { startsOn: string | null; endsOn: string | null; noticePeriodDays: number } | null;
  stats: { shortsProduced: number; opnamesDone: number };
  clientContacts: Array<{ name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean }>;
  /** "organisch" | "advertentie" | "combinatie" of null (niet vastgelegd). */
  contentFocus: string | null;
  weHandlePosting: boolean;
  /** Afgesproken minimale looptijd in maanden (klantdossier), of null. */
  contractMonths: number | null;
};

/**
 * Lichte branding van de klant achter dit portaal: naam, logo en merkkleur —
 * voor de header (logo i.p.v. persoons-initialen). Valt terug op de naam van de
 * gebruiker als er (nog) geen klant aan hangt.
 */
export async function getPortalBranding(viewer: Viewer): Promise<{ name: string; logoUrl: string | null; color: string | null }> {
  const clientId = viewer.clientId;
  if (!clientId) return { name: viewer.fullName, logoUrl: null, color: null };
  const [c] = await db
    .select({ name: clients.name, logoUrl: clients.logoUrl, color: clients.color })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  return c ?? { name: viewer.fullName, logoUrl: null, color: null };
}

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
    .select({ name: clients.name, legalName: clients.legalName, logoUrl: clients.logoUrl, color: clients.color, sector: clients.sector, website: clients.website, description: clients.description, contentFocus: clients.contentFocus, weHandlePosting: clients.weHandlePosting, contractMonths: clients.contractMonths })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) notFound();
  const { contentFocus, weHandlePosting, contractMonths, ...company } = client;

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
    company,
    contentFocus: contentFocus ?? null,
    weHandlePosting,
    contractMonths: contractMonths ?? null,
    // Eén bron voor "sinds": de effectieve startdatum (contractstart, met
    // terugval op clients.startedOn) — zodat de hero, het statblok en de looptijd
    // dezelfde datum tonen i.p.v. een leeg "sinds"-veld.
    startedOn: startIso,
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
      coordinatorRole: users.primaryRole,
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

  // De interne rol naar een klantvriendelijke functietitel vertalen.
  const CONTACT_ROLE: Record<string, string> = {
    operational_manager: "Content Strategist",
    project_coordinator: "Content Strategist",
    content_creator: "Content Creative",
    owner: "Vaste contactpersoon",
  };

  return {
    clientName: client?.name ?? "",
    coordinator: client?.coordinatorName
      ? {
          name: client.coordinatorName,
          role: CONTACT_ROLE[client.coordinatorRole ?? ""] ?? "Vaste contactpersoon",
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
