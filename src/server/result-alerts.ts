import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings, resultAlerts } from "@/db/schema";
import { CORE_STAFF_EMAILS, coreStaffRank } from "@/server/core-staff";
import { hasClientAccess, type Viewer } from "@/server/auth/context";
import { ACTIVE_STATUSES, loadClientMemory } from "@/server/content-memory";
import { notify } from "@/server/notifications";
import {
  analyzeClient,
  measureEffect,
  type AlertDraft,
  type AlertGroup,
  type AlertVideo,
  type Cause,
  type Effect,
  type Finding,
  type Level,
  type MemoryInsight,
  type Snapshot,
} from "@/lib/result-alerts";

/**
 * Klanten die aandacht nodig hebben: detectie, opslag en effectmeting.
 *
 * Draait dagelijks na de Metricool- en Contentgeheugen-updates (cron
 * `result_alerts.detect`) en op verzoek via de knop op de Resultatenpagina.
 * Volledig idempotent: één lopende alert per klant per soort (unieke index),
 * een verdwenen signaal laat een niet-opgepakte alert vanzelf vervallen, en een
 * afgehandelde situatie levert pas een nieuwe alert op als de nieuwe video's
 * ná de afhandeling opnieuw achterblijven.
 */

const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const n = (v: unknown) => Number(v ?? 0) || 0;

export const LAST_RUN_KEY = "result_alerts.last_run";
/** Een vervallen alert komt niet binnen een week terug (geen geflikker rond een grens). */
const VERVALLEN_COOLDOWN_DAYS = 7;
/** Effect blijven meten tot er genoeg video's zijn of deze termijn verstreken is. */
const EFFECT_FINAL_VIDEOS = 6;
const EFFECT_WINDOW_DAYS = 90;

export type AlertAnalysis = {
  findings: Finding[];
  causes: Cause[];
  advice: string;
  /** Korte actie voor de lijst (ontbreekt bij alerts van vóór deze versie). */
  adviceShort?: string;
  actions: string[];
  memory: MemoryInsight[];
  /** Het signaal is inmiddels niet meer zichtbaar in de data (alert blijft staan tot afhandeling). */
  signalGone?: boolean;
};

export type LastRun = {
  at: string;
  analyzed: number;
  insufficient: Array<{ clientId: string; name: string; slug: string; reason: string }>;
};

/* ------------------------------------------------------------------ *
 * Detectie
 * ------------------------------------------------------------------ */

function toAlertInput(cm: NonNullable<Awaited<ReturnType<typeof loadClientMemory>>>) {
  const m = cm.memory;
  const group = (g: (typeof m.formats)[number]): AlertGroup => ({
    dimension: g.dimension,
    label: g.label,
    n: g.n,
    medianPerf: g.medianPerf,
    verdict: g.verdict,
    evidence: g.evidence,
    trend: g.trend,
    examples: g.examples.map((e) => ({ hook: e.hook, title: e.title, ctaText: e.ctaText })),
  });
  const videos: AlertVideo[] = m.all.map((v) => ({
    id: v.id,
    platform: v.platform,
    publishedOn: v.publishedOn,
    title: v.title,
    hook: v.hook,
    hookTypes: v.hookTypes,
    cta: v.cta,
    ctaText: v.ctaText,
    format: v.format,
    durationSeconds: v.durationSeconds,
    views: v.views,
    interactions: v.interactions,
    retention: v.retention,
    viewScore: v.viewScore,
    engScore: v.engScore,
    perf: v.perf,
  }));
  return {
    videos,
    formats: m.formats.map(group),
    hooks: m.hooks.map(group),
    ctas: m.ctas.map(group),
    lengths: m.lengths.map(group),
    publicationCount: m.publicationCount,
  };
}

async function loadSideMetrics(): Promise<{
  followers: Map<string, { cur: number; prev: number; days: number }>;
  posts: Map<string, { cur: number; prev: number }>;
}> {
  const [fRes, pRes] = await Promise.all([
    db.execute(sql`
      select client_id as "clientId",
        coalesce(sum(follower_delta) filter (where measured_on >= current_date - 30), 0)::bigint as cur,
        coalesce(sum(follower_delta) filter (where measured_on < current_date - 30), 0)::bigint as prev,
        count(distinct measured_on)::int as days
      from daily_metrics
      where measured_on >= current_date - 60 and measured_on < current_date
      group by client_id`),
    db.execute(sql`
      select client_id as "clientId",
        count(*) filter (where published_at >= now() - interval '30 days')::int as cur,
        count(*) filter (where published_at < now() - interval '30 days')::int as prev
      from publications
      where deleted_at is null and status = 'published' and published_at >= now() - interval '60 days'
      group by client_id`),
  ]);
  return {
    followers: new Map(rowsOf<{ clientId: string; cur: string; prev: string; days: number }>(fRes).map((r) => [r.clientId, { cur: n(r.cur), prev: n(r.prev), days: n(r.days) }])),
    posts: new Map(rowsOf<{ clientId: string; cur: number; prev: number }>(pRes).map((r) => [r.clientId, { cur: n(r.cur), prev: n(r.prev) }])),
  };
}

