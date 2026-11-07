import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Deterministische maandcijfers voor AI Maandrapportages.
 *
 * Alle vergelijkingen (vorige maand, 3 en 6 maanden) worden hier in code
 * berekend uit de opgeslagen cijfers. De AI krijgt deze uitkomsten alleen om te
 * interpreteren; ze rekent zelf niets uit. Ontbreekt een maand, dan blijft die
 * vergelijking leeg (null) in plaats van geschat.
 */

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const n = (v: unknown) => Number(v ?? 0);

export type MaandCijfers = {
  maand: string; // YYYY-MM
  views: number;
  reach: number;
  engagements: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  followerGrowth: number;
  /** Gepubliceerde video's volgens de publicatielijst (bron: Metricool-posts). */
  videos: number;
  /** Aantal dagen met cijfers in deze maand (0 = geen meting). */
  meetdagen: number;
};

export type Vergelijking = {
  /** Wijziging t.o.v. de directe vorige maand, in procenten. null = niet te berekenen. */
  vsVorigeMaand: Record<"views" | "reach" | "engagements" | "followerGrowth" | "videos" | "viewsPerVideo", number | null>;
  /** Deze maand t.o.v. het gemiddelde van de 3 maanden ervoor. */
  vsGem3: Record<"views" | "engagements" | "videos", number | null>;
  /** Deze maand t.o.v. het gemiddelde van de 6 maanden ervoor. */
  vsGem6: Record<"views" | "engagements" | "videos", number | null>;
  /** Hoeveel eerdere maanden met meting er zijn (bepaalt welke vergelijking eerlijk is). */
  maandenHistorie: number;
};

export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}

/**
 * Cijfers per kalendermaand voor `period` en de `back` maanden ervoor
 * (oudste eerst). Maanden zonder meting komen terug met meetdagen = 0.
 */
export async function monthSeries(clientId: string, period: string, back = 6): Promise<MaandCijfers[]> {
  const from = `${shiftPeriod(period, -back)}-01`;
  const to = monthEnd(period);
  const [dmRes, pubRes] = await Promise.all([
    db.execute(sql`
      select to_char(measured_on, 'YYYY-MM') maand,
             coalesce(sum(views),0)::bigint views, coalesce(sum(reach),0)::bigint reach,
             coalesce(sum(engagements),0)::bigint engagements, coalesce(sum(likes),0)::bigint likes,
             coalesce(sum(comments),0)::bigint comments, coalesce(sum(shares),0)::bigint shares,
             coalesce(sum(saves),0)::bigint saves, coalesce(sum(follower_delta),0)::int follower_growth,
             count(distinct measured_on)::int meetdagen
      from daily_metrics
      where client_id = ${clientId} and measured_on >= ${from} and measured_on <= ${to}
      group by 1`),
    db.execute(sql`
      select to_char(published_at at time zone 'Europe/Amsterdam', 'YYYY-MM') maand, count(*)::int videos
      from publications
      where client_id = ${clientId} and deleted_at is null and status = 'published' and published_at is not null
        and published_at >= ${from}::date and published_at < (${to}::date + 1)
      group by 1`),
  ]);
  const dm = new Map(rows<Record<string, unknown>>(dmRes).map((r) => [String(r.maand), r]));
  const pubs = new Map(rows<Record<string, unknown>>(pubRes).map((r) => [String(r.maand), n(r.videos)]));

  const out: MaandCijfers[] = [];
  for (let i = back; i >= 0; i--) {
    const maand = shiftPeriod(period, -i);
    const r = dm.get(maand);
    out.push({
      maand,
      views: n(r?.views),
      reach: n(r?.reach),
      engagements: n(r?.engagements),
      likes: n(r?.likes),
      comments: n(r?.comments),
      shares: n(r?.shares),
      saves: n(r?.saves),
      followerGrowth: n(r?.follower_growth),
      videos: pubs.get(maand) ?? 0,
      meetdagen: n(r?.meetdagen),
    });
  }
  return out;
}

const pct = (cur: number, was: number | null): number | null =>
  was === null || was <= 0 ? null : Math.round(((cur - was) / was) * 1000) / 10;

function avg(list: MaandCijfers[], key: keyof MaandCijfers): number | null {
  const measured = list.filter((m) => m.meetdagen > 0);
  if (measured.length === 0) return null;
  return measured.reduce((s, m) => s + n(m[key]), 0) / measured.length;
}

