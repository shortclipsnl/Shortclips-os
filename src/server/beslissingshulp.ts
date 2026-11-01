import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { activityEvents } from "@/db/schema";

export type GemisteZoekopdracht = {
  zoekopdracht: string;
  aantal: number;
  laatst: string;
  door: string[];
};

/** Zoekopdrachten zonder resultaat van de laatste 30 dagen, meest gezocht eerst. */
export async function gemisteZoekopdrachten(dagen = 30): Promise<GemisteZoekopdracht[]> {
  const vanaf = new Date(Date.now() - dagen * 24 * 60 * 60 * 1000);
  const rijen = await db
    .select({
      zoekopdracht: sql<string>`lower(${activityEvents.title})`,
      aantal: sql<number>`count(*)::int`,
      laatst: sql<string>`max(${activityEvents.occurredAt})`,
      door: sql<string[]>`array_remove(array_agg(distinct ${activityEvents.actorName}), null)`,
    })
    .from(activityEvents)
    .where(and(eq(activityEvents.type, "beslissingshulp.zoek_geen_resultaat"), gte(activityEvents.occurredAt, vanaf)))
    .groupBy(sql`lower(${activityEvents.title})`)
    .orderBy(desc(sql`count(*)`), desc(sql`max(${activityEvents.occurredAt})`))
    .limit(50);
  return rijen.map((r) => ({
    zoekopdracht: r.zoekopdracht,
    aantal: Number(r.aantal),
    laatst: new Date(r.laatst).toISOString(),
    door: Array.isArray(r.door) ? r.door : [],
  }));
}
