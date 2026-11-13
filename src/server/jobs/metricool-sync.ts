import "server-only";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientIntegrations, clients, dailyMetrics, publications, socialMetrics } from "@/db/schema";
import { normalizeName } from "@/server/import";
import { aliasesForSlug } from "@/server/integrations/client-aliases";
import {
  METRICOOL_NETWORKS,
  metricool,
  metricoolDate,
  type MetricoolService,
} from "@/server/integrations/metricool";
import { toDailySeries } from "@/lib/metric-series";
import { runJob } from "./runner";

type Source = Pick<MetricoolService, "listBrands" | "timeline">;

/**
 * Downloadt een miniatuur (max. 5 MB, 8 s) en bewaart een verkleinde kopie
 * (180 px breed, JPEG) als data-URI van ~10-20 kB. Lukt verkleinen niet, dan
 * alleen het origineel als dat klein genoeg is. Anders null.
 */
async function downloadThumbnail(url: string): Promise<string | null> {
  if (!/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 5_000_000) return null;
    try {
      const sharp = (await import("sharp")).default;
      const small = await sharp(buf).resize({ width: 180, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
      return `data:image/jpeg;base64,${small.toString("base64")}`;
    } catch {
      return buf.length <= 150_000 ? `data:${type};base64,${buf.toString("base64")}` : null;
    }
  } catch {
    return null;
  }
}

/**
 * Koppelingen naar merken die niet (meer) in het Metricool-account bestaan
 * overslaan en uitzetten. Metricool geeft voor een onbekend merk-id anders de
 * cijfers van een ánder merk terug, waardoor klanten elkaars cijfers kregen.
 * Uitzetten is omkeerbaar (Instellingen → Koppelingen); er wordt niets gewist.
 */
async function knownBrandIds(source: Pick<MetricoolService, "listBrands">, log: (m: string, level?: "warn") => void): Promise<Set<string> | null> {
  try {
    const brands = await source.listBrands();
    return new Set(brands.map((b) => String(b.id)));
  } catch {
    log("Merkenlijst niet op te halen; merk-controle overgeslagen.", "warn");
    return null;
  }
}

async function skipUnknownBrand(known: Set<string> | null, link: { clientId: string; blogId: string }, log: (m: string, level?: "warn") => void): Promise<boolean> {
  if (!known || known.has(String(link.blogId))) return false;
  log(`Merk ${link.blogId} bestaat niet (meer) in Metricool: koppeling uitgezet, cijfers niet opgehaald.`, "warn");
  await db
    .update(clientIntegrations)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(clientIntegrations.clientId, link.clientId), eq(clientIntegrations.provider, "metricool"), eq(clientIntegrations.externalId, String(link.blogId))));
  return true;
}


/**
 * Koppelt Metricool-merken automatisch aan klanten op naam (+ bekende aliassen),
 * net als bij Frame.io. Eén merk → één klant.
 */
export async function linkMetricoolBrands(triggeredById?: string, source: Source = metricool) {
  return runJob(
    "metricool",
    "metricool.link_brands",
    {},
    async (ctx) => {
      const brands = await source.listBrands();
      ctx.log(`${brands.length} Metricool-merken gevonden`);
      ctx.counters.processed = brands.length;

      const clientRows = await db
        .select({ id: clients.id, name: clients.name, slug: clients.slug })
        .from(clients)
        .where(isNull(clients.deletedAt));

      for (const brand of brands) {
        const nName = normalizeName(brand.label);
        const hits = clientRows.filter((c) => {
          if (normalizeName(c.name) === nName || normalizeName(c.slug) === nName) return true;
          return aliasesForSlug(c.slug).some((a) => normalizeName(a) === nName);
        });

        if (hits.length === 1) {
          await db
            .insert(clientIntegrations)
            .values({
              clientId: hits[0]!.id,
              provider: "metricool",
              externalId: String(brand.id),
              externalName: brand.label,
              config: { userId: brand.userId, networks: brand.networks },
              lastSyncedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [clientIntegrations.clientId, clientIntegrations.provider, clientIntegrations.externalId],
              set: {
                externalName: brand.label,
                config: { userId: brand.userId, networks: brand.networks },
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
              },
            });
          ctx.counters.updated++;
          ctx.log(`Merk "${brand.label}" gekoppeld.`);
        } else {
          ctx.log(
            `Merk "${brand.label}": ${hits.length === 0 ? "geen" : `${hits.length} mogelijke`} klant — alias toevoegen.`,
            "warn",
          );
        }
      }
    },
    { triggeredById },
  );
}

