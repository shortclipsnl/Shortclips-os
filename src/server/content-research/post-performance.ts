/**
 * Prestaties van eerder gepubliceerde video's, rechtstreeks uit de echte
 * postmetingen (social_metrics + publications, gevuld via Metricool).
 *
 * Waarom apart van performance.ts: die leest alleen opgeslagen AI-analyses en
 * goedgekeurde maandrapportages. In de praktijk waren die leeg, waardoor Content
 * Research geen enkele klantstatistiek gebruikte terwijl de cijfers per post wél
 * in de database staan. Deze module rekent zelf, deterministisch en zonder AI.
 *
 * Uitgangspunten:
 * - Relatief, niet absoluut: elke post wordt vergeleken met de mediaan van
 *   dezelfde klant op hetzelfde platform. Zo telt een sterke post bij een kleine
 *   klant net zo zwaar als bij een grote.
 * - Eerlijk over zekerheid: bij weinig posts is alles een indicatie.
 * - De "hook" is hier de openingsregel van de caption. Dat is NIET per se de
 *   gesproken hook; dat staat er expliciet bij.
 */

export type PostRow = {
  publicationId: string;
  platform: string;
  publishedAt: Date | string | null;
  caption: string | null;
  url: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  completionRate: number | null;
  avgWatchSeconds: number | null;
};

export type ScoredPost = PostRow & {
  /** views / mediaan views van deze klant op dit platform. */
  relatief: number;
  /** (likes + reacties + shares + saves) / views. */
  engagement: number;
  opening: string;
};

export type PlatformSummary = {
  platform: string;
  posts: number;
  medianViews: number;
  medianEngagement: number;
  avgCompletion: number | null;
};

export type PostAnalysis = {
  posts: number;
  periodeVan: string | null;
  periodeTot: string | null;
  platforms: PlatformSummary[];
  top: ScoredPost[];
  zwak: ScoredPost[];
  /** "bewezen" alleen bij genoeg posts; anders "indicatie". */
  zekerheid: "voldoende data" | "indicatie" | "geen data";
};

export const MIN_POSTS_FOR_PATTERNS = 12;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function captionOpening(caption: string | null): string {
  if (!caption) return "";
  const first = caption.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  // Per teken (code point) afknippen: een emoji is twee UTF-16-eenheden en een
  // halve emoji maakt het AI-verzoek ongeldige JSON.
  const chars = Array.from(first);
  return chars.length > 120 ? `${chars.slice(0, 117).join("")}...` : first;
}

function iso(d: Date | string | null): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Pure analyse; geen database, zodat het testbaar is. */
export function analysePosts(rows: PostRow[]): PostAnalysis {
  const usable = rows.filter((r) => Number.isFinite(r.views) && r.views > 0);
  if (usable.length === 0) {
    return { posts: 0, periodeVan: null, periodeTot: null, platforms: [], top: [], zwak: [], zekerheid: "geen data" };
  }

  const byPlatform = new Map<string, PostRow[]>();
  for (const r of usable) {
    const key = (r.platform || "onbekend").toLowerCase();
    byPlatform.set(key, [...(byPlatform.get(key) ?? []), r]);
  }

  const scored: ScoredPost[] = [];
  const platforms: PlatformSummary[] = [];
  for (const [platform, list] of byPlatform) {
    const med = median(list.map((r) => r.views)) || 1;
    const engagements: number[] = [];
    const completions: number[] = [];
    for (const r of list) {
      const engagement = (r.likes + r.comments + r.shares + r.saves) / r.views;
      engagements.push(engagement);
      if (r.completionRate != null && Number.isFinite(r.completionRate)) completions.push(r.completionRate);
      scored.push({ ...r, platform, relatief: r.views / med, engagement, opening: captionOpening(r.caption) });
    }
    platforms.push({
      platform,
      posts: list.length,
      medianViews: Math.round(median(list.map((r) => r.views))),
      medianEngagement: median(engagements),
      avgCompletion: completions.length ? completions.reduce((a, b) => a + b, 0) / completions.length : null,
    });
  }
  platforms.sort((a, b) => b.posts - a.posts);

  // Alleen platforms met minstens 3 posts tellen mee voor top/zwak: met 1–2 posts
  // is "relatief t.o.v. de mediaan" betekenisloos.
  const comparable = scored.filter((p) => (byPlatform.get(p.platform)?.length ?? 0) >= 3);
  const ranked = [...comparable].sort((a, b) => b.relatief - a.relatief || b.engagement - a.engagement);
  const top = ranked.filter((p) => p.relatief >= 1.5).slice(0, 6);
  const zwak = [...ranked].reverse().filter((p) => p.relatief <= 0.5).slice(0, 4);

  const dates = usable.map((r) => iso(r.publishedAt)).filter((d): d is string => Boolean(d)).sort();

  return {
    posts: usable.length,
    periodeVan: dates[0] ?? null,
    periodeTot: dates[dates.length - 1] ?? null,
    platforms,
    top,
    zwak,
    zekerheid: usable.length >= MIN_POSTS_FOR_PATTERNS ? "voldoende data" : "indicatie",
  };
}

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube Shorts",
  linkedin: "LinkedIn",
};

function pct(n: number): string {
  return `${(n * 100).toFixed(1).replace(".", ",")}%`;
}

/** Tekst voor de prompt. Alleen feiten uit de data; interpretatie laat de AI als hypothese. */
export function postAnalysisToText(a: PostAnalysis): string {
  if (a.posts === 0) return "";
  const lines: string[] = [
    `EIGEN STATISTIEKEN (${a.posts} gepubliceerde video's, ${a.periodeVan ?? "?"} t/m ${a.periodeTot ?? "?"}; bron: postmetingen Metricool in het portaal; zekerheid: ${a.zekerheid}).`,
    "Dit zijn FEITEN. Conclusies over het WAAROM zijn hypotheses, tenzij een patroon in meerdere posts terugkomt.",
    "",
    "Per platform (mediaan per video):",
    ...a.platforms.map(
      (p) =>
        `- ${PLATFORM_LABEL[p.platform] ?? p.platform}: ${p.posts} video's, mediaan ${p.medianViews.toLocaleString("nl-NL")} weergaven, engagement ${pct(p.medianEngagement)}${p.avgCompletion != null ? `, gem. uitkijkpercentage ${pct(p.avgCompletion > 1 ? p.avgCompletion / 100 : p.avgCompletion)}` : ""}`,
    ),
  ];
  if (a.top.length) {
    lines.push("", "Bovengemiddeld (relatief t.o.v. de eigen mediaan op dat platform; captionopening is NIET per se de gesproken hook):");
    for (const p of a.top) {
      lines.push(
        `- ${p.relatief.toFixed(1).replace(".", ",")}x mediaan op ${PLATFORM_LABEL[p.platform] ?? p.platform} (${p.views.toLocaleString("nl-NL")} weergaven, engagement ${pct(p.engagement)})${p.opening ? `: "${p.opening}"` : ""}${p.url ? ` [${p.url}]` : ""}`,
      );
    }
  }
  if (a.zwak.length) {
    lines.push("", "Duidelijk ondergemiddeld (≤ 0,5x mediaan):");
    for (const p of a.zwak) {
      lines.push(`- ${p.relatief.toFixed(1).replace(".", ",")}x mediaan op ${PLATFORM_LABEL[p.platform] ?? p.platform}${p.opening ? `: "${p.opening}"` : ""}`);
    }
  }
  return lines.join("\n");
}
