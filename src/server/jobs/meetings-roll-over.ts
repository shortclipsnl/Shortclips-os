import "server-only";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { teamMeetings } from "@/db/schema";
import { runJob } from "./runner";
import { buildMeetingSummary, ensureWeeklyMeeting } from "@/server/meetings";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Dagelijks: meetings die geweest zijn (datum vóór vandaag) archiveren, zodat ze
 * naar het blok "Geweest" verhuizen, en de eerstvolgende wekelijkse teammeeting
 * klaarzetten met een lege bespreekpuntenlijst.
 */
export async function runMeetingsRollOver() {
  return runJob("monday", "meetings.roll_over", {}, async (ctx) => {
    const today = startOfToday();
    // Eerst de te archiveren meetings ophalen, zodat we per stuk een samenvatting
    // van de besproken punten kunnen maken vóórdat we 'm wegzetten in "Geweest".
    const toArchive = await db
      .select({ id: teamMeetings.id })
      .from(teamMeetings)
      .where(and(lt(teamMeetings.scheduledAt, today), isNull(teamMeetings.archivedAt)));

    for (const m of toArchive) {
      const summary = await buildMeetingSummary(m.id);
      await db
        .update(teamMeetings)
        .set({ archivedAt: new Date(), summary, updatedAt: new Date() })
        .where(eq(teamMeetings.id, m.id));
      ctx.counters.updated++;
    }

    // Nieuwe (lege) wekelijkse meeting klaarzetten.
    await ensureWeeklyMeeting();
    ctx.log(`${toArchive.length} meeting(s) gearchiveerd met samenvatting; volgende wekelijkse meeting staat klaar`);
  });
}
