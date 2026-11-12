import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { assertClientAccess, type Viewer } from "@/server/auth/context";
import {
  analyzePerformance,
  normalizeText,
  type PerformanceInsights,
  type PubInput,
} from "@/server/scripts/performance-analysis";

/**
 * Leert van wat ECHT presteerde bij deze klant, rechtstreeks uit de Metricool-
 * metingen (publications + social_metrics).
 *
 * Vroeger liep dit via publications → deliverables → scripts. Die koppeling is
 * in de praktijk leeg (0 van 375 publicaties), waardoor de Script Engine nooit
 * cijfers kreeg. Nu wordt elke gepubliceerde video zelf geanalyseerd: de
 * openingszin van de caption is de hook, de CTA en lengte komen uit caption en
 * Metricool. Waar mogelijk wordt de video aan de contentplanning en de
 * Caption Maker gekoppeld (via de caption), zodat ook de scripttitel en de
 * gesproken hook bekend zijn.
 */

export type WinningPattern = {
  title: string | null;
  hook: string | null;
  platform: string;
  views: number;
  completionRate: number | null;
};

export type WinningPatterns = {
  count: number;
  avgViews: number | null;
  top: WinningPattern[];
};

type Row = {
  id: string;
  platform: string;
  published_at: string | Date | null;
  caption: string | null;
  duration_seconds: number | null;
  views: number | string | null;
  likes: number | string | null;
  comments: number | string | null;
  shares: number | string | null;
  saves: number | string | null;
  watch_time_seconds: number | string | null;
  avg_watch_seconds: number | string | null;
  completion_rate: number | string | null;
  first_measured_on: string | Date | null;
};

const rowsOf = <T,>(res: unknown): T[] => (((res as { rows?: unknown[] }).rows ?? res) as T[]);
const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const numOrNull = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const dateStr = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** Sleutel om een gepubliceerde caption aan een geplande caption te koppelen. */
export function captionKey(caption: string | null | undefined): string {
  if (!caption) return "";
  return normalizeText(caption).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
}

/** Cache per klant: de analyse wordt per scriptsessie vaak meerdere keren gevraagd. */
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: PerformanceInsights }>();

/**
 * Volledige prestatie-analyse per klant (laatste 12 maanden). Leest alleen;
 * schrijft niets weg.
 */
export async function getClientPerformanceInsights(viewer: Viewer, clientId: string): Promise<PerformanceInsights> {
  assertClientAccess(viewer, clientId);
  const hit = cache.get(clientId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const [pubRes, planRes, capRes] = await Promise.all([
    db.execute(sql`
      select p.id, p.platform, p.published_at, p.caption, p.duration_seconds,
             m.views, m.likes, m.comments, m.shares, m.saves, m.watch_time_seconds,
             m.avg_watch_seconds, m.completion_rate, f.first_measured_on
      from publications p
      join lateral (
        select views, likes, comments, shares, saves, watch_time_seconds, avg_watch_seconds, completion_rate
        from social_metrics s where s.publication_id = p.id
        order by s.measured_on desc limit 1
      ) m on true
      left join lateral (
        select min(measured_on) as first_measured_on from social_metrics s2 where s2.publication_id = p.id
      ) f on true
      where p.client_id = ${clientId}
        and p.deleted_at is null
        and p.status = 'published'
        and (p.published_at is null or p.published_at > now() - interval '365 days')
    `),
    // Contentplanning: scripttitel bij een caption.
    db.execute(sql`
      select title, caption from content_calendar
      where client_id = ${clientId} and deleted_at is null and caption is not null and length(caption) > 20
    `).catch(() => [] as unknown),
    // Caption Maker: gesproken hook + korte titel bij een caption.
    db.execute(sql`
      select ci.short_title, ci.hook, ci.caption from caption_items ci
      join caption_sets cs on cs.id = ci.caption_set_id
      where cs.client_id = ${clientId} and cs.deleted_at is null and length(ci.caption) > 20
    `).catch(() => [] as unknown),
  ]);

  const plan = new Map<string, string>();
  for (const r of rowsOf<{ title: string; caption: string }>(planRes)) {
    const k = captionKey(r.caption);
    if (k.length >= 15 && !plan.has(k)) plan.set(k, r.title);
  }
  const caps = new Map<string, { title: string; hook: string }>();
  for (const r of rowsOf<{ short_title: string; hook: string; caption: string }>(capRes)) {
    const k = captionKey(r.caption);
    if (k.length >= 15 && !caps.has(k)) caps.set(k, { title: r.short_title, hook: r.hook });
  }

  const pubs: PubInput[] = rowsOf<Row>(pubRes).map((r) => {
    const k = captionKey(r.caption);
    const cap = k.length >= 15 ? caps.get(k) : undefined;
    const title = (k.length >= 15 ? plan.get(k) : undefined) ?? cap?.title ?? null;
    return {
      id: r.id,
      platform: r.platform,
      publishedAt: r.published_at ? new Date(r.published_at) : null,
      caption: r.caption,
      durationSeconds: numOrNull(r.duration_seconds),
      views: num(r.views),
      likes: num(r.likes),
      comments: num(r.comments),
      shares: num(r.shares),
      saves: num(r.saves),
      watchTimeSeconds: num(r.watch_time_seconds),
      avgWatchSeconds: numOrNull(r.avg_watch_seconds),
      completionRate: numOrNull(r.completion_rate),
      firstMeasuredOn: dateStr(r.first_measured_on),
      scriptTitle: title || null,
      scriptHook: cap?.hook?.trim() || null,
    };
  });

  const value = analyzePerformance(pubs);
  cache.set(clientId, { at: Date.now(), value });
  return value;
}

/**
 * Compacte variant voor bestaande afnemers (Content Research, oude generator).
 * Zelfde vorm als voorheen, nu gevoed door de echte Metricool-analyse.
 */
export async function getClientWinningPatterns(viewer: Viewer, clientId: string): Promise<WinningPatterns> {
  const ins = await getClientPerformanceInsights(viewer, clientId);
  if (!ins.sufficient || !ins.top.length) return { count: 0, avgViews: null, top: [] };
  // Typische views per video: mediaan per platform, gewogen naar aantal video's.
  const n = ins.platforms.reduce((a, p) => a + p.n, 0);
  const avgViews = n ? Math.round(ins.platforms.reduce((a, p) => a + p.medianViews * p.n, 0) / n) : null;
  return {
    count: ins.videoCount,
    avgViews,
    top: ins.top.map((v) => ({
      title: v.title,
      hook: v.hook || v.title,
      platform: v.platform,
      views: v.views,
      completionRate: v.watchedShare,
    })),
  };
}
