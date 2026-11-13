import "server-only";
import { deltaPct, rankByCategory, type Period, type VideoCard } from "@/lib/resultaten-overzicht";
import { loadResultsOverview } from "@/server/resultaten-overzicht";

/**
 * Data voor de presentatiemodus van de resultatenpagina. Alles komt uit
 * dezelfde bron als /analytics (loadResultsOverview), zodat de cijfers op de
 * pagina en in de presentatie altijd gelijk zijn. Gemiddelden worden alleen
 * berekend over video's waarvoor het platform het cijfer echt levert.
 */

export type PresentationClient = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  logoUrl: string | null;
  views: number;
  viewsDelta: number | null;
  reach: number | null;
  interactions: number;
  followers: number;
  videos: number;
  best: VideoCard | null;
};

export type PresentationData = {
  periodKey: string;
  periodLabel: string;
  prevLabel: string;
  lastUpdated: string | null;
  generatedAt: string;
  clientCount: number;
  totals: {
    views: number;
    viewsDelta: number | null;
    reach: number;
    reachDelta: number | null;
    interactions: number;
    followers: number;
    videos: number;
    videosDelta: number | null;
    series: number[];
    /** Gewogen naar weergaven; null als geen enkele video kijktijd levert. */
    avgWatchSeconds: number | null;
    avgRetention: number | null;
    watchSample: number;
    retentionSample: number;
  };
  top: VideoCard[];
  hooks: VideoCard[];
  watch: VideoCard[];
  reach: VideoCard[];
  clients: PresentationClient[];
};

function weighted(cards: VideoCard[], pick: (c: VideoCard) => number | null | undefined): { value: number | null; n: number } {
  let sum = 0;
  let w = 0;
  let n = 0;
  for (const c of cards) {
    const v = pick(c);
    if (v == null || v <= 0) continue;
    const weight = Math.max(1, c.views);
    sum += v * weight;
    w += weight;
    n++;
  }
  return { value: w > 0 ? sum / w : null, n };
}

export async function loadPresentation(period: Period): Promise<PresentationData> {
  const data = await loadResultsOverview(period);
  const linked = data.clients.filter((c) => c.linked);
  const { totals } = data;

  const watch = weighted(data.videos, (c) => c.avgWatchSeconds);
  const ret = weighted(data.videos, (c) => c.retention);

  const bestByClient = new Map<string, VideoCard>();
  for (const v of data.videos) {
    const cur = bestByClient.get(v.clientId);
    const score = (x: VideoCard) => x.totalScore ?? -1;
    if (!cur || score(v) > score(cur) || (score(v) === score(cur) && v.views > cur.views)) bestByClient.set(v.clientId, v);
  }

  return {
    periodKey: period.key,
    periodLabel: period.label,
    prevLabel: period.prevLabel,
    lastUpdated: data.lastUpdated,
    generatedAt: new Date().toISOString(),
    clientCount: linked.length,
    totals: {
      views: totals.views,
      viewsDelta: deltaPct(totals.viewsCompare, totals.viewsPrev),
      reach: totals.reach,
      reachDelta: deltaPct(totals.reachCompare, totals.reachPrev),
      interactions: totals.likes + totals.comments + (totals.saves ?? 0),
      followers: totals.followers,
      videos: totals.videos,
      videosDelta: deltaPct(totals.videos, totals.videosPrev),
      series: totals.series,
      avgWatchSeconds: watch.value,
      avgRetention: ret.value,
      watchSample: watch.n,
      retentionSample: ret.n,
    },
    top: rankByCategory(data.videos, "totaal", 5),
    hooks: rankByCategory(data.videos, "hooks", 5),
    watch: rankByCategory(data.videos, "kijktijd", 5),
    reach: rankByCategory(data.videos, "weergaven", 8),
    clients: linked
      .filter((c) => c.views > 0 || c.videos > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        color: c.color,
        logoUrl: c.logoUrl,
        views: c.views,
        viewsDelta: deltaPct(c.viewsCompare, c.viewsPrev),
        reach: c.reachAvailable ? c.reach : null,
        interactions: c.likes + c.comments + (c.saves ?? 0),
        followers: c.followers,
        videos: c.videos,
        best: bestByClient.get(c.id) ?? null,
      })),
  };
}
