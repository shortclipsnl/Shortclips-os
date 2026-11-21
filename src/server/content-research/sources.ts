import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientKnowledge } from "@/db/schema";
import { loadDna } from "./content-dna";
import { analysePosts, type PostAnalysis, type PostRow } from "./post-performance";

/**
 * Gedeelde klantbronnen voor het Contentgeheugen en het stijlprofiel:
 * postmetingen (alleen video's) en tone of voice uit Content DNA en het
 * klantgeheugen. Alles leest uit bestaande tabellen. (De pagina Content
 * Research zelf is in nov 2026 opgegaan in het Contentgeheugen.)
 */

/* ----------------------------- A. Statistieken ----------------------------- */

/**
 * Alleen VIDEO's tellen mee. Klanten plaatsen ook zelf foto- en tekstposts op
 * Facebook en Instagram ("HALLOOOO, WAT EEN TOPPER"); die scoorden soms hoog en
 * trokken de ideeën en hooks een stijl in die niet bij onze video's past.
 * Video herkennen we aan echte kijkdata (duur, kijktijd, afkijkpercentage) of
 * het platform (TikTok is altijd video). Facebook-"posts"-links zonder kijkdata
 * zijn foto/tekst.
 */
export const VIDEO_FILTER = sql`(
  p.platform = 'tiktok'
  or coalesce(p.duration_seconds, 0) > 0
  or coalesce(m.avg_watch_seconds, 0) > 0
  or coalesce(m.watch_time_seconds, 0) > 0
  or m.completion_rate is not null
)`;

export async function loadPostAnalysis(clientId: string, days = 365): Promise<PostAnalysis> {
  const res = await db.execute(sql`
    select p.id as publication_id, p.platform as platform, p.published_at as published_at,
           p.caption as caption, p.external_url as url,
           m.views, m.likes, m.comments, m.shares, m.saves, m.completion_rate, m.avg_watch_seconds
    from publications p
    join lateral (
      select views, likes, comments, shares, saves, completion_rate, avg_watch_seconds, watch_time_seconds
      from social_metrics sm
      where sm.publication_id = p.id
      order by sm.measured_on desc
      limit 1
    ) m on true
    where p.client_id = ${clientId}
      and p.deleted_at is null
      and coalesce(p.published_at, p.created_at) > now() - (${days} || ' days')::interval
      and ${VIDEO_FILTER}
  `);
  const rows = ((res as unknown as { rows?: unknown[] }).rows ?? res) as Array<Record<string, unknown>>;
  const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
  const posts: PostRow[] = rows.map((r) => ({
    publicationId: String(r.publication_id),
    platform: String(r.platform ?? ""),
    publishedAt: (r.published_at as Date | string | null) ?? null,
    caption: (r.caption as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    views: num(r.views),
    likes: num(r.likes),
    comments: num(r.comments),
    shares: num(r.shares),
    saves: num(r.saves),
    completionRate: r.completion_rate == null ? null : Number(r.completion_rate),
    avgWatchSeconds: r.avg_watch_seconds == null ? null : Number(r.avg_watch_seconds),
  }));
  return analysePosts(posts);
}

/* ------------------------------- Tone of voice ------------------------------- */

/**
 * Aanvullende toon-informatie naast het stijlprofiel uit de scripts: Content
 * DNA en tone-of-voice-inzichten uit het klantgeheugen. Bewust GEEN captions
 * of eigen posts van de klant meer: dat is de toon van de klant op Facebook,
 * niet die van onze video's, en dat leverde hooks op die niet bij de klant
 * pasten.
 */
export async function loadToneOfVoice(clientId: string): Promise<string> {
  const [dnaBundle, memory] = await Promise.all([
    loadDna(clientId).catch(() => null),
    db
      .select({ title: clientKnowledge.title, body: clientKnowledge.body })
      .from(clientKnowledge)
      .where(and(
        eq(clientKnowledge.clientId, clientId),
        isNull(clientKnowledge.deletedAt),
        sql`${clientKnowledge.category} in ('tone_of_voice', 'avoid_words', 'hook_style', 'recurring_correction', 'organisch_correctie')`,
      ))
      .limit(15)
      .catch(() => []),
  ]);
  const lines: string[] = [];
  const dna = dnaBundle?.dna;
  if (dna?.doelgroep) lines.push(`Doelgroep: ${dna.doelgroep}`);
  if (dna?.gewensteUitstraling) lines.push(`Gewenste uitstraling: ${dna.gewensteUitstraling}`);
  if (dna?.creatieveBeperkingen?.length) lines.push(`Niet doen: ${dna.creatieveBeperkingen.join(" · ")}`);
  for (const m of memory) lines.push(`Klantgeheugen: ${m.title}: ${m.body}`);
  return lines.join("\n");
}
