import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { captionKey } from "@/server/content-memory/analyze";
import {
  PAKKET_LABEL, addDays, daysInRange, kortDatum, pakketTypeOf, pctChange, previousQuarter, vergelijkbaarheid,
  type PakketType, type Quarter, type Vergelijkbaarheid,
} from "@/lib/kwartaal";

/**
 * Deterministische kwartaalcijfers.
 *
 * Alles wordt hier in code berekend uit de bestaande bronnen van het portaal
 * (dagcijfers en videocijfers uit Metricool, de publicatielijst, opnamedagen,
 * deliverables, scripts en klantgegevens). De AI krijgt deze uitkomsten alleen
 * om te duiden en rekent zelf niets uit. Wat niet gemeten is blijft `null` en
 * komt in `ontbrekend`, nooit als schatting.
 */

const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const n = (v: unknown) => Number(v ?? 0) || 0;
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export type SegmentCijfers = {
  label: string; from: string; to: string;
  views: number; reach: number; engagements: number; likes: number; comments: number; shares: number; saves: number;
  followerGrowth: number;
  /** Unieke gepubliceerde video's (ontdubbeld over kanalen). */
  videos: number;
  gemViewsPerVideo: number | null;
  /** Interacties per 100 weergaven. */
  engagementPct: number | null;
  dagen: number; meetdagen: number;
};

export type Totaal = Omit<SegmentCijfers, "label" | "from" | "to">;

export type PlatformCijfers = { platform: string; views: number; reach: number; engagements: number; followerGrowth: number; publicaties: number; meetdagen: number };

export type QuarterVideo = {
  key: string;
  /** Publicatie-id van het best presterende kanaal (voor miniatuur en link). */
  id: string;
  titel: string; datum: string | null; platforms: string[]; url: string | null;
  views: number; likes: number; reacties: number; shares: number; saves: number;
  /** Interacties per 100 weergaven. */
  engagementPct: number | null;
  gemKijktijdSec: number | null; uitkijkPct: number | null; duurSec: number | null;
  hook: string | null; cta: string | null; format: string | null; pijler: string | null; presentator: string | null;
  caption: string | null;
};

export type Geleverd = {
  opnamedagen: number;
  geproduceerd: number;
  opgeleverd: number;
  gepubliceerd: number;
  /** Losse plaatsingen op de kanalen (één video op vier kanalen = vier plaatsingen). */
  plaatsingen: number;
  concepten: number;
  kanalen: string[];
  /** False als de interne videopijplijn voor deze klant niet wordt bijgehouden. */
  pipelineBijgehouden: boolean;
};

export type PakketInfo = {
  type: PakketType;
  label: string;
  /** Naam van het pakket uit de klantadministratie, als die is vastgelegd. */
  naam: string | null;
  videosPerMaand: number | null;
  startdatum: string | null;
  /** Afgesproken aantal video's voor dit kwartaal (naar rato bij een start halverwege). */
  verwachtInKwartaal: number | null;
  /** Toelichting bij een pakketwijziging of een start in het kwartaal. */
  bijzonderheden: string[];
  /** Waar het pakket uit is afgeleid. */
  bron: string;
};

export type Doel = { id: string; label: string; metric: string; target: number };
export type DoelRealisatie = Doel & { gerealiseerd: number | null; behaald: boolean | null };

export type VorigKwartaal = Vergelijkbaarheid & {
  key: string; label: string;
  totaal: Totaal | null;
  /** Groei in procenten; alleen gevuld als de kwartalen vergelijkbaar zijn. */
  pct: Partial<Record<"views" | "reach" | "engagements" | "videos" | "gemViewsPerVideo" | "followerGrowth", number | null>>;
};

export type VerbeterItem = { id: string; titel: string; actie: string; status: string; note: string | null };

export type Bron = { naam: string; periode: string; opmerking: string | null };

