import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { mondayMappings, tasks, users } from "@/db/schema";
import { monday } from "@/server/integrations/monday";
import { runJob } from "./runner";

/*
 * TO DO-borden → Taken.
 *
 * Monday heeft per vast teamlid een eenvoudig TO DO-bord (alleen een
 * taaknaam) plus een algemeen team-bord. We nemen die taken over naar de
 * eigen takenlijst, met de juiste persoon als toegewezene (afgeleid uit het
 * bord). Idempotent via monday_mappings (entityType "task") — hetzelfde type
 * dat de Monday-webhook al verwachtte, waardoor dat pad nu echt gevuld is.
 */
const TODO_BOARDS: { boardId: string; assignee: string | null }[] = [
  { boardId: "5104368570", assignee: "jarno" },
  { boardId: "5104368541", assignee: "rutger" },
  { boardId: "5104368527", assignee: "jiska" },
  { boardId: "5104368229", assignee: "milou" },
  { boardId: "5099976855", assignee: null }, // TO DO - Team algemeen
];

/** Teamlid zoeken op het vaste e-mailpatroon voornaam@shortclips.nl of op naam. */
async function matchUserId(firstName: string | null): Promise<string | null> {
  const clean = (firstName ?? "").trim().toLowerCase();
  if (!clean) return null;
  const email = `${clean}@shortclips.nl`;
  const [hit] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        or(eq(users.email, email), sql`lower(${users.fullName}) like ${clean + "%"}`),
      ),
    )
    .limit(1);
  return hit?.id ?? null;
}

export async function runMondayTasksImport() {
  return runJob("monday", "monday.import_tasks", {}, async (ctx) => {
    // Toegewezenen één keer opzoeken.
    const assigneeCache = new Map<string, string | null>();
    async function assigneeId(name: string | null): Promise<string | null> {
      if (!name) return null;
      if (!assigneeCache.has(name)) assigneeCache.set(name, await matchUserId(name));
      return assigneeCache.get(name)!;
    }

    for (const board of TODO_BOARDS) {
      const items = await monday.listItems(board.boardId, 500);
      ctx.log(`Bord ${board.boardId} (${board.assignee ?? "team"}): ${items.length} taken`);
      const userId = await assigneeId(board.assignee);

      for (const item of items) {
        const title = (item.name ?? "").trim();
        if (!title) {
          ctx.counters.failed++;
          continue;
        }
        ctx.counters.processed++;

        const base = {
          title: title.slice(0, 240),
          assigneeId: userId,
          updatedAt: new Date(),
        };

        const [map] = await db
          .select({ id: mondayMappings.id, entityId: mondayMappings.entityId })
          .from(mondayMappings)
          .where(and(eq(mondayMappings.entityType, "task"), eq(mondayMappings.itemId, item.id)))
          .limit(1);

        if (map?.entityId) {
          // Alleen titel/toewijzing verversen; status is app-eigen (kan in de
          // app afgevinkt zijn) en overschrijven we niet.
          await db.update(tasks).set(base).where(eq(tasks.id, map.entityId));
          await db.update(mondayMappings).set({ lastSyncedAt: new Date() }).where(eq(mondayMappings.id, map.id));
          ctx.counters.updated++;
        } else {
          const [created] = await db
            .insert(tasks)
            .values({ ...base, status: "todo", description: "Geïmporteerd uit Monday (TO DO-bord)." })
            .returning({ id: tasks.id });
          await db.insert(mondayMappings).values({
            entityType: "task",
            entityId: created!.id,
            boardId: board.boardId,
            itemId: item.id,
            lastSyncedAt: new Date(),
          });
          ctx.counters.created++;
        }
      }
    }
    ctx.log(`Klaar: ${ctx.counters.created} nieuw, ${ctx.counters.updated} bijgewerkt, ${ctx.counters.failed} zonder titel.`);
  });
}
