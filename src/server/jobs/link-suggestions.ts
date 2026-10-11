import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, productionDays } from "@/db/schema";
import { daysBetween, subWorkingDays } from "@/lib/workdays";
import { runJob } from "./runner";

/**
 * Stelt heuristisch voor welke opnamedag bij welke video hoort — zodat het team
 * dit in het controleoverzicht kan bevestigen. Er wordt niets definitief
 * gekoppeld: we vullen alleen `suggestedProductionDayId` + `linkConfidence`.
 *
 * Betrouwbaarheid:
 *  - high   : klant heeft precies één opname, óf de video-deadline wijst binnen
 *             5 dagen naar die opname (deadline − 14 werkdagen ≈ opnamedatum).
 *  - medium : dichtstbijzijnde opname binnen ~14 dagen van de geschatte opname.
 *  - (geen) : te onzeker → blijft onbeslist voor handmatige koppeling.
 */
export async function runLinkSuggestions() {
  return runJob("monday", "editing.suggest_opname_links", {}, async (ctx) => {
    // Opnamedagen per klant verzamelen.
    const days = await db
      .select({ id: productionDays.id, clientId: productionDays.clientId, scheduledOn: productionDays.scheduledOn })
      .from(productionDays)
      .where(isNull(productionDays.deletedAt));
    const daysByClient = new Map<string, { id: string; scheduledOn: string }[]>();
    for (const d of days) {
      if (!d.scheduledOn) continue;
      const list = daysByClient.get(d.clientId) ?? [];
      list.push({ id: d.id, scheduledOn: d.scheduledOn });
      daysByClient.set(d.clientId, list);
    }

    // Nog niet gekoppelde en nog niet beoordeelde video's.
    const vids = await db
      .select({ id: deliverables.id, clientId: deliverables.clientId, dueOn: deliverables.dueOn })
      .from(deliverables)
      .where(
        and(
          isNull(deliverables.deletedAt),
          isNull(deliverables.productionDayId),
          eq(deliverables.linkReviewed, false),
        ),
      );

    for (const v of vids) {
      const shoots = daysByClient.get(v.clientId);
      if (!shoots || shoots.length === 0) continue;

      let suggestedId: string | null = null;
      let confidence: "high" | "medium" | null = null;

      if (shoots.length === 1) {
        suggestedId = shoots[0]!.id;
        confidence = "high"; // enige opname van deze klant
      } else if (v.dueOn) {
        const estShoot = subWorkingDays(v.dueOn, 14);
        let best = shoots[0]!;
        let bestDist = daysBetween(best.scheduledOn, estShoot);
        for (const s of shoots.slice(1)) {
          const dist = daysBetween(s.scheduledOn, estShoot);
          if (dist < bestDist) {
            best = s;
            bestDist = dist;
          }
        }
        if (bestDist <= 5) {
          suggestedId = best.id;
          confidence = "high";
        } else if (bestDist <= 14) {
          suggestedId = best.id;
          confidence = "medium";
        }
      }

      if (!suggestedId || !confidence) continue;
      ctx.counters.processed++;
      await db
        .update(deliverables)
        .set({ suggestedProductionDayId: suggestedId, linkConfidence: confidence, updatedAt: new Date() })
        .where(eq(deliverables.id, v.id));
      ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} koppelsuggesties gezet.`);
  });
}
