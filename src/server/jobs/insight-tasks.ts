import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { aiConfigured } from "@/server/ai/client";
import { generateClientInsights, getLatestInsights } from "@/server/insights";
import { runJob } from "./runner";

/** Huidige maand als YYYY-MM (Amsterdam). */
function currentPeriod(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
}

/**
 * Maandelijkse AI-resultatenanalyse: genereert per actieve klant mét cijfers één
 * keer per maand de resultatenanalyse (als er een AI-sleutel is). De analyse
 * (inclusief verbeterpunten) blijft zichtbaar op de analyticspagina van de klant
 * en in het maandrapport.
 *
 * Bewust GEEN taken meer: de verbeterpunten werden eerder automatisch als taken
 * ("Verbeterpunt {klant}: …") op het dashboard gezet. Dat is verwijderd — op
 * Taken horen alleen de daadwerkelijke werkzaamheden en actiepunten die het team
 * zelf toevoegt, niet automatisch gegenereerde verbeterpunten.
 *
 * Idempotent: de analyse wordt per klant maar één keer per maand gegenereerd.
 * Draait nachtelijk; de eerste nacht van de maand doet het werk.
 */
export async function runMonthlyInsightTasks() {
  return runJob("monday", "insights.monthly_tasks", {}, async (ctx) => {
    if (!aiConfigured()) {
      ctx.log("Geen AI-sleutel — maandelijkse resultatenanalyse overgeslagen.");
      return;
    }
    const period = currentPeriod();

    // Actieve klanten die deze/afgelopen periode cijfers hebben (anders geen
    // zinvolle analyse).
    const rows = await db.execute(sql`
      select c.id, c.slug, c.name
      from clients c
      where c.deleted_at is null and c.status = 'active'
        and exists (
          select 1 from daily_metrics dm
          where dm.client_id = c.id and dm.measured_on >= current_date - interval '45 days'
        )
      order by c.name
    `);
    const clientRows = ((rows as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[])) as Array<{ id: string; slug: string; name: string }>;

    for (const c of clientRows) {
      ctx.counters.processed++;
      // Analyse: één keer per maand genereren (hergebruik als die er al is). Er
      // worden bewust geen taken meer uit afgeleid.
      const latest = await getLatestInsights(c.id);
      const freshThisMonth = latest && latest.createdAt.toISOString().slice(0, 7) === period;
      if (!freshThisMonth) {
        const res = await generateClientInsights(c.slug, 90, true).catch(() => null);
        if (res && res.ok) ctx.counters.updated++;
      }
    }
    ctx.log(`${ctx.counters.processed} klanten verwerkt, ${ctx.counters.updated} maandanalyses vernieuwd.`);
  });
}
