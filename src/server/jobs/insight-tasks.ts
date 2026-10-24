import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, tasks, users } from "@/db/schema";
import { aiConfigured } from "@/server/ai/client";
import { generateClientInsights, getLatestInsights } from "@/server/insights";
import { runJob } from "./runner";

/** Huidige maand als YYYY-MM (Amsterdam). */
function currentPeriod(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
}

/**
 * Maandelijkse AI-verbeterlus: genereert per actieve klant mét cijfers één keer
 * per maand de resultatenanalyse (als er een AI-sleutel is) en zet de
 * belangrijkste verbeterpunten automatisch om in taken voor de verantwoordelijke.
 * Zo worden inzichten elke maand vanzelf opvolgwerk op het interne dashboard.
 *
 * Idempotent: de analyse wordt per klant maar één keer per maand gegenereerd en
 * de taken zijn gededupliceerd (klant + maand + verbeterpunt). Draait nachtelijk;
 * de eerste nacht van de maand doet het werk, daarna is alles al klaar.
 */
export async function runMonthlyInsightTasks() {
  return runJob("monday", "insights.monthly_tasks", {}, async (ctx) => {
    if (!aiConfigured()) {
      ctx.log("Geen AI-sleutel — maandelijkse inzicht-taken overgeslagen.");
      return;
    }
    const period = currentPeriod();
    const monthStart = `${period}-01`;

    // Actieve klanten die deze/afgelopen periode cijfers hebben (anders geen
    // zinvolle analyse) + hun coördinator.
    const rows = await db.execute(sql`
      select c.id, c.slug, c.name, c.coordinator_id as "coordinatorId"
      from clients c
      where c.deleted_at is null and c.status = 'active'
        and exists (
          select 1 from daily_metrics dm
          where dm.client_id = c.id and dm.measured_on >= current_date - interval '45 days'
        )
      order by c.name
    `);
    const clientRows = ((rows as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[])) as Array<{ id: string; slug: string; name: string; coordinatorId: string | null }>;

    // Terugvaloptie voor de toewijzing: een actieve projectcoördinator.
    const [fallbackCoord] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.primaryRole, "project_coordinator"), eq(users.status, "active"), isNull(users.deletedAt)))
      .orderBy(asc(users.fullName))
      .limit(1);

    for (const c of clientRows) {
      ctx.counters.processed++;
      // 1) Analyse: één keer per maand genereren (hergebruik als die er al is).
      let latest = await getLatestInsights(c.id);
      const freshThisMonth = latest && latest.createdAt.toISOString().slice(0, 7) === period;
      if (!freshThisMonth) {
        const res = await generateClientInsights(c.slug, 90, true).catch(() => null);
        if (res && res.ok) latest = await getLatestInsights(c.id);
      }
      if (!latest) continue;

      // 2) Top-verbeterpunten (max 2) omzetten in taken, gededupliceerd op maand.
      const recs = (latest.insights.verbeterpunten ?? []).slice(0, 2);
      const assigneeId = c.coordinatorId ?? fallbackCoord?.id ?? null;
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i]!;
        const dedupeKey = `insight_task:${c.id}:${period}:${i}`;
        const [exists] = await db.select({ id: tasks.id }).from(tasks)
          .where(and(eq(tasks.dedupeKey, dedupeKey), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`)).limit(1);
        if (exists) continue;
        const inserted = await db.insert(tasks).values({
          clientId: c.id,
          title: `Verbeterpunt ${c.name}: ${rec.titel}`.slice(0, 240),
          description: `Waarom: ${rec.waarom}\n\nWat aanpassen: ${rec.wat}\n\nHoe meten: ${rec.hoeMeten}\n\n(Automatisch uit de maandelijkse AI-resultatenanalyse.)`,
          priority: "normal",
          status: "todo",
          assigneeId,
          dueOn: monthStart,
          entityType: "ai_insight",
          source: "automation",
          dedupeKey,
        }).onConflictDoNothing().returning({ id: tasks.id });
        if (inserted[0]) ctx.counters.updated++;
      }
    }
    ctx.log(`${ctx.counters.processed} klanten verwerkt, ${ctx.counters.updated} verbeterpunt-taken aangemaakt.`);
  });
}
