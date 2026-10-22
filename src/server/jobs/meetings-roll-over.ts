import "server-only";
import { and, isNull, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { teamMeetings } from "@/db/schema";
import { runJob } from "./runner";
import { ensureWeeklyMeeting } from "@/server/meetings";

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
    const archived = await db
      .update(teamMeetings)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(lt(teamMeetings.scheduledAt, today), isNull(teamMeetings.archivedAt)))
      .returning({ id: teamMeetings.id });
    ctx.counters.updated += archived.length;

    // Nieuwe (lege) wekelijkse meeting klaarzetten.
    await ensureWeeklyMeeting();
    ctx.log(`${archived.length} meeting(s) gearchiveerd; volgende wekelijkse meeting staat klaar`);
  });
}
