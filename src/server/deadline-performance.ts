import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requirePermission } from "@/server/auth/context";

export type PerformanceRow = {
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  role: string | null;
  totalMisses: number;
  currentlyLate: number;
  resolvedMisses: number;
  videoMisses: number;
  taskMisses: number;
  avgDaysLate: number;
  maxDaysLate: number;
};

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

/**
 * Prestatieregistratie per editor/medewerker: hoe vaak een deadline is gemist en
 * hoeveel dagen te laat (gemiddeld en maximaal), gesplitst naar video's en taken,
 * en hoeveel er nu nog open (te laat) staan. Bron: de tabel `deadline_misses`
 * die de nachtelijke job vult. Historie blijft bewaard, ook na afronding.
 */
export async function getDeadlinePerformance(): Promise<PerformanceRow[]> {
  await requirePermission("editors:read");
  const res = await db.execute(sql`
    select m.responsible_user_id as "userId",
      coalesce(u.full_name, 'Onbekend') as name,
      u.avatar_url as "avatarUrl",
      u.primary_role as role,
      count(*)::int as "totalMisses",
      count(*) filter (where m.resolved = false)::int as "currentlyLate",
      count(*) filter (where m.resolved = true)::int as "resolvedMisses",
      count(*) filter (where m.entity_type = 'deliverable')::int as "videoMisses",
      count(*) filter (where m.entity_type = 'task')::int as "taskMisses",
      coalesce(round(avg(m.days_late)::numeric, 1), 0)::float as "avgDaysLate",
      coalesce(max(m.days_late), 0)::int as "maxDaysLate"
    from deadline_misses m
    left join users u on u.id = m.responsible_user_id
    group by m.responsible_user_id, u.full_name, u.avatar_url, u.primary_role
    order by count(*) filter (where m.resolved = false) desc, count(*) desc
  `);
  return rows<PerformanceRow>(res).map((r) => ({
    ...r,
    totalMisses: Number(r.totalMisses),
    currentlyLate: Number(r.currentlyLate),
    resolvedMisses: Number(r.resolvedMisses),
    videoMisses: Number(r.videoMisses),
    taskMisses: Number(r.taskMisses),
    avgDaysLate: Number(r.avgDaysLate),
    maxDaysLate: Number(r.maxDaysLate),
  }));
}

/** Totalen voor de kop van de pagina. */
export async function getDeadlinePerformanceTotals(): Promise<{ totalMisses: number; currentlyLate: number; people: number }> {
  await requirePermission("editors:read");
  const res = await db.execute(sql`
    select count(*)::int as "totalMisses",
      count(*) filter (where resolved = false)::int as "currentlyLate",
      count(distinct responsible_user_id)::int as people
    from deadline_misses
  `);
  const r = rows<{ totalMisses: number; currentlyLate: number; people: number }>(res)[0];
  return { totalMisses: Number(r?.totalMisses ?? 0), currentlyLate: Number(r?.currentlyLate ?? 0), people: Number(r?.people ?? 0) };
}
