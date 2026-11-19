import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { hasClientAccess, type Viewer } from "@/server/auth/context";
import { getRetentionOverview, retentionContext } from "@/server/client-retention";
import { redenOf, sortRows, statusOf, viewsPctOf, type GezondheidInput, type GezondheidRow } from "@/lib/klantgezondheid";

/**
 * Klantgezondheid voor de Resultatenpagina. Hergebruikt het klantbehoud-systeem
 * (resultaten met vaste vensters, open klantfeedback, contractmomenten,
 * verantwoordelijke met vervanging) en voegt de levering toe uit de
 * deadline_misses-tabel. Zo zegt de lijst hetzelfde als Aandachtspunten en de
 * klantpagina, en is er geen tweede set regels.
 */

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const WEEKS = 8;

export async function loadKlantgezondheid(viewer: Viewer): Promise<GezondheidRow[]> {
  const ctx = await retentionContext();

  const [meta, lateRes, weekRes, overview] = await Promise.all([
    // Zelfde selectie als de rest van de Resultatenpagina: actieve, échte klanten.
    db.execute(sql`
      select c.id, c.logo_url as "logoUrl", c.color
      from clients c where c.deleted_at is null and c.status = 'active' and c.show_in_results = true
    `),
    // Open opleveringen die hun editor-deadline missen (de nachtelijke job houdt dit bij).
    db.execute(sql`
      select client_id as "clientId", count(*)::int as n, max(days_late)::int as d
      from deadline_misses
      where entity_type = 'deliverable' and resolved = false and client_id is not null
      group by client_id
    `),
    // Weergaven per week, 0 = de afgelopen 7 dagen. Vandaag zelf telt nog niet mee (onvolledig).
    db.execute(sql`
      select dm.client_id as "clientId", ((current_date - dm.measured_on) / 7)::int as wk, coalesce(sum(dm.views), 0)::bigint as views
      from daily_metrics dm
      where dm.measured_on >= current_date - ${WEEKS * 7} and dm.measured_on < current_date
      group by dm.client_id, wk
    `),
    getRetentionOverview(ctx),
  ]);

  const info = new Map(rows<{ id: string; logoUrl: string | null; color: string | null }>(meta).map((r) => [String(r.id), r]));
  const late = new Map(rows<{ clientId: string; n: number; d: number }>(lateRes).map((r) => [String(r.clientId), { n: Number(r.n), d: Number(r.d) }]));
  const series = new Map<string, number[]>();
  for (const r of rows<{ clientId: string; wk: number; views: string | number }>(weekRes)) {
    const id = String(r.clientId);
    const arr = series.get(id) ?? Array.from({ length: WEEKS }, () => 0);
    const wk = Number(r.wk);
    if (wk >= 0 && wk < WEEKS) arr[WEEKS - 1 - wk] = Number(r.views); // oudste eerst
    series.set(id, arr);
  }

  const visible = overview.filter((c) => info.has(c.clientId) && hasClientAccess(viewer, c.clientId));

  // Verantwoordelijke: de klantverantwoordelijke, met vervanging bij afwezigheid.
  const ownerIdOf = (c: (typeof visible)[number]) => (c.coordinatorKey ? ctx.ownerFor(c.coordinatorKey) : c.coordinatorId) ?? ctx.ownerFor("milou");
  const ownerIds = [...new Set(visible.map(ownerIdOf).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ownerIds.length) {
    const res = await db.execute(sql`select id, full_name as name from users where id in (${sql.join(ownerIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
    for (const r of rows<{ id: string; name: string }>(res)) names.set(String(r.id), String(r.name).split(" ")[0]!);
  }

  const out: GezondheidRow[] = visible.map((c) => {
    const l = late.get(c.clientId);
    const input: GezondheidInput = {
      resultsState: c.results.state,
      viewsPct: viewsPctOf(c.results.platforms),
      lateCount: l?.n ?? 0,
      lateDays: l?.d ?? 0,
      renewalSoon: c.contract.stage !== null,
      feedbackSerious: c.openFeedback.filter((f) => f.kind === "ernstig").length,
      feedbackUnhappy: c.openFeedback.filter((f) => f.kind === "aandacht").length,
    };
    const status = statusOf(input);
    const ownerId = ownerIdOf(c);
    const i = info.get(c.clientId)!;
    return {
      clientId: c.clientId, name: c.name, slug: c.slug, logoUrl: i.logoUrl, color: i.color,
      status, reden: redenOf(input, status), viewsPct: input.viewsPct,
      series: series.get(c.clientId) ?? Array.from({ length: WEEKS }, () => 0),
      lateCount: input.lateCount, lateDays: input.lateDays, renewalSoon: input.renewalSoon,
      feedbackSerious: input.feedbackSerious, feedbackUnhappy: input.feedbackUnhappy,
      resultsState: input.resultsState, ownerId, ownerName: ownerId ? names.get(ownerId) ?? null : null,
    };
  });
  return sortRows(out);
}
