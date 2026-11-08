import "server-only";
import { and, asc, between, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  contentCalendar,
  deliverables,
  frameAssets,
  productionDays,
  publications,
  scriptReviews,
  scriptReviewVersions,
} from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { getPortalSettingsForClient } from "@/server/portal-settings";
import { amsterdamDay } from "@/lib/client-feedback";
import { nlHolidaySet } from "@/lib/holidays";
import { deriveClientRoadmap, type ClientInput, type ClientRoadmap, type SessionInput } from "@/lib/client-roadmap";

/**
 * Laadt de bestaande productiegegevens van één klant en zet ze om in de
 * klantroadmap (zie lib/client-roadmap.ts). Leest alleen; schrijft niets weg.
 * Er is dus geen tweede planning die het team moet bijhouden.
 */

/** Venster: lopende sessies (tot 90 dagen terug) en de komende 120 dagen. */
const BACK_DAYS = 90;
const AHEAD_DAYS = 120;

/** Per sessie de editingregel die voor de klant het meest zegt (zelfde volgorde
 *  als de videopagina, zodat beide schermen hetzelfde vertellen). */
const RANK = ["client_review", "client_revision", "editing", "internal_review", "editor_revision", "awaiting_editor", "footage_upload", "recorded", "approved", "ready_to_publish", "scheduled", "published", "analysis_available"];

