import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { productionDays } from "@/db/schema";
import { runJob } from "./runner";

/**
 * Laat de projectfase van een opnamedag automatisch meelopen met de
 * opnamedatum — overgenomen uit Monday, zodat niemand de fase handmatig hoeft
 * bij te werken:
 *   nieuw → scripting (−14d) → opnamevoorbereiding (−3d) → opname (0d) → editing (+1d)
 * Alleen vooruit: een al verder gezette fase wordt nooit teruggedraaid.
 */

const ORDER = ["nieuw", "scripting", "opnamevoorbereiding", "opname", "editing"] as const;
type Phase = (typeof ORDER)[number];

function targetPhase(scheduledOn: string, today: string): Phase {
  const diffDays = Math.floor(
    (new Date(scheduledOn + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86_400_000,
  );
  if (diffDays <= -1) return "editing";
  if (diffDays === 0) return "opname";
  if (diffDays <= 3) return "opnamevoorbereiding";
  if (diffDays <= 14) return "scripting";
  return "nieuw";
}

export async function runProductionPhaseAdvance() {
  return runJob("monday", "production.advance_phases", {}, async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);

    // Alleen dagen die nog niet in editing (of verder) zitten.
    const rows = await db
      .select({ id: productionDays.id, scheduledOn: productionDays.scheduledOn, phase: productionDays.phase })
      .from(productionDays)
      .where(
        and(
          isNull(productionDays.deletedAt),
          inArray(productionDays.phase, ["nieuw", "scripting", "opnamevoorbereiding", "opname"]),
        ),
      );
    ctx.log(`${rows.length} opnamedagen om te controleren`);

    for (const row of rows) {
      if (!row.scheduledOn) continue;
      ctx.counters.processed++;
      const current = (ORDER.includes(row.phase as Phase) ? row.phase : "nieuw") as Phase;
      const target = targetPhase(row.scheduledOn, today);
      if (ORDER.indexOf(target) > ORDER.indexOf(current)) {
        await db
          .update(productionDays)
          .set({ phase: target, phaseEnteredOn: today, updatedAt: new Date() })
          .where(eq(productionDays.id, row.id));
        ctx.counters.updated++;
      }
    }
    ctx.log(`${ctx.counters.updated} opnamedagen van fase gewisseld.`);
  });
}