type MetricSpec = { field: string; subject: string; metric: string; sign?: 1 | -1 };

/**
 * Welke daily_metrics-kolom bij welke Metricool-metric (+ subject) hoort, per
 * netwerk. Elk netwerk heeft in de Metricool-API eigen metricnamen; met alleen
 * de Instagram-namen kwam er voor TikTok niets binnen.
 */
const METRIC_MAP_INSTAGRAM: MetricSpec[] = [
  { field: "views", subject: "account", metric: "views" },
  { field: "reach", subject: "account", metric: "reach" },
  { field: "engagements", subject: "account", metric: "postsInteractions" },
  { field: "followerDelta", subject: "account", metric: "delta_followers" },
  { field: "followers", subject: "account", metric: "Followers" },
  // Waardevolle interacties + kijktijd komen uit de reels-cijfers.
  { field: "likes", subject: "reels", metric: "likes" },
  { field: "comments", subject: "reels", metric: "comments" },
  { field: "shares", subject: "reels", metric: "shares" },
  { field: "saves", subject: "reels", metric: "saved" },
  { field: "watchSeconds", subject: "reels", metric: "ig_reels_video_view_total_time" },
  { field: "videoViews", subject: "reels", metric: "videoviews" },
];
const METRIC_MAP_TIKTOK: MetricSpec[] = [
  { field: "views", subject: "account", metric: "video_views" },
  { field: "followerDelta", subject: "account", metric: "followers_delta_count" },
  { field: "followers", subject: "account", metric: "followers_count" },
  { field: "likes", subject: "account", metric: "likes" },
  { field: "comments", subject: "account", metric: "comments" },
  { field: "shares", subject: "account", metric: "shares" },
  // Interacties = likes + reacties + shares (TikTok kent geen aparte totaalmetric).
  { field: "engagements", subject: "account", metric: "likes" },
  { field: "engagements", subject: "account", metric: "comments" },
  { field: "engagements", subject: "account", metric: "shares" },
];
const METRIC_MAP_FACEBOOK: MetricSpec[] = [
  // Bewust geen paginabrede weergaven (page_media_view): die tellen ook
  // advertenties mee. Facebook-weergaven komen uit de cijfers per reel/post.
  { field: "engagements", subject: "account", metric: "postsInteractions" },
  { field: "followerDelta", subject: "account", metric: "page_daily_follows_unique" },
  { field: "followerDelta", subject: "account", metric: "page_daily_unfollows_unique", sign: -1 },
];
const METRIC_MAP: Record<string, MetricSpec[]> = {
  Instagram: METRIC_MAP_INSTAGRAM,
  Tiktok: METRIC_MAP_TIKTOK,
  Facebook: METRIC_MAP_FACEBOOK,
};

type DayAgg = {
  views: number; reach: number; engagements: number; followerDelta: number; followers: number;
  likes: number; comments: number; shares: number; saves: number; watchSeconds: number; videoViews: number;
};

const EMPTY_AGG = (): DayAgg => ({
  views: 0, reach: 0, engagements: 0, followerDelta: 0, followers: 0,
  likes: 0, comments: 0, shares: 0, saves: 0, watchSeconds: 0, videoViews: 0,
});

/** Metricool-netwerk → ons platform-enum (voor de per-platform uitsplitsing). */
const NETWORK_PLATFORM: Record<string, "instagram" | "tiktok" | "facebook" | "youtube" | "linkedin"> = {
  Instagram: "instagram",
  Tiktok: "tiktok",
  Facebook: "facebook",
  Youtube: "youtube",
  Linkedin: "linkedin",
};

/**
 * Haalt per gekoppelde klant de dagcijfers op (gecombineerd over Instagram,
 * TikTok en Facebook) en schrijft ze naar daily_metrics. Idempotent: vervangt
 * de Metricool-rijen in het venster. Voedt de Resultaten-pagina in het portaal.
 */
