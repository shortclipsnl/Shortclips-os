import "server-only";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks } from "@/db/schema";
import { runJob } from "./runner";

/**
 * Houdt het takenoverzicht schoon: afgeronde taken die langer dan een week klaar
 * zijn, gaan automatisch naar het archief. Ze worden niet verwijderd — met
 * `archived_at` blijven ze terugvindbaar in de archiefweergave.
 */
export async function runTaskArchive() {
  return runJob("monday", "tasks.archive_done", {}, async (ctx) => {
    const cutoff = new Date(Date.now() - 7 * 86_400_000);
    const res = await db
      .update(tasks)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(tasks.status, "done"),
          isNull(tasks.archivedAt),
          isNull(tasks.deletedAt),
          // completedAt kan ontbreken bij oude taken → val terug op updatedAt.
          lt(sql`coalesce(${tasks.completedAt}, ${tasks.updatedAt})`, cutoff),
        ),
      )
      .returning({ id: tasks.id });
    ctx.counters.updated += res.length;
    ctx.log(`${res.length} afgeronde taken gearchiveerd (langer dan 7 dagen klaar).`);
  });
}