type ActiveRow = typeof resultAlerts.$inferSelect;

/**
 * Analyseert alle actieve klanten en werkt de alerts bij.
 * Geeft terug wat er gebeurde (voor het joblogboek en de knop).
 */
export async function runResultAlerts(opts: { budgetMs?: number } = {}): Promise<{
  analyzed: number; created: number; updated: number; expired: number; insufficient: number; effects: number; notified: number;
}> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 240_000;
  const clientRes = await db.execute(sql`
    select id, name, slug, coordinator_id as "coordinatorId"
    from clients where deleted_at is null and status::text in (${sql.join(ACTIVE_STATUSES.map((s) => sql`${s}`), sql`, `)})
    order by name`);
  const clientList = rowsOf<{ id: string; name: string; slug: string; coordinatorId: string | null }>(clientRes);
  const side = await loadSideMetrics();

  const existing = await db.select().from(resultAlerts).where(inArray(resultAlerts.status, ["open", "actie"]));
  const activeByKey = new Map(existing.map((r) => [`${r.clientId}:${r.kind}`, r]));
  // Laatst afgesloten alert per klant/soort (voor de herhaalregel).
  const closedRes = await db.execute(sql`
    select distinct on (client_id, kind) client_id as "clientId", kind, status,
      coalesce(resolved_at, updated_at) as "closedAt"
    from result_alerts where status in ('opgelost','afgehandeld','vervallen')
    order by client_id, kind, coalesce(resolved_at, updated_at) desc`);
  const lastClosed = new Map(rowsOf<{ clientId: string; kind: string; status: string; closedAt: string | Date }>(closedRes).map((r) => [`${r.clientId}:${r.kind}`, { status: r.status, at: new Date(r.closedAt) }]));

  const out = { analyzed: 0, created: 0, updated: 0, expired: 0, insufficient: 0, effects: 0, notified: 0 };
  const insufficient: LastRun["insufficient"] = [];
  const toNotify = new Map<string, Array<{ name: string; headline: string }>>();
  const now = new Date();

  for (const c of clientList) {
    if (Date.now() - started > budget) break;
    const cm = await loadClientMemory(c.id).catch(() => null);
    if (!cm) continue;
    const base = toAlertInput(cm);
    const f = side.followers.get(c.id);
    const analysis = analyzeClient({
      ...base,
      // Volgersgroei alleen als er over beide periodes echt metingen zijn.
      followers: f && f.days >= 45 ? { cur: f.cur, prev: f.prev } : null,
      posts: side.posts.get(c.id) ?? { cur: 0, prev: 0 },
      now,
    });
    out.analyzed++;

    if (analysis.status === "onvoldoende") {
      out.insufficient++;
      insufficient.push({ clientId: c.id, name: c.name, slug: c.slug, reason: analysis.reason });
    }

    for (const kind of ["negatief", "positief"] as const) {
      const draft = analysis.status === "ok" ? (kind === "negatief" ? analysis.negative : analysis.positive) : null;
      const key = `${c.id}:${kind}`;
      const active = activeByKey.get(key);

      if (active) {
        if (draft) {
          await updateActive(active, draft);
          out.updated++;
          if (draft.level === "rood" && active.notifiedLevel !== "rood") queueNotify(toNotify, active.assigneeId ?? c.coordinatorId, c.name, draft.headline, active.id);
        } else if (active.status === "open") {
          await db.update(resultAlerts).set({ status: "vervallen", updatedAt: now }).where(eq(resultAlerts.id, active.id));
          out.expired++;
        } else {
          // Opgepakt (taak loopt): blijft staan tot iemand het bewust afhandelt.
          const a = (active.analysis ?? {}) as AlertAnalysis;
          if (!a.signalGone) await db.update(resultAlerts).set({ analysis: { ...a, signalGone: true }, updatedAt: now }).where(eq(resultAlerts.id, active.id));
        }
        continue;
      }
      if (!draft) continue;

      // Herhaalregel: geen nieuwe alert voor een situatie die net is afgehandeld.
      const closed = lastClosed.get(key);
      if (closed) {
        const ageDays = (now.getTime() - closed.at.getTime()) / 86_400_000;
        if (closed.status === "vervallen" && ageDays < VERVALLEN_COOLDOWN_DAYS) continue;
        if (closed.status !== "vervallen") {
          // Alleen opnieuw als het hele recente venster ná de afhandeling is gepubliceerd.
          const closedDay = closed.at.toISOString().slice(0, 10);
          const recentFrom = minRecentFrom(analysis.status === "ok" ? analysis.stats : [], draft.platforms);
          if (!recentFrom || recentFrom <= closedDay) continue;
        }
      }

      const inserted = await db
        .insert(resultAlerts)
        .values({
          clientId: c.id,
          kind,
          level: draft.level,
          status: "open",
          headline: draft.headline.slice(0, 200),
          analysis: analysisOf(draft),
          platforms: draft.platforms,
          snapshot: draft.snapshot,
          assigneeId: c.coordinatorId,
          firstDetectedAt: now,
          lastDetectedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: resultAlerts.id });
      if (inserted[0]) {
        out.created++;
        if (draft.level === "rood") queueNotify(toNotify, c.coordinatorId, c.name, draft.headline, inserted[0].id);
      }
    }

    // Effectmeting voor opgepakte en opgeloste alerts van deze klant.
    out.effects += await measureClientEffects(c.id, base.videos, now);
  }

  out.notified = await sendBundledNotifications(toNotify, now);

  const lastRun: LastRun = { at: now.toISOString(), analyzed: out.analyzed, insufficient };
  await db
    .insert(appSettings)
    .values({ key: LAST_RUN_KEY, value: lastRun, category: "resultaten", description: "Laatste analyse Klanten die aandacht nodig hebben" })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: lastRun, updatedAt: now } });

  return out;
}