export async function pullMetricoolMetrics(
  triggeredById?: string,
  source: Source = metricool,
  // ~6,5 maand historie: genoeg om 30d én 3-maands periodes te vergelijken met
  // een volledige vorige periode.
  days = 200,
) {
  return runJob(
    "metricool",
    "metricool.pull_metrics",
    { days },
    async (ctx) => {
      const links = await db
        .select({ clientId: clientIntegrations.clientId, blogId: clientIntegrations.externalId, config: clientIntegrations.config })
        .from(clientIntegrations)
        .where(and(eq(clientIntegrations.provider, "metricool"), eq(clientIntegrations.isActive, true)));

      ctx.log(`${links.length} gekoppelde Metricool-merken`);

      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - days);
      const fromISO = metricoolDate(from);
      const toISO = metricoolDate(now, true);
      const fromDate = fromISO.slice(0, 10);

      const known = await knownBrandIds(source, (m, l) => ctx.log(m, l));
      for (const link of links) {
        if (await skipUnknownBrand(known, link, (m, l) => ctx.log(m, l))) continue;
        const blogId = Number(link.blogId);
        const userId = Number((link.config as { userId?: number } | null)?.userId ?? 0);
        if (!blogId || !userId) {
          ctx.log(`Merk ${link.blogId}: geen user-id — overslaan.`, "warn");
          continue;
        }

        // Per netwerk apart verzamelen → per-platform rijen in daily_metrics
        // (de gecombineerde cijfers blijven de som over de platforms).
        type Row = typeof dailyMetrics.$inferInsert;
        const rows: Row[] = [];

        for (const network of METRICOOL_NETWORKS) {
          const perDay = new Map<string, DayAgg>();
          const add = (date: string, field: keyof DayAgg, value: number) => {
            const r = perDay.get(date) ?? EMPTY_AGG();
            r[field] += value;
            perDay.set(date, r);
          };
          for (const { field, subject, metric, sign } of METRIC_MAP[network] ?? []) {
            const raw = await source.timeline(blogId, userId, network, subject, metric, fromISO, toISO);
            // Sommige TikTok-accounts leveren de oplopende totaalstand i.p.v. dagcijfers;
            // die zetten we om naar per dag, anders tellen we elke dag alle likes opnieuw.
            const points = network === "Tiktok" && field !== "followers" && field !== "followerDelta" ? toDailySeries(raw) : raw;
            for (const p of points) add(p.date, field as keyof DayAgg, p.value * (sign ?? 1));
          }
          if (perDay.size === 0) continue;
          const platform = NETWORK_PLATFORM[network];
          for (const [date, a] of perDay) {
            rows.push({
              clientId: link.clientId,
              platform,
              measuredOn: date,
              views: Math.max(0, Math.round(a.views)),
              reach: Math.max(0, Math.round(a.reach)),
              engagements: Math.max(0, Math.round(a.engagements)),
              followers: Math.max(0, Math.round(a.followers)),
              followerDelta: Math.round(a.followerDelta),
              likes: Math.max(0, Math.round(a.likes)),
              comments: Math.max(0, Math.round(a.comments)),
              shares: Math.max(0, Math.round(a.shares)),
              saves: Math.max(0, Math.round(a.saves)),
              watchSeconds: Math.max(0, Math.round(a.watchSeconds)),
              videoViews: Math.max(0, Math.round(a.videoViews)),
              source: "metricool",
            });
          }
        }

        if (rows.length === 0) {
          ctx.log(`Merk ${link.blogId}: geen cijfers (netwerk niet gekoppeld?).`, "warn");
          continue;
        }

        // Vervang de bestaande Metricool-rijen in het venster.
        await db
          .delete(dailyMetrics)
          .where(
            and(
              eq(dailyMetrics.clientId, link.clientId),
              eq(dailyMetrics.source, "metricool"),
              gte(dailyMetrics.measuredOn, fromDate),
            ),
          );

        // In blokken invoegen (PGlite/Postgres-parametergrens).
        for (let i = 0; i < rows.length; i += 200) {
          await db.insert(dailyMetrics).values(rows.slice(i, i + 200));
        }

        ctx.counters.processed++;
        ctx.counters.created += rows.length;
        ctx.log(`Merk ${link.blogId}: ${rows.length} platform-dagen.`);
      }
    },
    { triggeredById },
  );
}

/** Welke subject-endpoints per netwerk per-post cijfers leveren. Instagram heeft
 *  zowel reels als feed-posts; de overige netwerken hebben één postslijst. */