export type QuarterMetrics = {
  periode: { key: string; mode: string; label: string; from: string; to: string; dagen: number };
  /** Cijfers lopen tot en met deze dag (bij een voorlopig concept eerder dan het einde). */
  gemetenTot: string | null;
  voorlopig: boolean;
  segmenten: SegmentCijfers[];
  totaal: Totaal;
  kijktijd: { gemSec: number | null; uitkijkPct: number | null; videosMetMeting: number };
  /** Null = niet gemeten (er wordt nooit een nul getoond voor iets dat niet gemeten is). */
  profielbezoeken: number | null;
  websiteKlikken: number | null;
  conversies: number | null;
  platforms: PlatformCijfers[];
  videos: QuarterVideo[];
  formats: Array<{ format: string; videos: number; views: number; gemViews: number }>;
  geleverd: Geleverd;
  pakket: PakketInfo;
  doelen: DoelRealisatie[];
  vorig: VorigKwartaal | null;
  /** Verbeterpunten uit de vorige kwartaalrapportage met hun opvolging. */
  verbetermonitor: { periodLabel: string; items: VerbeterItem[] } | null;
  feedback: { signalen: number; ernstig: number } | null;
  advertenties: { gekoppeld: false; toelichting: string };
  bronnen: Bron[];
  dataKwaliteit: string[];
  ontbrekend: string[];
  /** Alle cijfers van het volledige kwartaal zijn binnen. */
  dataCompleet: boolean;
  dataWachtReden: string | null;
};

const OPGELEVERD = ["client_review", "approved", "ready_to_publish", "scheduled", "published", "analysis_available"];

type DayRow = { dag: string; platform: string | null; views: number; reach: number; engagements: number; likes: number; comments: number; shares: number; saves: number; followerDelta: number };

/**
 * Dagcijfers binnen een periode. Voorkomt dubbeltellingen: staan er voor een
 * dag zowel rijen per platform als een totaalrij (zonder platform), dan tellen
 * alleen de rijen per platform.
 */
async function dayRows(clientId: string, from: string, to: string): Promise<DayRow[]> {
  const res = await db.execute(sql`
    with d as (
      select to_char(measured_on, 'YYYY-MM-DD') dag, platform::text platform, views, reach, engagements, likes, comments, shares, saves, follower_delta
      from daily_metrics
      where client_id = ${clientId} and measured_on >= ${from} and measured_on <= ${to}
    ), per_platform as (select distinct dag from d where platform is not null)
    select * from d where platform is not null or dag not in (select dag from per_platform)`);
  return rowsOf<Record<string, unknown>>(res).map((r) => ({
    dag: String(r.dag), platform: r.platform ? String(r.platform) : null,
    views: n(r.views), reach: n(r.reach), engagements: n(r.engagements), likes: n(r.likes), comments: n(r.comments),
    shares: n(r.shares), saves: n(r.saves), followerDelta: n(r.follower_delta),
  }));
}

type PubRow = {
  id: string; deliverableId: string | null; platform: string; datum: string | null; titel: string; url: string | null; caption: string | null;
  duur: number | null; hook: string | null; cta: string | null; format: string | null; pijler: string | null; presentator: string | null;
  views: number; likes: number; comments: number; shares: number; saves: number; avgWatch: number | null; completion: number | null;
  profileVisits: number; linkClicks: number | null; conversions: number | null; gemeten: boolean;
};

/** Gepubliceerde plaatsingen in de periode met hun laatst gemeten cijfers. */
async function pubRows(clientId: string, from: string, to: string): Promise<PubRow[]> {
  const res = await db.execute(sql`
    with pm as (
      select publication_id, max(views) views, max(likes) likes, max(comments) comments, max(shares) shares, max(saves) saves,
             max(avg_watch_seconds) avg_watch, max(completion_rate) completion, max(profile_visits) profile_visits,
             max(link_clicks) link_clicks, max(conversions) conversions
      from social_metrics where client_id = ${clientId} group by publication_id
    )
    select p.id, p.deliverable_id, p.platform::text platform,
           to_char((coalesce(p.published_at, d.published_at) at time zone 'Europe/Amsterdam')::date, 'YYYY-MM-DD') datum,
           left(coalesce(d.title, p.caption), 140) titel, p.external_url url, left(p.caption, 500) caption, p.duration_seconds duur,
           sc.hook, sc.cta, sc.format, sc.pillar, sc.presenter,
           pm.publication_id is not null as gemeten,
           coalesce(pm.views,0)::int views, coalesce(pm.likes,0)::int likes, coalesce(pm.comments,0)::int comments,
           coalesce(pm.shares,0)::int shares, coalesce(pm.saves,0)::int saves, pm.avg_watch, pm.completion,
           coalesce(pm.profile_visits,0)::int profile_visits, pm.link_clicks, pm.conversions
    from publications p
    left join pm on pm.publication_id = p.id
    left join deliverables d on d.id = p.deliverable_id and d.deleted_at is null
    left join scripts sc on sc.id = d.script_id and sc.deleted_at is null
    where p.client_id = ${clientId} and p.deleted_at is null and p.status = 'published'
      and (coalesce(p.published_at, d.published_at) at time zone 'Europe/Amsterdam')::date >= ${from}::date
      and (coalesce(p.published_at, d.published_at) at time zone 'Europe/Amsterdam')::date <= ${to}::date`);
  return rowsOf<Record<string, unknown>>(res).map((r) => ({
    id: String(r.id), deliverableId: r.deliverable_id ? String(r.deliverable_id) : null, platform: String(r.platform),
    datum: r.datum ? String(r.datum) : null, titel: String(r.titel ?? "Video"), url: r.url ? String(r.url) : null,
    caption: r.caption ? String(r.caption) : null, duur: nn(r.duur),
    hook: r.hook ? String(r.hook) : null, cta: r.cta ? String(r.cta) : null, format: r.format ? String(r.format) : null,
    pijler: r.pillar ? String(r.pillar) : null, presentator: r.presenter ? String(r.presenter) : null,
    views: n(r.views), likes: n(r.likes), comments: n(r.comments), shares: n(r.shares), saves: n(r.saves),
    avgWatch: nn(r.avg_watch), completion: nn(r.completion), profileVisits: n(r.profile_visits),
    linkClicks: nn(r.link_clicks), conversions: nn(r.conversions), gemeten: Boolean(r.gemeten),
  }));
}