function analysisOf(d: AlertDraft): AlertAnalysis {
  return { findings: d.findings, causes: d.causes, advice: d.advice, adviceShort: d.adviceShort, actions: d.actions, memory: d.memory };
}

async function updateActive(active: ActiveRow, draft: AlertDraft) {
  const patch: Partial<typeof resultAlerts.$inferInsert> = {
    level: draft.level,
    headline: draft.headline.slice(0, 200),
    analysis: analysisOf(draft),
    platforms: draft.platforms,
    lastDetectedAt: new Date(),
    updatedAt: new Date(),
  };
  // Zolang niemand het heeft opgepakt volgt het startniveau de actuele situatie;
  // na het aanmaken van een actie ligt het vast voor de effectmeting.
  if (active.status === "open") patch.snapshot = draft.snapshot;
  await db.update(resultAlerts).set(patch).where(eq(resultAlerts.id, active.id));
}

function minRecentFrom(stats: Array<{ platform: string; recentFrom: string | null }>, platforms: string[]): string | null {
  const ds = stats.filter((s) => !platforms.length || platforms.includes(s.platform)).map((s) => s.recentFrom).filter((d): d is string => !!d).sort();
  return ds[0] ?? null;
}

function queueNotify(map: Map<string, Array<{ name: string; headline: string }>>, userId: string | null, name: string, headline: string, alertId: string) {
  void alertId;
  if (!userId) return;
  map.set(userId, [...(map.get(userId) ?? []), { name, headline }]);
}

/** Eén gebundelde melding per medewerker per dag, alleen voor nieuwe of verergerde rode alerts. */
async function sendBundledNotifications(map: Map<string, Array<{ name: string; headline: string }>>, now: Date): Promise<number> {
  let sent = 0;
  const day = now.toISOString().slice(0, 10);
  for (const [userId, items] of map) {
    const k = items.length;
    sent += await notify({
      userIds: [userId],
      type: "result_alert",
      level: "warning",
      title: k === 1 ? `${items[0].name} heeft direct aandacht nodig` : `${k} klanten hebben direct aandacht nodig`,
      body: items.map((i) => `${i.name}: ${i.headline}`).join(" · ").slice(0, 300),
      href: "/analytics#aandacht",
      entityType: "result_alerts",
      dedupeKey: `result_alerts:${userId}:${day}`,
    });
  }
  if (map.size) {
    await db
      .update(resultAlerts)
      .set({ notifiedAt: now, notifiedLevel: "rood" })
      .where(and(inArray(resultAlerts.status, ["open", "actie"]), eq(resultAlerts.level, "rood")));
  }
  return sent;
}

