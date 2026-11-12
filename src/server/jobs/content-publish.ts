import "server-only";
import { and, isNull, lt, notInArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contentCalendar, publications } from "@/db/schema";
import { runJob } from "./runner";
import { notInactiveClient } from "@/server/client-activity";

/**
 * Zet publicaties waarvan de geplande datum voorbij is automatisch op
 * "Gepubliceerd" — behalve wat al gepubliceerd is of als mislukt is gemarkeerd.
 * Een post waarvan de datum voorbij is, is de deur uit; zo kloppen de
 * contentplanning, de resultaten en de kwaliteitspunten zonder dat iemand
 * elke publicatie handmatig hoeft af te vinken.
 *
 * Uitzondering: items die via Metricool lopen (publicatie op "via Metricool")
 * worden hier NOOIT op Gepubliceerd gezet. Die krijgen die status pas als de
 * post in de Metricool-statistieken is teruggevonden.
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
          // Centrale klantstatus: geen automatische statuswijzigingen bij niet actieve klanten.
          notInactiveClient(contentCalendar.clientId),
          sql`NOT EXISTS (SELECT 1 FROM ${publications} p WHERE p.calendar_item_id = ${contentCalendar.id} AND p.publish_mode = 'metricool' AND p.deleted_at IS NULL)`,
        ),
      )
      .returning({ id: contentCalendar.id });
    ctx.counters.updated += res.length;
    ctx.log(`${res.length} verstreken publicaties automatisch op Gepubliceerd gezet.`);
  });
}