function isoShift(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getClientRoadmapFor(clientId: string): Promise<ClientRoadmap> {
  const today = amsterdamDay(new Date());

  const [client] = await db
    .select({ status: clients.status, weHandlePosting: clients.weHandlePosting })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);

  const settings = await getPortalSettingsForClient(clientId);
  const holidays = nlHolidaySet();

  const days = await db
    .select({
      id: productionDays.id,
      shootOn: productionDays.scheduledOn,
      startTime: productionDays.startTime,
      locationName: productionDays.locationName,
      dayStatus: productionDays.status,
      scriptingStatus: productionDays.scriptingStatus,
    })
    .from(productionDays)
    .where(and(
      eq(productionDays.clientId, clientId),
      isNull(productionDays.deletedAt),
      ne(productionDays.status, "cancelled"),
      between(productionDays.scheduledOn, isoShift(today, -BACK_DAYS), isoShift(today, AHEAD_DAYS)),
    ))
    .orderBy(asc(productionDays.scheduledOn));

  const dayIds = days.map((d) => d.id);

  const [reviews, dels, frame, nextPlanned, plannedCount, confirmed] = await Promise.all([
    dayIds.length
      ? db
          .select({
            id: scriptReviews.id,
            dayId: scriptReviews.productionDayId,
            status: scriptReviews.status,
            feedbackDeadline: scriptReviews.feedbackDeadline,
            updatedAt: scriptReviews.updatedAt,
            sentAt: sql<Date | null>`(select max(v.created_at) from ${scriptReviewVersions} v where v.review_id = ${scriptReviews.id})`,
          })
          .from(scriptReviews)
          .where(and(eq(scriptReviews.clientId, clientId), isNull(scriptReviews.deletedAt), inArray(scriptReviews.productionDayId, dayIds)))
          .orderBy(desc(scriptReviews.updatedAt))
      : Promise.resolve([]),
    dayIds.length
      ? db
          .select({
            dayId: deliverables.productionDayId,
            status: deliverables.status,
            statusChangedAt: deliverables.statusChangedAt,
            dueOn: deliverables.dueOn,
            dueOnSource: deliverables.dueOnSource,
          })
          .from(deliverables)
          .where(and(eq(deliverables.clientId, clientId), isNull(deliverables.deletedAt), inArray(deliverables.productionDayId, dayIds)))
      : Promise.resolve([]),
    dayIds.length
      ? db
          .select({
            dayId: frameAssets.sessionProductionDayId,
            folder: frameAssets.sessionFolderId,
            n: sql<number>`count(*)::int`,
          })
          .from(frameAssets)
          .where(and(eq(frameAssets.clientId, clientId), isNull(frameAssets.deletedAt), inArray(frameAssets.sessionProductionDayId, dayIds)))
          .groupBy(frameAssets.sessionProductionDayId, frameAssets.sessionFolderId)
      : Promise.resolve([]),
    // Planning: alleen wat met de klant gedeeld/goedgekeurd is en nog moet komen.
    db
      .select({ on: contentCalendar.scheduledOn })
      .from(contentCalendar)
      .where(and(
        eq(contentCalendar.clientId, clientId),
        isNull(contentCalendar.deletedAt),
        eq(contentCalendar.clientApproved, true),
        gte(contentCalendar.scheduledOn, today),
        ne(contentCalendar.status, "failed"),
      ))
      .orderBy(asc(contentCalendar.scheduledOn))
      .limit(1),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(contentCalendar)
      .where(and(
        eq(contentCalendar.clientId, clientId),
        isNull(contentCalendar.deletedAt),
        eq(contentCalendar.clientApproved, true),
        gte(contentCalendar.scheduledOn, today),
        ne(contentCalendar.status, "failed"),
      )),
    // Bevestigd online = een post met tijdstip uit de koppeling (Metricool).
    // Een verstreken plandatum telt hier bewust NIET als publicatie.
    db
      .select({
        last: sql<Date | null>`max(${publications.publishedAt})`,
        n30: sql<number>`count(*) filter (where ${publications.publishedAt} >= now() - interval '30 days')::int`,
      })
      .from(publications)
      .where(and(
        eq(publications.clientId, clientId),
        isNull(publications.deletedAt),
        eq(publications.status, "published"),
        isNotNull(publications.publishedAt),
      )),
  ]);

  const reviewByDay = new Map<string, (typeof reviews)[number]>();
  for (const r of reviews) if (r.dayId && !reviewByDay.has(r.dayId)) reviewByDay.set(r.dayId, r);

  const delByDay = new Map<string, (typeof dels)[number]>();
  for (const d of dels) {
    if (!d.dayId) continue;
    const cur = delByDay.get(d.dayId);
    if (!cur || RANK.indexOf(d.status) < RANK.indexOf(cur.status)) delByDay.set(d.dayId, d);
  }

  const frameByDay = new Map<string, { count: number; folder: string | null; best: number }>();
  for (const f of frame) {
    if (!f.dayId) continue;
    const n = Number(f.n ?? 0);
    const cur = frameByDay.get(f.dayId) ?? { count: 0, folder: null, best: 0 };
    cur.count += n;
    if (n > cur.best) { cur.best = n; cur.folder = f.folder; }
    frameByDay.set(f.dayId, cur);
  }

  const toIso = (v: Date | string | null | undefined): string | null => (v ? new Date(v).toISOString() : null);

  const sessions: SessionInput[] = days.map((d) => {
    const r = reviewByDay.get(d.id);
    const e = delByDay.get(d.id);
    const f = frameByDay.get(d.id);
    return {
      id: d.id,
      shootOn: String(d.shootOn).slice(0, 10),
      startTime: d.startTime,
      locationName: d.locationName,
      dayStatus: d.dayStatus,
      scriptingStatus: d.scriptingStatus,
      scriptReview: r
        ? { id: r.id, status: r.status, feedbackDeadline: toIso(r.feedbackDeadline), sentAt: toIso(r.sentAt) ?? toIso(r.updatedAt) }
        : null,
      edit: e
        ? { status: e.status, statusChangedAt: toIso(e.statusChangedAt)!, dueOn: e.dueOn ? String(e.dueOn).slice(0, 10) : null, dueOnSource: e.dueOnSource }
        : null,
      videoCount: f?.count ?? 0,
      frameSessionKey: f?.folder ?? null,
    };
  });

  const conf = confirmed[0];
  const input: ClientInput = {
    clientStatus: client?.status ?? "churned",
    weHandlePosting: client?.weHandlePosting ?? true,
    today,
    feedbackDaysScripts: settings.feedbackDaysScripts,
    feedbackDaysVideos: settings.feedbackDaysVideos,
    deliveryWorkdays: settings.deliveryWorkdays,
    holidays,
    nextPlannedOn: nextPlanned[0]?.on ? String(nextPlanned[0].on).slice(0, 10) : null,
    plannedCount: Number(plannedCount[0]?.n ?? 0),
    lastConfirmedOn: conf?.last ? amsterdamDay(conf.last) : null,
    confirmedLast30: Number(conf?.n30 ?? 0),
  };

  return deriveClientRoadmap(sessions, input);
}

/** Klantportaal: altijd hard gescoped op de klant van de ingelogde gebruiker. */
export async function getPortalRoadmap(viewer: Viewer): Promise<ClientRoadmap | null> {
  if (!viewer.clientId) return null;
  const roadmap = await getClientRoadmapFor(viewer.clientId);
  // Interne controlepunten gaan nooit mee naar de klant.
  return { ...roadmap, issues: [] };
}