/** Vergelijkingen voor de laatste maand in de reeks (de rapportmaand). */
export function buildVergelijking(series: MaandCijfers[]): Vergelijking {
  const cur = series[series.length - 1]!;
  const prior = series.slice(0, -1);
  const prev = prior[prior.length - 1];
  const prevMeasured = prev && prev.meetdagen > 0 ? prev : null;
  const last3 = prior.slice(-3);
  const last6 = prior.slice(-6);
  const vpv = (m: MaandCijfers | null) => (m && m.videos > 0 ? m.views / m.videos : null);
  // Volgersgroei kan negatief zijn: dan geen procentuele wijziging.
  const fg = prevMeasured && prevMeasured.followerGrowth > 0 ? pct(cur.followerGrowth, prevMeasured.followerGrowth) : null;
  return {
    vsVorigeMaand: {
      views: pct(cur.views, prevMeasured ? prevMeasured.views : null),
      reach: pct(cur.reach, prevMeasured ? prevMeasured.reach : null),
      engagements: pct(cur.engagements, prevMeasured ? prevMeasured.engagements : null),
      followerGrowth: fg,
      videos: pct(cur.videos, prev ? prev.videos : null),
      viewsPerVideo: (() => {
        const c = vpv(cur);
        const p = vpv(prevMeasured);
        return c === null ? null : pct(c, p);
      })(),
    },
    vsGem3: {
      views: last3.filter((m) => m.meetdagen > 0).length === 3 ? pct(cur.views, avg(last3, "views")) : null,
      engagements: last3.filter((m) => m.meetdagen > 0).length === 3 ? pct(cur.engagements, avg(last3, "engagements")) : null,
      videos: last3.length === 3 ? pct(cur.videos, avg(last3, "videos")) : null,
    },
    vsGem6: {
      views: last6.filter((m) => m.meetdagen > 0).length === 6 ? pct(cur.views, avg(last6, "views")) : null,
      engagements: last6.filter((m) => m.meetdagen > 0).length === 6 ? pct(cur.engagements, avg(last6, "engagements")) : null,
      videos: last6.length === 6 ? pct(cur.videos, avg(last6, "videos")) : null,
    },
    maandenHistorie: prior.filter((m) => m.meetdagen > 0).length,
  };
}

/**
 * Controleert of de dagcijfers van deze klant in deze maand exact gelijk zijn
 * aan die van een andere klant. Dat wijst op een verkeerde koppeling (bv. een
 * Metricool-merk dat niet meer bestaat en de cijfers van een ander merk
 * teruggeeft).
 *
 * `eigenKoppelingActief`: deze klant heeft zelf een actieve Metricool-koppeling.
 * Is dat zo en hebben de dubbelgangers dat niet, dan zijn de cijfers van deze
 * klant waarschijnlijk de echte en die van de anderen de kopie.
 */
export type DuplicateCheck = { duplicates: Array<{ name: string; linkActive: boolean }>; eigenKoppelingActief: boolean };

export async function findDuplicateMetricClients(clientId: string, period: string): Promise<DuplicateCheck> {
  const from = `${period}-01`;
  const to = monthEnd(period);
  const linkActive = (alias: string) => sql.raw(`exists (select 1 from client_integrations ci where ci.client_id = ${alias}.client_id and ci.provider = 'metricool' and ci.is_active)`);
  const res = await db.execute(sql`
    with sig as (
      select client_id, md5(string_agg(measured_on::text || ':' || coalesce(platform::text,'') || ':' || views || ':' || reach || ':' || engagements, ',' order by measured_on, platform)) h,
             sum(views) v
      from daily_metrics
      where measured_on >= ${from} and measured_on <= ${to}
      group by client_id
    )
    select c.name, ${linkActive("b")} as link_active, ${linkActive("a")} as own_active
    from sig a
    join sig b on b.h = a.h and b.client_id <> a.client_id
    join clients c on c.id = b.client_id
    where a.client_id = ${clientId} and a.v > 0
    order by c.name`);
  const list = rows<{ name: string; link_active: boolean; own_active: boolean }>(res);
  if (list.length === 0) return { duplicates: [], eigenKoppelingActief: false };
  const own = Boolean(list[0]!.own_active);
  return { duplicates: list.map((r) => ({ name: r.name, linkActive: Boolean(r.link_active) })), eigenKoppelingActief: own };
}