async function measureClientEffects(clientId: string, videos: AlertVideo[], now: Date): Promise<number> {
  const rows = await db
    .select({ id: resultAlerts.id, snapshot: resultAlerts.snapshot, platforms: resultAlerts.platforms, actionAt: resultAlerts.actionAt, effect: resultAlerts.effect, kind: resultAlerts.kind })
    .from(resultAlerts)
    .where(and(eq(resultAlerts.clientId, clientId), inArray(resultAlerts.status, ["actie", "opgelost"]), sql`${resultAlerts.actionAt} is not null`, sql`${resultAlerts.actionAt} > now() - make_interval(days => ${EFFECT_WINDOW_DAYS})`));
  let updated = 0;
  for (const r of rows) {
    if (r.kind !== "negatief") continue;
    const prev = r.effect as Effect | null;
    if (prev && prev.status === "gemeten" && prev.videosAfter >= EFFECT_FINAL_VIDEOS) continue;
    const snap = r.snapshot as Snapshot;
    if (!snap?.platforms?.length) continue;
    const effect = measureEffect(videos, snap, r.platforms ?? [], new Date(r.actionAt!), now);
    await db.update(resultAlerts).set({ effect, updatedAt: now }).where(eq(resultAlerts.id, r.id));
    updated++;
  }
  return updated;
}

/* ------------------------------------------------------------------ *
 * Lezen voor de pagina's
 * ------------------------------------------------------------------ */

export type AlertCard = {
  id: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  logoUrl: string | null;
  color: string | null;
  kind: "negatief" | "positief";
  level: Level;
  status: "open" | "actie" | "opgelost" | "afgehandeld";
  headline: string;
  analysis: AlertAnalysis;
  platforms: string[];
  assigneeId: string | null;
  assigneeName: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  actionAt: string | null;
  actionText: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  effect: Effect | null;
  task: { id: string; title: string; status: string; dueOn: string | null; assigneeId: string | null; assigneeName: string | null } | null;
};

export type StaffOption = { id: string; name: string };

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export async function listResultAlerts(viewer: Viewer): Promise<{ active: AlertCard[]; closed: AlertCard[]; lastRun: LastRun | null; staff: StaffOption[] }> {
  const res = await db.execute(sql`
    select a.*, c.name as client_name, c.slug as client_slug, c.logo_url, c.color,
      ua.full_name as assignee_name, ur.full_name as resolved_by_name,
      t.id as t_id, t.title as t_title, t.status::text as t_status, t.due_on::text as t_due, t.assignee_id as t_assignee, ut.full_name as t_assignee_name
    from result_alerts a
    join clients c on c.id = a.client_id and c.deleted_at is null
    left join users ua on ua.id = a.assignee_id
    left join users ur on ur.id = a.resolved_by_id
    left join tasks t on t.id = a.task_id and t.deleted_at is null
    left join users ut on ut.id = t.assignee_id
    where a.status in ('open','actie')
       or (a.status in ('opgelost','afgehandeld') and a.resolved_at > now() - interval '120 days')
    order by a.first_detected_at desc`);
  type R = Record<string, unknown>;
  const cards: AlertCard[] = rowsOf<R>(res)
    .filter((r) => hasClientAccess(viewer, String(r.client_id)))
    .map((r) => ({
      id: String(r.id),
      clientId: String(r.client_id),
      clientName: String(r.client_name),
      clientSlug: String(r.client_slug),
      logoUrl: (r.logo_url as string | null) ?? null,
      color: (r.color as string | null) ?? null,
      kind: r.kind as AlertCard["kind"],
      level: r.level as Level,
      status: r.status as AlertCard["status"],
      headline: String(r.headline),
      analysis: (r.analysis ?? { findings: [], causes: [], advice: "", actions: [], memory: [] }) as AlertAnalysis,
      platforms: (r.platforms as string[]) ?? [],
      assigneeId: (r.assignee_id as string | null) ?? null,
      assigneeName: (r.assignee_name as string | null) ?? null,
      firstDetectedAt: iso(r.first_detected_at as string)!,
      lastDetectedAt: iso(r.last_detected_at as string)!,
      actionAt: iso(r.action_at as string | null),
      actionText: (r.action_text as string | null) ?? null,
      resolvedAt: iso(r.resolved_at as string | null),
      resolvedByName: (r.resolved_by_name as string | null) ?? null,
      resolutionNote: (r.resolution_note as string | null) ?? null,
      effect: (r.effect as Effect | null) ?? null,
      task: r.t_id
        ? { id: String(r.t_id), title: String(r.t_title), status: String(r.t_status), dueOn: (r.t_due as string | null) ?? null, assigneeId: (r.t_assignee as string | null) ?? null, assigneeName: (r.t_assignee_name as string | null) ?? null }
        : null,
    }));

  const rankLevel = (l: Level) => (l === "rood" ? 0 : l === "oranje" ? 1 : 2);
  const active = cards
    .filter((c) => c.status === "open" || c.status === "actie")
    .sort((a, b) => rankLevel(a.level) - rankLevel(b.level) || (a.status === b.status ? 0 : a.status === "open" ? -1 : 1) || a.firstDetectedAt.localeCompare(b.firstDetectedAt));
  const closed = cards.filter((c) => c.status === "opgelost" || c.status === "afgehandeld").sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));

  const [setting] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LAST_RUN_KEY)).limit(1);
  const lastRun = (setting?.value as LastRun | undefined) ?? null;
  if (lastRun) lastRun.insufficient = lastRun.insufficient.filter((i) => hasClientAccess(viewer, i.clientId));

  return { active, closed, lastRun, staff: await listStaffOptions() };
}