/** Sleutel van een unieke video: de deliverable, anders dezelfde caption op dezelfde dag, anders de plaatsing zelf. */
function videoKey(p: PubRow): string {
  if (p.deliverableId) return `d:${p.deliverableId}`;
  const ck = captionKey(p.caption);
  return ck.length >= 12 ? `c:${ck}` : `p:${p.id}`;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function totalOf(days: DayRow[], videos: number, dagen: number): Totaal {
  const sum = (k: keyof DayRow) => days.reduce((s, d) => s + (d[k] as number), 0);
  const views = sum("views");
  const engagements = sum("engagements");
  return {
    views, reach: sum("reach"), engagements, likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), saves: sum("saves"),
    followerGrowth: sum("followerDelta"), videos,
    gemViewsPerVideo: videos > 0 && views > 0 ? Math.round(views / videos) : null,
    engagementPct: views > 0 ? round1((engagements / views) * 100) : null,
    dagen, meetdagen: new Set(days.map((d) => d.dag)).size,
  };
}

export type MetricsInput = {
  clientId: string;
  quarter: Quarter;
  /** Vandaag (Amsterdam). Bepaalt of de cijfers voorlopig zijn en tot wanneer ze lopen. */
  today: string;
  startedOn: string | null;
  doelen?: Doel[];
};

