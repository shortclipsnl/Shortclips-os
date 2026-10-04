import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  aiInsights,
  clients,
} from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";
import { env } from "@/lib/env";
import { currentPeriod } from "@/lib/format";
import { VIDEO_STATUS, type VideoStage } from "@/lib/statuses";

/**
 * De AI-laag van ShortClips OS.
 *
 * Belangrijk uitgangspunt: elk inzicht is terug te voeren op data. De
 * rekenkundige analyses hieronder draaien volledig op de eigen database en
 * hebben geen taalmodel nodig. Een taalmodel wordt alleen gebruikt om die
 * uitkomsten in begrijpelijke taal samen te vatten — nooit om cijfers of
 * conclusies te verzinnen. Zonder ANTHROPIC_API_KEY werkt alles behalve die
 * samenvattende tekst gewoon door.
 */

export type Evidence = { type: string; label: string; value: unknown; source?: string };

export const aiEnabled = () => Boolean(env.ANTHROPIC_API_KEY);

/** Welke hooks presteren het best voor deze klant? */
export async function analyseHookPerformance(clientId: string) {
  const rows = await db.execute(sql`
    with per_video as (
      select
        s.hook,
        d.id,
        coalesce(max(sm.views), 0) as views
      from deliverables d
      join scripts s on s.id = d.script_id
      left join publications p on p.deliverable_id = d.id
      left join social_metrics sm on sm.publication_id = p.id
      where d.client_id = ${clientId}
        and d.deleted_at is null
        and d.status = 'published'
        and s.hook is not null
      group by s.hook, d.id
    )
    select
      case when hook ilike '%?%' then 'vraag' else 'stelling' end as hook_type,
      count(*)::int as aantal,
      round(avg(views))::int as gemiddelde_views
    from per_video
    group by 1
    order by gemiddelde_views desc
  `);

  const data = ((rows as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
    (rows as unknown as Array<Record<string, unknown>>)) as Array<{
    hook_type: string;
    aantal: number;
    gemiddelde_views: number;
  }>;

  const total = data.reduce((s, r) => s + Number(r.aantal), 0);
  // Onder de tien video's zijn verschillen niet betekenisvol.
  if (data.length < 2 || total < 10) return null;

  const [best, rest] = data;
  const lift =
    Number(rest!.gemiddelde_views) > 0
      ? ((Number(best!.gemiddelde_views) - Number(rest!.gemiddelde_views)) /
          Number(rest!.gemiddelde_views)) *
        100
      : 0;

  return {
    kind: "hook_performance" as const,
    title: `${best!.hook_type === "vraag" ? "Vraag-hooks" : "Stelling-hooks"} doen het beter`,
    body: `Video's met een ${best!.hook_type}-hook halen gemiddeld ${Math.round(lift)}% meer weergaven dan de andere variant.`,
    evidence: data.map<Evidence>((r) => ({
      type: "metric",
      label: `Gemiddelde weergaven (${r.hook_type}, ${r.aantal} video's)`,
      value: Number(r.gemiddelde_views),
      source: "social_metrics",
    })),
    sampleSize: total,
  };
}

/** Welke stap in de pipeline kost de meeste tijd? */
export async function analyseBottlenecks(clientId?: string) {
  const rows = await db.execute(sql`
    select
      status,
      count(*)::int as aantal,
      round(avg(extract(epoch from (now() - status_changed_at)) / 86400)::numeric, 1) as gem_dagen
    from deliverables
    where deleted_at is null
      and status not in ('published', 'analysis_available')
      ${clientId ? sql`and client_id = ${clientId}` : sql``}
    group by status
    having count(*) > 0
    order by gem_dagen desc
  `);

  const data = ((rows as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
    (rows as unknown as Array<Record<string, unknown>>)) as Array<{
    status: string;
    aantal: number;
    gem_dagen: string;
  }>;

  if (data.length === 0) return null;
  const worst = data[0]!;
  const total = data.reduce((s, r) => s + Number(r.aantal), 0);
  if (total < 5) return null;

  // Statussleutels uit de database omzetten naar de labels die het team kent.
  const label = (key: string) => VIDEO_STATUS[key as VideoStage]?.label ?? key;

  return {
    kind: "bottleneck" as const,
    title: `Meeste wachttijd zit bij ${label(worst.status)}`,
    body: `Video's staan daar gemiddeld ${worst.gem_dagen} dagen. Dat is de stap waar de meeste doorlooptijd te winnen is.`,
    evidence: data.slice(0, 5).map<Evidence>((r) => ({
      type: "metric",
      label: `${label(r.status)} (${r.aantal} video's)`,
      value: `${r.gem_dagen} dagen`,
      source: "deliverables.status_changed_at",
    })),
    sampleSize: total,
  };
}

/** Welke scripts leiden tot veel revisierondes? */
export async function analyseRevisionPatterns(clientId: string) {
  const rows = await db.execute(sql`
    select
      coalesce(s.pillar, 'zonder pijler') as pijler,
      count(*)::int as aantal,
      round(avg(d.client_revision_rounds)::numeric, 2) as gem_klantrevisies,
      round(avg(d.internal_revision_rounds)::numeric, 2) as gem_interne_revisies
    from deliverables d
    left join scripts s on s.id = d.script_id
    where d.client_id = ${clientId} and d.deleted_at is null
    group by 1
    having count(*) >= 3
    order by gem_klantrevisies desc
  `);

  const data = ((rows as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
    (rows as unknown as Array<Record<string, unknown>>)) as Array<{
    pijler: string;
    aantal: number;
    gem_klantrevisies: string;
    gem_interne_revisies: string;
  }>;

  if (data.length < 2) return null;
  const worst = data[0]!;
  if (Number(worst.gem_klantrevisies) < 1) return null;

  return {
    kind: "revision_pattern" as const,
    title: `"${worst.pijler}" kost de meeste revisierondes`,
    body: `Video's binnen deze pijler krijgen gemiddeld ${worst.gem_klantrevisies} klantrevisies. Scherper afstemmen vooraf scheelt hier het meest.`,
    evidence: data.slice(0, 5).map<Evidence>((r) => ({
      type: "metric",
      label: `${r.pijler} (${r.aantal} video's)`,
      value: `${r.gem_klantrevisies} klantrevisies, ${r.gem_interne_revisies} intern`,
      source: "deliverables",
    })),
    sampleSize: data.reduce((s, r) => s + Number(r.aantal), 0),
  };
}

/** Alle analyses draaien en wegschrijven. Bestaande inzichten worden vervangen. */
export async function generateInsights(clientId: string): Promise<number> {
  const results = await Promise.all([
    analyseHookPerformance(clientId),
    analyseBottlenecks(clientId),
    analyseRevisionPatterns(clientId),
  ]);

  const valid = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (valid.length === 0) return 0;

  const period = currentPeriod();

  // Oude inzichten van deze periode opruimen, zodat er geen dubbele ontstaan.
  for (const insight of valid) {
    await db
      .update(aiInsights)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(aiInsights.clientId, clientId),
          eq(aiInsights.kind, insight.kind),
          eq(aiInsights.period, period),
          isNull(aiInsights.deletedAt),
        ),
      );
  }

  await db.insert(aiInsights).values(
    valid.map((insight) => ({
      clientId,
      kind: insight.kind,
      title: insight.title,
      body: insight.body,
      evidence: insight.evidence,
      sampleSize: insight.sampleSize,
      method: "deterministic" as const,
      period,
    })),
  );

  return valid.length;
}

export async function listInsights(viewer: Viewer) {
  return db
    .select({
      id: aiInsights.id,
      kind: aiInsights.kind,
      title: aiInsights.title,
      body: aiInsights.body,
      evidence: aiInsights.evidence,
      sampleSize: aiInsights.sampleSize,
      method: aiInsights.method,
      period: aiInsights.period,
      generatedAt: aiInsights.generatedAt,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
    })
    .from(aiInsights)
    .leftJoin(clients, eq(clients.id, aiInsights.clientId))
    .where(
      and(
        isNull(aiInsights.deletedAt),
        isNull(aiInsights.dismissedAt),
        scopeToClients(viewer, aiInsights.clientId),
      ),
    )
    .orderBy(desc(aiInsights.generatedAt))
    .limit(60);
}
