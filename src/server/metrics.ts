import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { capacityPeople } from "@/db/schema";

/**
 * Canonieke editorcapaciteit: de gezonde grens in shorts per 4 weken uit
 * capacity_people (overgenomen uit Monday). Eén bron voor dashboard, Editors en
 * Teamcapaciteit, zodat dezelfde editor overal dezelfde bezetting en hetzelfde
 * oordeel krijgt (#5).
 */
export async function editorCapacityMap(): Promise<Map<string, number>> {
  const rows = await db
    .select({ userId: capacityPeople.userId, green: capacityPeople.limitGreen })
    .from(capacityPeople)
    .where(and(eq(capacityPeople.unit, "shorts_4w"), sql`${capacityPeople.userId} is not null`));
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.userId && r.green != null) map.set(r.userId, Number(r.green));
  }
  return map;
}
