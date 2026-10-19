import "server-only";
import { and, isNull, lt, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { contentCalendar } from "@/db/schema";
import { runJob } from "./runner";

/**
 * Zet publicaties waarvan de geplande datum voorbij is automatisch op
 * "Gepubliceerd" — behalve wat al gepubliceerd is of als mislukt is gemarkeerd.
 * Een post waarvan de datum voorbij is, is de deur uit; zo kloppen de
 * contentplanning, de resultaten en de kwaliteitspunten zonder dat iemand
 * elke publicatie handmatig hoeft af te vinken.
 */
export async function runAutoPublishDueContent() {
  return runJob("metricool", "content.auto_publish_due", {}, async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await db
      .update(contentCalendar)
      .set({ status: "published", updatedAt: new Date() })
      .where(
        and(
          isNull(contentCalendar.deletedAt),
          lt(contentCalendar.scheduledOn, today),
          notInArray(contentCalendar.status, ["published", "failed"]),
        ),
      )
      .returning({ id: contentCalendar.id });
    ctx.counters.updated += res.length;
    ctx.log(`${res.length} verstreken publicaties automatisch op Gepubliceerd gezet.`);
  });
}
