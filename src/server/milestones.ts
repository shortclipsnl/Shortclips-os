import "server-only";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { getPortalCollaboration, getPortalResults } from "@/server/portal";
import { getMilestoneVideos } from "@/server/milestone-videos";
import {
  AWARDS,
  MONTHS_SHORT,
  longDateNl,
  monthNameNl,
  type AwardState,
  type MilestonesData,
  type MilestonesYear,
} from "@/lib/milestones";

/**
 * Fysieke Short Video Award: die is exclusief en reiken we alleen uit aan
 * gekozen partners. Alleen klanten in deze lijst (exacte klantnaam zoals in het
 * portaal, hoofdletters maken niet uit) zien hun award digitaal op de pagina
 * Onze mijlpalen. Eén regel per jaar.
 */
const PHYSICAL_AWARD_CLIENTS: Record<number, string[]> = {
  2026: [],
};

const TZ = "Europe/Amsterdam";
const nf = new Intl.NumberFormat("nl-NL");

function rowsOf<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[])) ?? [];
}
function amsDay(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: TZ });
}
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}
function plural(n: number, one: string, many: string): string {
  return `${nf.format(n)} ${n === 1 ? one : many}`;
}

/**
 * Alles voor "Onze mijlpalen", volledig automatisch uit bestaande gegevens:
 * gepubliceerde video's (deliverables), dagelijkse statistieken (daily_metrics,
 * dezelfde bron als Resultaten) en de startdatum van de samenwerking. Hard
 * gescoped op de klant van de ingelogde gebruiker; niets wordt verzonnen.
 */