export async function buildQuarterMetrics(input: MetricsInput): Promise<QuarterMetrics> {
  const { clientId, quarter: q, today } = input;
  const voorlopig = today <= q.to;
  // Bij een voorlopig concept lopen de cijfers tot en met gisteren.
  const tot = voorlopig ? addDays(today, -1) : q.to;
  const dagenTotaal = daysInRange(q.from, q.to);

  const [days, pubs, clientRes, contractRes, pakketRes, linkRes, prodRes, delivRes, scriptRes, fbRes, lastRes] = await Promise.all([
    dayRows(clientId, q.from, tot),
    pubRows(clientId, q.from, tot),
    db.execute(sql`select content_focus, monthly_video_quota, to_char(started_on, 'YYYY-MM-DD') started_on, name from clients where id = ${clientId}`),
    db.execute(sql`
      select to_char(starts_on, 'YYYY-MM-DD') starts_on, to_char(ends_on, 'YYYY-MM-DD') ends_on, videos_per_month
      from contracts where client_id = ${clientId} and deleted_at is null
        and (starts_on is null or starts_on <= ${q.to}::date) and (ends_on is null or ends_on >= ${q.from}::date)
      order by starts_on nulls first`),
    db.execute(sql`
      select name, videos_per_month, to_char(starts_on, 'YYYY-MM-DD') starts_on, to_char(ends_on, 'YYYY-MM-DD') ends_on
      from client_packages where client_id = ${clientId}
        and (starts_on is null or starts_on <= ${q.to}::date) and (ends_on is null or ends_on >= ${q.from}::date)
      order by starts_on nulls first`),
    db.execute(sql`select count(*)::int c from client_integrations where client_id = ${clientId} and provider = 'metricool' and is_active`),
    db.execute(sql`select count(*)::int c from production_days where client_id = ${clientId} and deleted_at is null and status <> 'cancelled' and scheduled_on >= ${q.from} and scheduled_on <= ${tot}`),
    db.execute(sql`
      select d.status::text status from deliverables d left join production_days pd on pd.id = d.production_day_id
      where d.client_id = ${clientId} and d.deleted_at is null
        and coalesce(d.shoot_on, pd.scheduled_on) >= ${q.from} and coalesce(d.shoot_on, pd.scheduled_on) <= ${tot}`),
    db.execute(sql`
      select count(*)::int c from scripts where client_id = ${clientId} and deleted_at is null
        and (created_at at time zone 'Europe/Amsterdam')::date >= ${q.from}::date and (created_at at time zone 'Europe/Amsterdam')::date <= ${tot}::date`),
    db.execute(sql`
      select kind, count(*)::int c from client_feedback where client_id = ${clientId} and deleted_at is null
        and (created_at at time zone 'Europe/Amsterdam')::date >= ${q.from}::date and (created_at at time zone 'Europe/Amsterdam')::date <= ${tot}::date
      group by kind`),
    db.execute(sql`select to_char(max(measured_on), 'YYYY-MM-DD') d from daily_metrics where client_id = ${clientId} and measured_on <= ${q.to}`),
  ]);

  /* ---- Unieke video's ---- */
  type Agg = { rows: PubRow[] };
  const byVideo = new Map<string, Agg>();
  for (const p of pubs) {
    const k = videoKey(p);
    const a = byVideo.get(k) ?? { rows: [] };
    a.rows.push(p);
    byVideo.set(k, a);
  }
  const uniekIn = (from: string, to: string) => [...byVideo.values()].filter((a) => {
    const d = a.rows.map((r) => r.datum).filter(Boolean).sort()[0];
    return d ? d >= from && d <= to : false;
  }).length;

  const videos: QuarterVideo[] = [...byVideo.values()]
    .map((a) => {
      const best = [...a.rows].sort((x, y) => y.views - x.views)[0]!;
      const sum = (k: "views" | "likes" | "comments" | "shares" | "saves") => a.rows.reduce((s, r) => s + r[k], 0);
      const views = sum("views");
      const inter = sum("likes") + sum("comments") + sum("shares") + sum("saves");
      // Kijktijd en uitkijkpercentage: gewogen naar weergaven, alleen van kanalen die het meten.
      const metWatch = a.rows.filter((r) => r.avgWatch !== null && r.views > 0);
      const wv = metWatch.reduce((s, r) => s + r.views, 0);
      const metComp = a.rows.filter((r) => r.completion !== null && r.views > 0);
      const cv = metComp.reduce((s, r) => s + r.views, 0);
      const withScript = a.rows.find((r) => r.hook || r.format) ?? best;
      return {
        key: "", id: best.id, titel: best.titel, datum: a.rows.map((r) => r.datum).filter(Boolean).sort()[0] ?? null,
        platforms: [...new Set(a.rows.map((r) => r.platform))], url: best.url,
        views, likes: sum("likes"), reacties: sum("comments"), shares: sum("shares"), saves: sum("saves"),
        engagementPct: views > 0 ? round1((inter / views) * 100) : null,
        gemKijktijdSec: wv > 0 ? Math.round(metWatch.reduce((s, r) => s + r.avgWatch! * r.views, 0) / wv) : null,
        uitkijkPct: cv > 0 ? round1((metComp.reduce((s, r) => s + r.completion! * r.views, 0) / cv) * 100) : null,
        duurSec: best.duur, hook: withScript.hook, cta: withScript.cta, format: withScript.format, pijler: withScript.pijler,
        presentator: withScript.presentator, caption: best.caption,
      };
    })
    .sort((a, b) => b.views - a.views)
    .map((v, i) => ({ ...v, key: `v${i + 1}` }));
  const gemeten = videos.filter((v) => v.views > 0);

  /* ---- Segmenten en totaal ---- */
  const segmenten: SegmentCijfers[] = q.segments.map((s) => {
    const einde = s.to > tot ? tot : s.to;
    const inSeg = s.from > tot ? [] : days.filter((d) => d.dag >= s.from && d.dag <= einde);
    const dagen = s.from > tot ? 0 : daysInRange(s.from, einde);
    return { label: s.label, from: s.from, to: s.to, ...totalOf(inSeg, s.from > tot ? 0 : uniekIn(s.from, einde), dagen) };
  });
  const totaal = totalOf(days, byVideo.size, daysInRange(q.from, tot));

  /* ---- Per platform ---- */
  const platMap = new Map<string, PlatformCijfers>();
  for (const d of days) {
    const key = d.platform ?? "totaal";
    const cur = platMap.get(key) ?? { platform: key, views: 0, reach: 0, engagements: 0, followerGrowth: 0, publicaties: 0, meetdagen: 0 };
    cur.views += d.views; cur.reach += d.reach; cur.engagements += d.engagements; cur.followerGrowth += d.followerDelta; cur.meetdagen++;
    platMap.set(key, cur);
  }
  for (const p of pubs) {
    const cur = platMap.get(p.platform) ?? { platform: p.platform, views: 0, reach: 0, engagements: 0, followerGrowth: 0, publicaties: 0, meetdagen: 0 };
    cur.publicaties++;
    platMap.set(p.platform, cur);
  }
  // Kanaal zonder accountweergaven (bijvoorbeeld Facebook): de som van de video's op dat kanaal.
  for (const pc of platMap.values()) {
    if (pc.views === 0) pc.views = pubs.filter((p) => p.platform === pc.platform).reduce((s, p) => s + p.views, 0);
  }
  const platforms = [...platMap.values()].sort((a, b) => b.views - a.views);

  /* ---- Kijktijd, klikken, conversies (alleen als ze gemeten zijn) ---- */
  const metKijk = videos.filter((v) => v.gemKijktijdSec !== null && v.views > 0);
  const kv = metKijk.reduce((s, v) => s + v.views, 0);
  const metUit = videos.filter((v) => v.uitkijkPct !== null && v.views > 0);
  const uv = metUit.reduce((s, v) => s + v.views, 0);
  const kijktijd = {
    gemSec: kv > 0 ? Math.round(metKijk.reduce((s, v) => s + v.gemKijktijdSec! * v.views, 0) / kv) : null,
    uitkijkPct: uv > 0 ? round1(metUit.reduce((s, v) => s + v.uitkijkPct! * v.views, 0) / uv) : null,
    videosMetMeting: metKijk.length,
  };
  const pv = pubs.reduce((s, p) => s + p.profileVisits, 0);
  const klikRows = pubs.filter((p) => p.linkClicks !== null);
  const convRows = pubs.filter((p) => p.conversions !== null);
  const profielbezoeken = pv > 0 ? pv : null;
  const websiteKlikken = klikRows.length ? klikRows.reduce((s, p) => s + p.linkClicks!, 0) : null;
  const conversies = convRows.length ? convRows.reduce((s, p) => s + p.conversions!, 0) : null;

  /* ---- Formats ---- */
  const fmtMap = new Map<string, { videos: number; views: number }>();
  for (const v of gemeten) {
    if (!v.format) continue;
    const cur = fmtMap.get(v.format.trim()) ?? { videos: 0, views: 0 };
    cur.videos++; cur.views += v.views;
    fmtMap.set(v.format.trim(), cur);
  }
  const formats = [...fmtMap.entries()].map(([format, s]) => ({ format, videos: s.videos, views: s.views, gemViews: Math.round(s.views / s.videos) })).sort((a, b) => b.gemViews - a.gemViews);

  /* ---- Geleverd ---- */
  const deliv = rowsOf<{ status: string }>(delivRes);
  const geleverd: Geleverd = {
    opnamedagen: n(rowsOf<{ c: number }>(prodRes)[0]?.c),
    geproduceerd: deliv.length,
    opgeleverd: deliv.filter((d) => OPGELEVERD.includes(String(d.status))).length,
    gepubliceerd: byVideo.size,
    plaatsingen: pubs.length,
    concepten: n(rowsOf<{ c: number }>(scriptRes)[0]?.c),
    kanalen: [...new Set(pubs.map((p) => p.platform))],
    pipelineBijgehouden: deliv.length > 0,
  };

  /* ---- Pakket: het werkelijke pakket uit de klantadministratie, nooit een standaard ---- */
  const client = rowsOf<Record<string, unknown>>(clientRes)[0] ?? {};
  const contracts = rowsOf<Record<string, unknown>>(contractRes);
  const pakketten = rowsOf<Record<string, unknown>>(pakketRes);
  const startdatum = input.startedOn ?? (client.started_on ? String(client.started_on) : null);
  const type = pakketTypeOf(client.content_focus as string | null);
  const bijzonderheden: string[] = [];
  const quota = n(client.monthly_video_quota);
  // Afname per maand per contractperiode; valt terug op de afspraak bij de klant.
  const perMaandOp = (dag: string): number | null => {
    const c = [...contracts].reverse().find((k) => (!k.starts_on || String(k.starts_on) <= dag) && (!k.ends_on || String(k.ends_on) >= dag) && k.videos_per_month != null);
    if (c) return n(c.videos_per_month);
    const p = [...pakketten].reverse().find((k) => (!k.starts_on || String(k.starts_on) <= dag) && (!k.ends_on || String(k.ends_on) >= dag) && n(k.videos_per_month) > 0);
    if (p) return n(p.videos_per_month);
    return quota > 0 ? quota : null;
  };
  const perSegment = q.segments.map((s) => {
    const per = perMaandOp(s.to);
    if (per === null) return null;
    // Start halverwege een maand: naar rato van de dagen dat de samenwerking liep.
    if (startdatum && startdatum > s.to) return 0;
    if (startdatum && startdatum > s.from) return Math.round(per * (daysInRange(startdatum, s.to) / daysInRange(s.from, s.to)));
    return per;
  });
  const bekend = perSegment.filter((v): v is number => v !== null);
  const verwachtInKwartaal = bekend.length === 3 ? bekend.reduce((s, v) => s + v, 0) : null;
  const perMaandWaarden = [...new Set(q.segments.map((s) => perMaandOp(s.to)).filter((v): v is number => v !== null))];
  if (perMaandWaarden.length > 1) bijzonderheden.push(`Het pakket is in dit kwartaal gewijzigd: de afname per maand ging van ${perMaandWaarden[0]} naar ${perMaandWaarden[perMaandWaarden.length - 1]} video's. De cijfers per maand zijn daarom niet één op één vergelijkbaar.`);
  const pakketNamen = [...new Set(pakketten.map((p) => String(p.name)).filter(Boolean))];
  if (pakketNamen.length > 1) bijzonderheden.push(`In dit kwartaal golden meerdere pakketten: ${pakketNamen.join(", ")}.`);
  if (startdatum && startdatum > q.from && startdatum <= q.to) bijzonderheden.push(`De samenwerking startte op ${kortDatum(startdatum)}. Dit is dus geen volledig kwartaal.`);
  const pakket: PakketInfo = {
    type, label: PAKKET_LABEL[type], naam: pakketNamen.length ? pakketNamen[pakketNamen.length - 1]! : null,
    videosPerMaand: perMaandOp(tot), startdatum, verwachtInKwartaal, bijzonderheden,
    bron: contracts.some((c) => c.videos_per_month != null) ? "Contractperiode in Contracten & Verlengingen" : pakketten.length ? "Pakket in de klantadministratie" : quota > 0 ? "Afname per maand bij de klantgegevens" : "Niet vastgelegd",
  };

  /* ---- Vorig kwartaal ---- */
  const prevQ = previousQuarter(q, startdatum);
  let vorig: VorigKwartaal | null = null;
  if (prevQ) {
    const [pd, pp] = await Promise.all([dayRows(clientId, prevQ.from, prevQ.to), pubRows(clientId, prevQ.from, prevQ.to)]);
    const pt = totalOf(pd, new Set(pp.map(videoKey)).size, daysInRange(prevQ.from, prevQ.to));
    const bestond = !startdatum || startdatum <= prevQ.to;
    const check = bestond
      ? vergelijkbaarheid(
          { dagen: dagenTotaal, meetdagen: totaal.meetdagen, platforms: [...new Set(days.map((d) => d.platform ?? "totaal"))] },
          { dagen: pt.dagen, meetdagen: pt.meetdagen, platforms: [...new Set(pd.map((d) => d.platform ?? "totaal"))] },
        )
      : { vergelijkbaar: false, redenen: ["De samenwerking liep in het vorige kwartaal nog niet."] };
    if (voorlopig && check.vergelijkbaar) { check.vergelijkbaar = false; check.redenen.push("Dit kwartaal loopt nog; de vergelijking volgt met de definitieve cijfers."); }
    if (startdatum && startdatum > prevQ.from && startdatum <= prevQ.to && check.vergelijkbaar) { check.vergelijkbaar = false; check.redenen.push("Het vorige kwartaal was geen volledig kwartaal (de samenwerking startte toen)."); }
    vorig = {
      key: prevQ.key, label: prevQ.label, ...check,
      totaal: pt.meetdagen > 0 || pt.videos > 0 ? pt : null,
      pct: check.vergelijkbaar ? {
        views: pctChange(totaal.views, pt.views), reach: pctChange(totaal.reach, pt.reach), engagements: pctChange(totaal.engagements, pt.engagements),
        videos: pctChange(totaal.videos, pt.videos),
        gemViewsPerVideo: totaal.gemViewsPerVideo !== null ? pctChange(totaal.gemViewsPerVideo, pt.gemViewsPerVideo) : null,
        followerGrowth: pt.followerGrowth > 0 ? pctChange(totaal.followerGrowth, pt.followerGrowth) : null,
      } : {},
    };
  }

  /* ---- Verbetermonitor: opvolging van de vorige rapportage ---- */
  let verbetermonitor: QuarterMetrics["verbetermonitor"] = null;
  if (prevQ) {
    const res = await db.execute(sql`
      select i.id, i.titel, i.actie, i.status, i.note from quarterly_improvements i
      where i.client_id = ${clientId} and i.period_key = ${prevQ.key} order by i.position`);
    const items = rowsOf<Record<string, unknown>>(res).map((r) => ({ id: String(r.id), titel: String(r.titel), actie: String(r.actie ?? ""), status: String(r.status), note: r.note ? String(r.note) : null }));
    if (items.length) verbetermonitor = { periodLabel: prevQ.label, items };
  }

  /* ---- Doelen ---- */
  const waarde: Record<string, number | null> = {
    views: totaal.views, reach: totaal.reach, engagements: totaal.engagements, followerGrowth: totaal.followerGrowth,
    videos: totaal.videos, websiteKlikken, conversies, gemViewsPerVideo: totaal.gemViewsPerVideo,
  };
  const doelen: DoelRealisatie[] = (input.doelen ?? []).map((d) => {
    const g = d.metric in waarde ? waarde[d.metric]! : null;
    return { ...d, gerealiseerd: g, behaald: g === null || voorlopig ? null : g >= d.target };
  });

  /* ---- Klantfeedback ---- */
  const fb = rowsOf<{ kind: string; c: number }>(fbRes);
  const fbCount = (k: string) => n(fb.find((r) => String(r.kind) === k)?.c);
  const feedback = fb.length ? { signalen: fbCount("aandacht") + fbCount("ernstig"), ernstig: fbCount("ernstig") } : null;

  /* ---- Datakwaliteit, ontbrekende gegevens en bronnen ---- */
  const gekoppeld = n(rowsOf<{ c: number }>(linkRes)[0]?.c) > 0;
  const laatsteMeting = rowsOf<{ d: string | null }>(lastRes)[0]?.d ?? null;
  const ontbrekend: string[] = [];
  const dataKwaliteit: string[] = [];
  if (!gekoppeld) ontbrekend.push("Er is geen actieve Metricool-koppeling voor deze klant. Zonder koppeling komen er geen socialmediacijfers binnen.");
  if (totaal.meetdagen === 0) ontbrekend.push("Er zijn in dit kwartaal geen dagcijfers (weergaven, bereik, interacties) beschikbaar.");
  else if (totaal.meetdagen < totaal.dagen * 0.9) ontbrekend.push(`Er zijn maar voor ${totaal.meetdagen} van de ${totaal.dagen} dagen cijfers beschikbaar.`);
  for (const s of segmenten) if (s.dagen > 0 && s.meetdagen === 0 && totaal.meetdagen > 0) ontbrekend.push(`Voor ${s.label} zijn geen cijfers beschikbaar.`);
  if (byVideo.size === 0) ontbrekend.push("Er zijn in dit kwartaal geen gepubliceerde video's geregistreerd.");
  const zonderCijfers = videos.length - gemeten.length;
  if (zonderCijfers > 0) ontbrekend.push(`${zonderCijfers} gepubliceerde ${zonderCijfers === 1 ? "video heeft" : "video's hebben"} (nog) geen eigen cijfers.`);
  const nietGekoppeld = [...byVideo.keys()].filter((k) => !k.startsWith("d:")).length;
  if (nietGekoppeld > 0 && geleverd.pipelineBijgehouden) dataKwaliteit.push(`${nietGekoppeld} gepubliceerde ${nietGekoppeld === 1 ? "video is" : "video's zijn"} niet gekoppeld aan een video in het portaal (geen script, format of hook beschikbaar).`);
  if (!geleverd.pipelineBijgehouden) dataKwaliteit.push("De videopijplijn (opnames en opleveringen) is voor deze klant niet bijgehouden; geproduceerde en opgeleverde aantallen ontbreken.");
  if (kijktijd.videosMetMeting === 0 && gemeten.length > 0) dataKwaliteit.push("Kijktijd en uitkijkpercentage zijn voor dit kwartaal niet gemeten.");
  if (websiteKlikken === null) dataKwaliteit.push("Websiteklikken zijn niet gemeten.");
  if (conversies === null) dataKwaliteit.push("Er is geen conversiemeting beschikbaar. Aanvragen, leads en omzet zijn daardoor niet vast te stellen.");
  if (platforms.filter((p) => p.platform !== "totaal").length > 1) dataKwaliteit.push("Bereik is per kanaal opgeteld. Iemand die via twee kanalen is bereikt, telt twee keer mee; het is dus geen aantal unieke personen.");
  if (type === "onbekend") ontbrekend.push("Bij de klant is niet ingesteld of het om organische content, advertentiecontent of beide gaat.");
  if (pakket.videosPerMaand === null) dataKwaliteit.push("Er is geen afgesproken aantal video's per maand vastgelegd; de voortgang van het pakket is niet te beoordelen.");
  if (!startdatum) dataKwaliteit.push("De startdatum van de samenwerking is niet ingevuld.");
  if (q.mode === "contract" && q.index === 0) ontbrekend.push("De klant gebruikt contractkwartalen, maar de startdatum van de samenwerking ontbreekt of past niet bij deze periode.");
  if ((input.doelen ?? []).length === 0) dataKwaliteit.push("Er zijn voor dit kwartaal geen doelen vastgelegd.");
  const advertenties = { gekoppeld: false as const, toelichting: "Advertentiecijfers (klikratio, kosten per resultaat, leads en conversies) zijn niet gekoppeld aan het portaal. Het mediabudget en de campagneoptimalisatie vallen buiten de cijfers in deze rapportage." };
  if (type === "advertentie" || type === "beide") ontbrekend.push("Advertentiecijfers zijn niet beschikbaar: er is geen koppeling met het advertentieaccount van de klant.");

  // Compleet = het kwartaal is voorbij en de dagcijfers lopen door tot en met de laatste dag.
  let dataWachtReden: string | null = null;
  if (voorlopig) dataWachtReden = `Het kwartaal loopt nog tot en met ${kortDatum(q.to)}.`;
  else if (!gekoppeld) dataWachtReden = "Geen actieve Metricool-koppeling: er komen geen cijfers binnen.";
  else if (!laatsteMeting) dataWachtReden = "Er zijn nog geen dagcijfers voor dit kwartaal binnengekomen.";
  else if (laatsteMeting < q.to) dataWachtReden = `De cijfers lopen pas tot en met ${kortDatum(laatsteMeting)}; het kwartaal eindigde op ${kortDatum(q.to)}.`;
  const dataCompleet = dataWachtReden === null;

  const bronnen: Bron[] = [
    { naam: "Metricool dagcijfers (weergaven, bereik, interacties, volgers)", periode: `${kortDatum(q.from)} t/m ${kortDatum(tot)}`, opmerking: totaal.meetdagen ? `${totaal.meetdagen} van ${totaal.dagen} dagen gemeten` : "Geen metingen" },
    { naam: "Metricool cijfers per video (laatst gemeten stand)", periode: `Video's gepubliceerd ${kortDatum(q.from)} t/m ${kortDatum(tot)}`, opmerking: `${gemeten.length} van ${videos.length} video's met cijfers` },
    { naam: "Publicatielijst van het portaal", periode: `${kortDatum(q.from)} t/m ${kortDatum(tot)}`, opmerking: `${geleverd.plaatsingen} plaatsingen, ${geleverd.gepubliceerd} unieke video's` },
    { naam: "Opnameplanning, editing en scripting", periode: `${kortDatum(q.from)} t/m ${kortDatum(tot)}`, opmerking: geleverd.pipelineBijgehouden ? null : "Niet bijgehouden voor deze klant" },
    { naam: "Klantgegevens, pakket en contract", periode: "Stand bij genereren", opmerking: pakket.bron },
  ];

  return {
    periode: { key: q.key, mode: q.mode, label: q.label, from: q.from, to: q.to, dagen: dagenTotaal },
    gemetenTot: totaal.meetdagen ? days.map((d) => d.dag).sort().at(-1) ?? null : null,
    voorlopig, segmenten, totaal, kijktijd, profielbezoeken, websiteKlikken, conversies,
    platforms, videos: videos.slice(0, 60), formats, geleverd, pakket, doelen, vorig, verbetermonitor, feedback,
    advertenties, bronnen, dataKwaliteit, ontbrekend, dataCompleet, dataWachtReden,
  };
}