/**
 * Vertaalt de dubbel-check naar een controlepunt. "blok" wanneer niet vast te
 * stellen is dat deze klant de echte cijfers heeft.
 */
export function duplicateIssue(check: DuplicateCheck): { severity: "blok" | "let_op"; label: string } | null {
  if (check.duplicates.length === 0) return null;
  const names = check.duplicates.map((d) => d.name).join(", ");
  const anderenActief = check.duplicates.some((d) => d.linkActive);
  if (check.eigenKoppelingActief && !anderenActief) {
    return { severity: "let_op", label: `De cijfers zijn identiek aan die van ${names}. Deze klant heeft zelf een actieve Metricool-koppeling; controleer of de andere klant(en) verkeerd gekoppeld zijn.` };
  }
  return { severity: "blok", label: `De cijfers van deze maand zijn exact gelijk aan die van ${names}. Waarschijnlijk is de Metricool-koppeling verkeerd. Niet goedkeuren voordat de koppeling klopt.` };
}

/** Totale cijfers per contentformat (uit de gekoppelde scripts) in de maand. */
export type FormatStat = { format: string; videos: number; views: number; gemViews: number; gemInteracties: number };

export function formatStats(videos: Array<{ format: string | null; views: number; likes: number; reacties: number; shares: number; saves: number }>): FormatStat[] {
  const map = new Map<string, { videos: number; views: number; inter: number }>();
  for (const v of videos) {
    if (!v.format) continue;
    const key = v.format.trim();
    const cur = map.get(key) ?? { videos: 0, views: 0, inter: 0 };
    cur.videos++;
    cur.views += v.views;
    cur.inter += v.likes + v.reacties + v.shares + v.saves;
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([format, s]) => ({ format, videos: s.videos, views: s.views, gemViews: Math.round(s.views / s.videos), gemInteracties: Math.round(s.inter / s.videos) }))
    .sort((a, b) => b.gemViews - a.gemViews);
}

export type MonthVideo = {
  key: string; id: string; titel: string; datum: string | null; platform: string | null; url: string | null;
  views: number; likes: number; reacties: number; shares: number; saves: number; gemKijktijdSec: number | null;
};

/**
 * Alle gepubliceerde video's van een klant in een kalendermaand met hun eigen
 * (laatst gemeten) cijfers, hoogste weergaven eerst. Zelfde bron als de analyse.
 */
export async function monthVideos(clientId: string, period: string, limit = 40): Promise<MonthVideo[]> {
  const from = `${period}-01`;
  const to = monthEnd(period);
  const res = await db.execute(sql`
    with pm as (
      select publication_id, max(views) views, max(likes) likes, max(comments) comments,
             max(shares) shares, max(saves) saves, max(avg_watch_seconds) avg_watch
      from social_metrics where client_id = ${clientId} group by publication_id
    )
    select p.id, p.platform, left(coalesce(d.title, p.caption), 140) as titel,
           to_char(coalesce(d.published_at, p.published_at), 'YYYY-MM-DD') as datum, p.external_url as url,
           coalesce(pm.views,0)::int views, coalesce(pm.likes,0)::int likes, coalesce(pm.comments,0)::int comments,
           coalesce(pm.shares,0)::int shares, coalesce(pm.saves,0)::int saves, pm.avg_watch
    from publications p
    join pm on pm.publication_id = p.id
    left join deliverables d on d.id = p.deliverable_id and d.deleted_at is null
    where p.client_id = ${clientId} and p.deleted_at is null
      and coalesce(p.published_at, d.published_at)::date >= ${from}
      and coalesce(p.published_at, d.published_at)::date <= ${to}
      and coalesce(pm.views,0) > 0
    order by views desc
    limit ${limit}`);
  return rows<Record<string, unknown>>(res).map((v, i) => ({
    key: `v${i + 1}`, id: String(v.id), titel: String(v.titel ?? ""), datum: v.datum ? String(v.datum) : null,
    platform: v.platform ? String(v.platform) : null, url: v.url ? String(v.url) : null,
    views: n(v.views), likes: n(v.likes), reacties: n(v.comments), shares: n(v.shares), saves: n(v.saves),
    gemKijktijdSec: v.avg_watch != null ? Math.round(Number(v.avg_watch)) : null,
  }));
}