export async function getPortalMilestones(viewer: Viewer): Promise<MilestonesData> {
  const clientId = viewer.clientId;
  if (!clientId) notFound();

  const today = amsDay(new Date());
  const year = Number(today.slice(0, 4));

  const [collab, [client], videoRows, dailyRes, videoLists] = await Promise.all([
    getPortalCollaboration(viewer),
    db.select({ name: clients.name }).from(clients).where(and(eq(clients.id, clientId), isNull(clients.deletedAt))).limit(1),
    db
      .select({ at: deliverables.publishedAt })
      .from(deliverables)
      .where(and(eq(deliverables.clientId, clientId), isNull(deliverables.deletedAt), eq(deliverables.status, "published")))
      .orderBy(asc(deliverables.publishedAt)),
    db.execute(sql`
      select measured_on::text d, coalesce(sum(views),0)::bigint v, coalesce(sum(engagements),0)::bigint e
      from daily_metrics where client_id = ${clientId}
      group by measured_on order by measured_on`),
    getMilestoneVideos(clientId),
  ]);
  if (!client) notFound();

  const startRaw = collab.contract?.startsOn ?? collab.startedOn ?? null;
  const startedOn = startRaw ? String(startRaw).slice(0, 10) : null;
  const daysTogether = startedOn ? Math.max(0, daysBetween(startedOn, today)) : null;

  // Video's: totaal + publicatiedatum per video (op volgorde).
  const totalVideos = videoRows.length;
  const videoDates = videoRows.map((r) => (r.at ? amsDay(new Date(r.at)) : null)).filter((d): d is string => !!d);
  const videosUntil = (iso: string) => videoDates.filter((d) => d <= iso).length;

  // Dagelijkse cijfers → totalen en het moment waarop een drempel werd gepasseerd.
  const daily = rowsOf<{ d: string; v: string | number; e: string | number }>(dailyRes).map((r) => ({ d: String(r.d), v: Number(r.v ?? 0), e: Number(r.e ?? 0) }));
  const totalViews = daily.reduce((s, r) => s + r.v, 0);
  const totalInteractions = daily.reduce((s, r) => s + r.e, 0);
  const lastUpdated = daily.length ? daily[daily.length - 1]!.d : null;
  const crossedOn = (threshold: number): string | null => {
    let cum = 0;
    for (const r of daily) {
      cum += r.v;
      if (cum >= threshold) return r.d;
    }
    return null;
  };
  const dayOf = (iso: string) => (startedOn ? daysBetween(startedOn, iso) : null);

  const awards: AwardState[] = AWARDS.map((a) => {
    if (a.category === "bereik") {
      const achieved = totalViews >= a.threshold;
      const on = achieved ? crossedOn(a.threshold) : null;
      const day = on ? dayOf(on) : null;
      const vids = on ? videosUntil(on) : 0;
      return {
        ...a,
        achieved,
        achievedOn: on,
        current: totalViews,
        progressPct: Math.min(100, (totalViews / a.threshold) * 100),
        resultLine: achieved
          ? `${nf.format(a.threshold)} views${day && day > 0 ? ` na ${plural(day, "dag", "dagen")} samenwerking` : ""}${vids > 0 ? `, met ${plural(vids, "gepubliceerde video", "gepubliceerde video's")}` : ""}. Inmiddels ${nf.format(totalViews)} views.`
          : null,
        remainingLine: `Nog ${nf.format(a.threshold - totalViews)} views`,
      };
    }
    if (a.category === "content") {
      const achieved = totalVideos >= a.threshold;
      const on = achieved ? (videoDates[a.threshold - 1] ?? null) : null;
      const day = on ? dayOf(on) : null;
      const left = a.threshold - totalVideos;
      return {
        ...a,
        achieved,
        achievedOn: on,
        current: totalVideos,
        progressPct: Math.min(100, (totalVideos / a.threshold) * 100),
        resultLine: achieved
          ? `${a.threshold}e video gepubliceerd${on ? ` op ${longDateNl(on)}` : ""}${day && day > 0 ? `, dag ${nf.format(day)} van de samenwerking` : ""}. Inmiddels ${plural(totalVideos, "video", "video's")}.`
          : null,
        remainingLine: `Nog ${plural(left, "video", "video's")}`,
      };
    }
    // Samenwerking
    const due = startedOn ? addMonths(startedOn, a.threshold) : null;
    const achieved = !!due && due <= today;
    const totalDays = startedOn && due ? daysBetween(startedOn, due) : 0;
    return {
      ...a,
      achieved,
      achievedOn: achieved ? due : null,
      current: daysTogether ?? 0,
      progressPct: totalDays > 0 ? Math.min(100, ((daysTogether ?? 0) / totalDays) * 100) : 0,
      resultLine: achieved && startedOn && due
        ? `Samenwerking gestart op ${longDateNl(startedOn)}, ${plural(videosUntil(due), "video", "video's")} gepubliceerd in deze periode.`
        : null,
      remainingLine: due ? `Op ${longDateNl(due)}` : "Startdatum nog niet bekend",
    };
  });

  const next = (["bereik", "content", "samenwerking"] as const)
    .map((c) => awards.find((a) => a.category === c && !a.achieved))
    .filter((a): a is AwardState => !!a && (a.category !== "samenwerking" || !!startedOn))
    .sort((a, b) => b.progressPct - a.progressPct);

  // Jaaroverzicht (dit kalenderjaar, tot vandaag).
  const yearStart = `${year}-01-01`;
  const yDaily = daily.filter((r) => r.d >= yearStart && r.d <= today);
  const yViews = yDaily.reduce((s, r) => s + r.v, 0);
  const yInteractions = yDaily.reduce((s, r) => s + r.e, 0);
  const yVideos = videoDates.filter((d) => d >= yearStart && d <= today).length;
  let yearData: MilestonesYear | null = null;
  if (yViews > 0 || yVideos > 0) {
    const firstMonth = Math.min(
      ...[yDaily[0]?.d, videoDates.find((d) => d >= yearStart), startedOn && startedOn >= yearStart ? startedOn : undefined]
        .filter((d): d is string => !!d)
        .map((d) => Number(d.slice(5, 7)) - 1),
    );
    const lastMonth = Number(today.slice(5, 7)) - 1;
    const monthly: MilestonesYear["monthly"] = [];
    for (let m = Number.isFinite(firstMonth) ? firstMonth : 0; m <= lastMonth; m++) {
      const key = `${year}-${String(m + 1).padStart(2, "0")}`;
      monthly.push({ label: MONTHS_SHORT[m]!, views: yDaily.filter((r) => r.d.startsWith(key)).reduce((s, r) => s + r.v, 0) });
    }
    let growth: MilestonesYear["growth"] = null;
    const firstIdx = Number.isFinite(firstMonth) ? firstMonth : 0;
    for (let i = 1; i < monthly.length; i++) {
      const p = monthly[i - 1]!.views, v = monthly[i]!.views;
      if (p <= 0 || v <= p) continue;
      if (!growth || v - p > growth.views - growth.prevViews) {
        growth = { month: monthNameNl(firstIdx + i), prevMonth: monthNameNl(firstIdx + i - 1), prevViews: p, views: v, pct: Math.round(((v - p) / p) * 100) };
      }
    }
    if (growth && growth.pct < 10) growth = null;

    let bestVideo: MilestonesYear["bestVideo"] = null;
    try {
      const r = await getPortalResults(viewer, { from: yearStart, to: today, periodKey: "custom" });
      const t = r.topVideos[0];
      if (t && t.views > 0) {
        bestVideo = {
          title: t.title,
          views: t.views,
          interactions: t.likes + t.comments + t.shares + t.saves,
          platform: t.platform,
          publishedAt: t.publishedAt,
          thumbnailUrl: t.thumbnailUrl,
          url: t.url,
        };
      }
    } catch {
      /* zonder beste video is het jaaroverzicht nog steeds compleet */
    }
    const from = startedOn && startedOn > yearStart ? startedOn : yearStart;
    yearData = {
      year,
      videos: yVideos,
      views: yViews,
      interactions: yInteractions,
      monthly,
      bestVideo,
      growth,
      awardKeys: awards.filter((a) => a.achieved && a.achievedOn?.startsWith(String(year))).map((a) => a.key),
      periodLabel: `${longDateNl(from)} tot en met ${longDateNl(today)}`,
    };
  }

  const awardList = (PHYSICAL_AWARD_CLIENTS[year] ?? []).map((n) => n.trim().toLowerCase());
  const physicalAward = awardList.includes(client.name.trim().toLowerCase())
    ? { year, videos: yVideos, views: yViews, interactions: yInteractions, standOn: lastUpdated && lastUpdated < today ? lastUpdated : today }
    : null;

  return {
    clientName: client.name,
    startedOn,
    daysTogether,
    totals: { videos: totalVideos, views: totalViews, interactions: totalInteractions, firstVideoOn: videoDates[0] ?? null },
    awards,
    next,
    year: yearData,
    physicalAward,
    lastUpdated,
    videos: videoLists.videos,
    library: videoLists.library,
  };
}
