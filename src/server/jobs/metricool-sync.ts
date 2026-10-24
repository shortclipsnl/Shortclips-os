import "server-only";
import { and, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientIntegrations, clients, dailyMetrics } from "@/db/schema";
import { normalizeName } from "@/server/import";
import { aliasesForSlug } from "@/server/integrations/client-aliases";
import {
  METRICOOL_NETWORKS,
  metricool,
  metricoolDate,
  type MetricoolService,
} from "@/server/integrations/metricool";
import { runJob } from "./runner";

type Source = Pick<MetricoolService, "listBrands" | "timeline">;

/**
 * Koppelt Metricool-merken automatisch aan klanten op naam (+ bekende aliassen),
 * net als bij Frame.io en Monday. Eén merk → één klant.
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
              config: { userId: brand.userId },
              lastSyncedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [clientIntegrations.clientId, clientIntegrations.provider, clientIntegrations.externalId],
              set: {
                externalName: brand.label,
                config: { userId: brand.userId },
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

/** Welke daily_metrics-kolom bij welke Metricool-metric (+ subject) hoort. */
const METRIC_MAP = [
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
] as const;

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

      for (const link of links) {
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
          for (const { field, subject, metric } of METRIC_MAP) {
            const points = await source.timeline(blogId, userId, network, subject, metric, fromISO, toISO);
            for (const p of points) add(p.date, field as keyof DayAgg, p.value);
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

/** Koppelen + cijfers ophalen in één keer. */
export async function runMetricoolSync(triggeredById?: string, source: Source = metricool) {
  const link = await linkMetricoolBrands(triggeredById, source);
  const metrics = await pullMetricoolMetrics(triggeredById, source);
  return { ok: link.ok && metrics.ok, link, metrics };
}
