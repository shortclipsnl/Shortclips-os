import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { assertClientAccess, type Viewer } from "@/server/auth/context";

/**
 * "Winnende patronen" — leert van wat ECHT presteerde bij deze klant. Koppelt de
 * echte cijfers aan het script erachter:
 *   social_metrics → publications → deliverables → scripts
 * en levert de best presterende hooks als brandstof voor de scriptgenerator.
 * Trekt bewust geen hard causaal verband; het is een signaal, geen garantie.
 */

export type WinningPattern = {
  title: string | null;
  hook: string | null;
  platform: string;
  views: number;
  completionRate: number | null;
};

export type WinningPatterns = {
  count: number;
  avgViews: number | null;
  top: WinningPattern[];
};

export async function getClientWinningPatterns(viewer: Viewer, clientId: string): Promise<WinningPatterns> {
  assertClientAccess(viewer, clientId);

  // Per publicatie de meest recente meting (cumulatief), gekoppeld aan het script.
  const res = await db.execute(sql`
    select sc.title as title, sc.hook as hook, s.platform as platform,
           s.views as views, s.completion_rate as completion_rate
    from (
      select distinct on (publication_id) publication_id, views, completion_rate, platform
      from social_metrics
      where client_id = ${clientId}
      order by publication_id, measured_on desc
    ) s
    join publications p on p.id = s.publication_id and p.deleted_at is null
    join deliverables d on d.id = p.deliverable_id and d.deleted_at is null
    join scripts sc on sc.id = d.script_id and sc.deleted_at is null
    where sc.hook is not null and length(trim(sc.hook)) > 0
    order by s.views desc
    limit 20
  `);

  const rows = (((res as unknown as { rows?: unknown[] }).rows ?? res) as Array<{
    title: string | null; hook: string | null; platform: string; views: number | string | null; completion_rate: string | number | null;
  }>);
  if (!rows.length) return { count: 0, avgViews: null, top: [] };

  const mapped: WinningPattern[] = rows.map((r) => ({
    title: r.title,
    hook: r.hook,
    platform: r.platform,
    views: Number(r.views ?? 0),
    completionRate: r.completion_rate != null ? Number(r.completion_rate) : null,
  }));
  const avgViews = Math.round(mapped.reduce((a, b) => a + b.views, 0) / mapped.length);
  return { count: mapped.length, avgViews, top: mapped.slice(0, 5) };
}