const POST_SUBJECTS: Record<string, string[]> = {
  Instagram: ["reels", "posts"],
  Tiktok: ["posts"],
  Youtube: ["posts"],
  Facebook: ["reels", "posts"],
  Linkedin: ["posts"],
};

type PostSource = Pick<MetricoolService, "listBrands" | "posts">;

/**
 * Haalt per gekoppelde klant de **per-video cijfers** op (elke reel/post met
 * eigen weergaven, bereik, interacties, kijktijd) en schrijft ze naar
 * `publications` (één rij per post) + `social_metrics` (dagsnapshot). Dit voedt
 * de per-video-inzichten in de AI-analyse en de maandrapportages. Elke post is
 * zichzelf — geen koppeling aan een deliverable nodig, dus geen gokwerk. Reeds
 * bestaande posts worden bijgewerkt (idempotent op externalPostId + meetdag).
 */
export async function pullMetricoolPosts(
  triggeredById?: string,
  source: PostSource = metricool,
  days = 180,
) {
  return runJob(
    "metricool",
    "metricool.pull_posts",
    { days },
    async (ctx) => {
      const links = await db
        .select({ clientId: clientIntegrations.clientId, blogId: clientIntegrations.externalId, config: clientIntegrations.config })
        .from(clientIntegrations)
        .where(and(eq(clientIntegrations.provider, "metricool"), eq(clientIntegrations.isActive, true)));
      ctx.log(`${links.length} gekoppelde Metricool-merken`);

      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - days);
      const fromISO = metricoolDate(from);
      const toISO = metricoolDate(now, true);
      // Meetdag in Amsterdamse tijd: één social_metrics-rij per post per dag.
      const measuredOn = now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

      const thumbBudget = { left: 120 };
      const known = await knownBrandIds(source, (m, l) => ctx.log(m, l));
      for (const link of links) {
        if (await skipUnknownBrand(known, link, (m, l) => ctx.log(m, l))) continue;
        const blogId = Number(link.blogId);
        const userId = Number((link.config as { userId?: number } | null)?.userId ?? 0);
        if (!blogId || !userId) {
          ctx.log(`Merk ${link.blogId}: geen user-id — overslaan.`, "warn");
          continue;
        }

        let count = 0;
        for (const network of METRICOOL_NETWORKS) {
          const platform = NETWORK_PLATFORM[network];
          const seen = new Set<string>();
          for (const subject of POST_SUBJECTS[network] ?? ["posts"]) {
            const posts = await source.posts(blogId, userId, network, subject, fromISO, toISO);
            for (const p of posts) {
              if (seen.has(p.externalId)) continue; // reel kan in meerdere subjects voorkomen
              seen.add(p.externalId);
              const publishedAt = p.publishedAt ? new Date(p.publishedAt) : null;
              const caption = p.caption ? p.caption.slice(0, 2000) : null;
              const [pub] = await db
                .insert(publications)
                .values({ clientId: link.clientId, platform, status: "published", publishedAt, externalPostId: p.externalId, externalUrl: p.url, caption, thumbnailUrl: p.thumbnailUrl, durationSeconds: p.durationSeconds ? Math.round(p.durationSeconds) : null })
                .onConflictDoUpdate({
                  target: [publications.platform, publications.externalPostId],
                  set: { externalUrl: p.url, caption, publishedAt, ...(p.thumbnailUrl ? { thumbnailUrl: p.thumbnailUrl } : {}), ...(p.durationSeconds ? { durationSeconds: Math.round(p.durationSeconds) } : {}), updatedAt: new Date() },
                })
                .returning({ id: publications.id, hasThumb: sql<boolean>`thumbnail_data is not null` });
              if (!pub) continue;
              // Miniatuur eenmalig als kleine kopie bewaren (de bron-URL verloopt),
              // alleen voor recente posts en met een plafond per run.
              if (!pub.hasThumb && p.thumbnailUrl && thumbBudget.left > 0 && publishedAt && Date.now() - publishedAt.getTime() < 70 * 86400000) {
                thumbBudget.left--;
                const data = await downloadThumbnail(p.thumbnailUrl);
                if (data) await db.update(publications).set({ thumbnailData: data }).where(eq(publications.id, pub.id));
              }
              const metricValues = {
                views: Math.max(0, Math.round(p.views)),
                reach: Math.max(0, Math.round(p.reach)),
                likes: Math.max(0, Math.round(p.likes)),
                comments: Math.max(0, Math.round(p.comments)),
                shares: Math.max(0, Math.round(p.shares)),
                saves: Math.max(0, Math.round(p.saves)),
                watchTimeSeconds: Math.max(0, Math.round(p.watchTimeSeconds)),
                avgWatchSeconds: p.avgWatchSeconds != null ? p.avgWatchSeconds.toFixed(2) : null,
                completionRate: p.completionRate != null ? p.completionRate.toFixed(4) : null,
                source: "metricool" as const,
              };
              await db
                .insert(socialMetrics)
                .values({ publicationId: pub.id, clientId: link.clientId, platform, measuredOn, ...metricValues })
                .onConflictDoUpdate({ target: [socialMetrics.publicationId, socialMetrics.measuredOn], set: metricValues });
              count++;
            }
          }
        }

        if (count === 0) {
          ctx.log(`Merk ${link.blogId}: geen posts/reels (netwerk niet gekoppeld?).`, "warn");
          continue;
        }
        ctx.counters.processed++;
        ctx.counters.created += count;
        ctx.log(`Merk ${link.blogId}: ${count} posts/reels bijgewerkt.`);
        // Gepubliceerde video's aan de contentplanning koppelen, zodat planning,
        // resultaten en de Script Engine over dezelfde video praten.
        const linked = await linkPublicationsToPlanning(link.clientId).catch((e) => {
          ctx.log(`Merk ${link.blogId}: koppelen aan contentplanning mislukt (${e instanceof Error ? e.message : e}).`, "warn");
          return 0;
        });
        if (linked) ctx.log(`Merk ${link.blogId}: ${linked} publicatie(s) gekoppeld aan de contentplanning.`);
      }
    },
    { triggeredById },
  );
}

