import "server-only";
import { db } from "@/db/client";
import { goalMilestones, goals } from "@/db/schema";
import { GOAL_CATALOG, Q4_END, Q4_START } from "./catalog";

/**
 * Seedt de 22 Q4-doelen. Idempotent: doet niets als er al doelen bestaan, zodat
 * handmatig ingevoerde standen en toegewezen eigenaren nooit worden overschreven.
 * Eigenaar bewust leeg (Jarno wijst zelf toe); live doelen krijgen hun stand uit
 * de live-metingen, handmatige doelen starten op "Nog niet gemeten".
 */
export async function seedGoals(): Promise<{ inserted: number }> {
  const existing = await db.select({ id: goals.id }).from(goals).limit(1);
  if (existing.length > 0) return { inserted: 0 };

  let i = 0;
  for (const g of GOAL_CATALOG) {
    const [row] = await db
      .insert(goals)
      .values({
        pillar: g.pillar,
        title: g.title,
        type: g.type,
        source: g.source,
        metricKey: g.metricKey ?? null,
        target: g.target != null ? String(g.target) : null,
        unit: g.unit ?? null,
        visibility: g.visibility ?? "team",
        startDate: Q4_START,
        endDate: Q4_END,
        status: "gepland",
        sortOrder: i,
      })
      .returning({ id: goals.id });
    if (g.milestones?.length) {
      await db.insert(goalMilestones).values(g.milestones.map((t, j) => ({ goalId: row!.id, title: t, sortOrder: j })));
    }
    i++;
  }
  return { inserted: GOAL_CATALOG.length };
}
