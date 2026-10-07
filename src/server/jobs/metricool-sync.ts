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

type Source = Pick<MetricoolService, "listBrands" | "accountTimeline">;

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

/** Welke daily_metrics-kolom bij welke Metricool-account-metric hoort. */
const METRIC_MAP = [
  { field: "views", metric: "views" },
  { field: "reach", metric: "reach" },
  { field: "engagements", metric: "postsInteractions" },
  { field: "followerDelta", metric: "delta_followers" },
  { field: "followers", metric: "Followers" },
] as const;

type DayAgg = { views: number; reach: number; engagements: number; followerDelta: number; followers: number };

/**
 * Haalt per gekoppelde klant de dagcijfers op (gecombineerd over Instagram,
 * TikTok en Facebook) en schrijft ze naar daily_metrics. Idempotent: vervangt
 * de Metricool-rijen in het venster. Voedt de Resultaten-pagina in het portaal.
 */
export async function pullMetricoolMetrics(
  triggeredById?: string,
  source: Source = metricool,
  days = 92,
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

        const perDay = new Map<string, DayAgg>();
        const add = (date: string, field: keyof DayAgg, value: number) => {
          const row = perDay.get(date) ?? { views: 0, reach: 0, engagements: 0, followerDelta: 0, followers: 0 };
          row[field] += value;
          perDay.set(date, row);
        };

        for (const network of METRICOOL_NETWORKS) {
          for (const { field, metric } of METRIC_MAP) {
            const points = await source.accountTimeline(blogId, userId, network, metric, fromISO, toISO);
            for (const p of points) add(p.date, field as keyof DayAgg, p.value);
          }
        }

        if (perDay.size === 0) {
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

        const rows = [...perDay.entries()].map(([date, a]) => ({
          clientId: link.clientId,
          platform: null,
          measuredOn: date,
          views: Math.max(0, Math.round(a.views)),
          reach: Math.max(0, Math.round(a.reach)),
          engagements: Math.max(0, Math.round(a.engagements)),
          followers: Math.max(0, Math.round(a.followers)),
          followerDelta: Math.round(a.followerDelta),
          source: "metricool",
        }));

        // In blokken invoegen (PGlite/Postgres-parametergrens).
        for (let i = 0; i < rows.length; i += 200) {
          await db.insert(dailyMetrics).values(rows.slice(i, i + 200));
        }

        ctx.counters.processed++;
        ctx.counters.created += rows.length;
        ctx.log(`Merk ${link.blogId}: ${rows.length} dagen cijfers.`);
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