/** Miniaturen (data-URI) per publicatie-id. */
export async function thumbnailsFor(ids: string[]): Promise<Map<string, string>> {
  const uuids = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (uuids.length === 0) return new Map();
  const res = await db.execute(sql`select id, thumbnail_data from publications where thumbnail_data is not null and id in (${sql.join(uuids.map((u) => sql`${u}::uuid`), sql`, `)})`);
  return new Map(rows<{ id: string; thumbnail_data: string }>(res).map((r) => [String(r.id), r.thumbnail_data]));
}

export type PlatformCijfers = {
  platform: string;
  views: number; reach: number; engagements: number; followerGrowth: number; videos: number;
  /** Weergaven van dezelfde platform in de vorige maand (null = geen meting). */
  viewsVorigeMaand: number | null;
};

/** Cijfers per platform voor een kalendermaand, met weergaven van de maand ervoor. */
export async function platformSplit(clientId: string, period: string): Promise<PlatformCijfers[]> {
  const from = `${period}-01`;
  const to = monthEnd(period);
  const prev = shiftPeriod(period, -1);
  const [cur, prv, pubs, vidViews] = await Promise.all([
    db.execute(sql`
      select platform::text platform, coalesce(sum(views),0)::bigint views, coalesce(sum(reach),0)::bigint reach,
             coalesce(sum(engagements),0)::bigint engagements, coalesce(sum(follower_delta),0)::int follower_growth
      from daily_metrics where client_id = ${clientId} and platform is not null and measured_on >= ${from} and measured_on <= ${to}
      group by 1`),
    db.execute(sql`
      select platform::text platform, coalesce(sum(views),0)::bigint views, count(*)::int dagen
      from daily_metrics where client_id = ${clientId} and platform is not null and measured_on >= ${`${prev}-01`} and measured_on <= ${monthEnd(prev)}
      group by 1`),
    db.execute(sql`
      select platform::text platform, count(*)::int videos from publications
      where client_id = ${clientId} and deleted_at is null and status = 'published' and published_at is not null
        and published_at >= ${from}::date and published_at < (${to}::date + 1)
      group by 1`),
    // Weergaven uit de cijfers per video (voor platforms zonder accountweergaven, zoals Facebook).
    db.execute(sql`
      with pm as (select publication_id, max(views) views from social_metrics where client_id = ${clientId} group by publication_id)
      select p.platform::text platform, coalesce(sum(pm.views),0)::bigint views
      from publications p join pm on pm.publication_id = p.id
      where p.client_id = ${clientId} and p.deleted_at is null and p.published_at >= ${from}::date and p.published_at < (${to}::date + 1)
      group by 1`),
  ]);
  const vidMap = new Map(rows<Record<string, unknown>>(vidViews).map((r) => [String(r.platform), n(r.views)]));
  const prevMap = new Map(rows<Record<string, unknown>>(prv).map((r) => [String(r.platform), n(r.views)]));
  const pubMap = new Map(rows<Record<string, unknown>>(pubs).map((r) => [String(r.platform), n(r.videos)]));
  const list = rows<Record<string, unknown>>(cur).map((r) => {
    const p = String(r.platform);
    // Geen accountweergaven gemeten? Dan de som van de video's van die maand.
    const views = n(r.views) > 0 ? n(r.views) : (vidMap.get(p) ?? 0);
    return { platform: p, views, reach: n(r.reach), engagements: n(r.engagements), followerGrowth: n(r.follower_growth), videos: pubMap.get(p) ?? 0, viewsVorigeMaand: prevMap.has(p) ? prevMap.get(p)! : null };
  });
  // Platforms met video's maar zonder dagcijfers ook tonen (eerlijk: geen meting).
  for (const [p, v] of pubMap) if (!list.some((x) => x.platform === p)) list.push({ platform: p, views: vidMap.get(p) ?? 0, reach: 0, engagements: 0, followerGrowth: 0, videos: v, viewsVorigeMaand: prevMap.get(p) ?? null });
  return list.sort((a, b) => b.views - a.views || b.engagements - a.engagements);
}