/**
 * Koppelt gepubliceerde posts zonder planningsitem aan het juiste item in de
 * contentplanning: zelfde klant, zelfde caption-opening (eerste 30 letters/
 * cijfers, unicode genormaliseerd) en gepland binnen 21 dagen van de
 * publicatiedatum. Bij meerdere kandidaten wint de dichtstbijzijnde datum.
 * Zet alleen de koppeling; statussen en meldingen blijven onaangeroerd.
 */
export async function linkPublicationsToPlanning(clientId: string): Promise<number> {
  const res = await db.execute(sql`
    with pub as (
      select id, published_at,
             left(lower(regexp_replace(normalize(caption, NFKC), '[^a-zA-Z0-9]', '', 'g')), 30) as k
      from publications
      where client_id = ${clientId} and deleted_at is null and calendar_item_id is null and caption is not null
    ),
    cal as (
      select id, scheduled_on,
             left(lower(regexp_replace(normalize(caption, NFKC), '[^a-zA-Z0-9]', '', 'g')), 30) as k
      from content_calendar
      where client_id = ${clientId} and deleted_at is null and caption is not null
    ),
    pick as (
      select distinct on (pub.id) pub.id as pub_id, cal.id as cal_id
      from pub join cal on cal.k = pub.k and length(pub.k) >= 15
      where pub.published_at is null
         or abs((pub.published_at at time zone 'Europe/Amsterdam')::date - cal.scheduled_on) <= 21
      order by pub.id, abs(coalesce((pub.published_at at time zone 'Europe/Amsterdam')::date, cal.scheduled_on) - cal.scheduled_on)
    )
    update publications p set calendar_item_id = pick.cal_id, updated_at = now()
    from pick where p.id = pick.pub_id
    returning p.id
  `);
  return ((res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])).length;
}

/** Koppelen + cijfers ophalen in één keer (account-dagcijfers + per-video). */
export async function runMetricoolSync(triggeredById?: string, source: Source & PostSource = metricool) {
  const link = await linkMetricoolBrands(triggeredById, source);
  const metrics = await pullMetricoolMetrics(triggeredById, source);
  const posts = await pullMetricoolPosts(triggeredById, source);
  return { ok: link.ok && metrics.ok && posts.ok, link, metrics, posts };
}

/**
 * Dagelijkse, lichte postsync (laatste 45 dagen) als eigen cron, los van de
 * nachtelijke keten: die liep na eerdere stappen tegen de time-out aan,
 * waardoor Metricool vanaf 5 nov 2026 niet meer werd bijgewerkt.
 */
export async function pullMetricoolPostsRecent() {
  return pullMetricoolPosts(undefined, metricool, 45);
}
