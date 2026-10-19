import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, productionDays } from "@/db/schema";
import { addWorkingDays, daysBetween, subWorkingDays } from "@/lib/workdays";
import { runJob } from "./runner";

/**
 * Koppelt video's automatisch aan de juiste opnamedag. Hoge zekerheid wordt
 * meteen definitief gekoppeld (inclusief automatische deadline) — zónder dat
 * iemand iets hoeft te bevestigen. Alleen onzekere gevallen (medium) blijven
 * als suggestie staan in het controleoverzicht.
 *
 * Betrouwbaarheid:
 *  - high   : klant heeft precies één opname, óf de video-deadline wijst binnen
 *             5 dagen naar die opname (deadline − 14 werkdagen ≈ opnamedatum).
 *             → automatisch gekoppeld.
 *  - medium : dichtstbijzijnde opname binnen ~14 dagen van de geschatte opname.
 *             → suggestie voor handmatige controle.
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
      .select({ id: deliverables.id, clientId: deliverables.clientId, dueOn: deliverables.dueOn, dueOnSource: deliverables.dueOnSource })
      .from(deliverables)
      .where(
        and(
          isNull(deliverables.deletedAt),
          isNull(deliverables.productionDayId),
          eq(deliverables.linkReviewed, false),
        ),
      );

    let applied = 0;
    for (const v of vids) {
      const shoots = daysByClient.get(v.clientId);
      if (!shoots || shoots.length === 0) continue;

      let suggestedId: string | null = null;
      let suggestedOn: string | null = null;
      let confidence: "high" | "medium" | null = null;

      if (shoots.length === 1) {
        suggestedId = shoots[0]!.id;
        suggestedOn = shoots[0]!.scheduledOn;
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
          suggestedOn = best.scheduledOn;
          confidence = "high";
        } else if (bestDist <= 14) {
          suggestedId = best.id;
          suggestedOn = best.scheduledOn;
          confidence = "medium";
        }
      }

      if (!suggestedId || !confidence) continue;
      ctx.counters.processed++;

      if (confidence === "high") {
        // Hoge zekerheid → meteen definitief koppelen, geen handmatige stap.
        // Deadline automatisch = opnamedatum + 14 werkdagen, tenzij handmatig vastgezet.
        const dueOn = suggestedOn && v.dueOnSource !== "manual" ? addWorkingDays(suggestedOn, 14) : undefined;
        await db
          .update(deliverables)
          .set({
            productionDayId: suggestedId,
            suggestedProductionDayId: null,
            linkConfidence: null,
            linkReviewed: true,
            ...(dueOn ? { dueOn } : {}),
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, v.id));
        applied++;
      } else {
        // Onzeker → als suggestie laten staan voor handmatige controle.
        await db
          .update(deliverables)
          .set({ suggestedProductionDayId: suggestedId, linkConfidence: confidence, updatedAt: new Date() })
          .where(eq(deliverables.id, v.id));
      }
      ctx.counters.updated++;
    }

    // Veegronde: resterende hoge-zekerheid-suggesties (bijv. uit een eerdere
    // run) ook automatisch koppelen, mits de voorgestelde opname nog bestaat.
    // Zo hoeft niemand ooit handmatig op "Bevestigen" te klikken.
    const remaining = await db
      .select({ id: deliverables.id, suggested: deliverables.suggestedProductionDayId, dueOnSource: deliverables.dueOnSource })
      .from(deliverables)
      .where(
        and(
          isNull(deliverables.deletedAt),
          isNull(deliverables.productionDayId),
          eq(deliverables.linkReviewed, false),
          eq(deliverables.linkConfidence, "high"),
          isNotNull(deliverables.suggestedProductionDayId),
        ),
      );
    for (const r of remaining) {
      if (!r.suggested) continue;
      const [day] = await db
        .select({ on: productionDays.scheduledOn })
        .from(productionDays)
        .where(and(eq(productionDays.id, r.suggested), isNull(productionDays.deletedAt)))
        .limit(1);
      if (!day) continue; // Voorgestelde opname bestaat niet meer → laat staan voor controle.
      const dueOn = day.on && r.dueOnSource !== "manual" ? addWorkingDays(day.on, 14) : undefined;
      await db
        .update(deliverables)
        .set({
          productionDayId: r.suggested,
          suggestedProductionDayId: null,
          linkConfidence: null,
          linkReviewed: true,
          ...(dueOn ? { dueOn } : {}),
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, r.id));
      applied++;
    }

    ctx.log(`${applied} video's automatisch gekoppeld, ${ctx.counters.updated - applied} suggesties voor controle.`);
  });
}