/** Het kernteam als keuzelijst voor "Actie aanmaken" (Jarno, Milou, Jiska, Rutger). */
export async function listStaffOptions(): Promise<StaffOption[]> {
  const res = await db.execute(sql`
    select id, full_name as name, lower(email) as email from users
    where deleted_at is null and status = 'active' and lower(email) in (${sql.join(CORE_STAFF_EMAILS.map((e) => sql`${e}`), sql`, `)})`);
  return rowsOf<{ id: string; name: string; email: string }>(res)
    .sort((a, b) => coreStaffRank(a.email) - coreStaffRank(b.email))
    .map((r) => ({ id: r.id, name: r.name }));
}

/** Compact voor het dashboard: lopende rode alerts (eigen klanten, of alles voor de eigenaar). */
export async function urgentAlertsForDashboard(viewer: Viewer, opts: { all: boolean }): Promise<Array<{ id: string; clientName: string; clientSlug: string; logoUrl: string | null; color: string | null; headline: string; status: string; assigneeName: string | null }>> {
  const res = await db.execute(sql`
    select a.id, a.headline, a.status, a.assignee_id, a.client_id, c.name, c.slug, c.logo_url, c.color, u.full_name as assignee_name
    from result_alerts a
    join clients c on c.id = a.client_id and c.deleted_at is null
    left join users u on u.id = a.assignee_id
    where a.status in ('open','actie') and a.level = 'rood'
    order by a.first_detected_at`);
  return rowsOf<Record<string, unknown>>(res)
    .filter((r) => hasClientAccess(viewer, String(r.client_id)) && (opts.all || r.assignee_id === viewer.id))
    .map((r) => ({
      id: String(r.id),
      clientName: String(r.name),
      clientSlug: String(r.slug),
      logoUrl: (r.logo_url as string | null) ?? null,
      color: (r.color as string | null) ?? null,
      headline: String(r.headline),
      status: String(r.status),
      assigneeName: (r.assignee_name as string | null) ?? null,
    }));
}

/** Voor de Scriptingpagina: lopende advies per klant, zodat het bij nieuwe scripts gebruikt wordt. */
export async function scriptingAdviceByClient(viewer: Viewer): Promise<Array<{ clientId: string; clientName: string; clientSlug: string; level: Level; headline: string; advice: string; hooks: string[] }>> {
  const res = await db.execute(sql`
    select a.client_id, a.level, a.headline, a.analysis, c.name, c.slug
    from result_alerts a join clients c on c.id = a.client_id and c.deleted_at is null
    where a.status in ('open','actie') and a.kind = 'negatief'
    order by case a.level when 'rood' then 0 else 1 end, c.name`);
  return rowsOf<Record<string, unknown>>(res)
    .filter((r) => hasClientAccess(viewer, String(r.client_id)))
    .map((r) => {
      const a = (r.analysis ?? {}) as AlertAnalysis;
      return {
        clientId: String(r.client_id),
        clientName: String(r.name),
        clientSlug: String(r.slug),
        level: r.level as Level,
        headline: String(r.headline),
        advice: a.advice ?? "",
        hooks: a.memory?.find((m) => m.key === "hooks")?.items.slice(0, 2) ?? [],
      };
    });
}
