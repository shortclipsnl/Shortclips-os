import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, productionDays, tasks } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { coveringForUser } from "@/server/leave-cover";

export type MyShoot = { id: string; clientName: string; clientColor: string | null; scheduledOn: string; startTime: string | null; locationName: string | null };
export type MyTask = { id: string; title: string; dueOn: string | null; priority: string; clientName: string | null; overdue: boolean };
export type MyVideo = { id: string; title: string; clientName: string; status: string; dueOn: string | null };

/**
 * "Mijn dag" — wat moet DEZE persoon zelf doen: eigen opnames, eigen taken en
 * eigen editwerk. Rol-agnostisch, zodat videograaf, coördinator en editor
 * allemaal hun eigen werk vooraan zien.
 */
export async function getMyDay(viewer: Viewer): Promise<{ shoots: MyShoot[]; tasks: MyTask[]; videos: MyVideo[]; hasAny: boolean }> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const in14 = new Date(Date.now() + 14 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

  // Vervanging bij afwezigheid: neem ook de taken over van collega's die nu met
  // verlof zijn en door deze persoon worden vervangen (Milou ↔ Jiska).
  const covering = await coveringForUser(viewer.id);
  const taskAssignees = [viewer.id, ...covering.map((c) => c.absentId)];

  const [shootRows, taskRows, videoRows] = await Promise.all([
    db
      .select({
        id: productionDays.id,
        clientName: clients.name,
        clientColor: clients.color,
        scheduledOn: productionDays.scheduledOn,
        startTime: productionDays.startTime,
        locationName: productionDays.locationName,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(
        and(
          eq(productionDays.videographerId, viewer.id),
          isNull(productionDays.deletedAt),
          sql`${productionDays.status} <> 'cancelled'`,
          gte(productionDays.scheduledOn, today),
          lte(productionDays.scheduledOn, in14),
        ),
      )
      .orderBy(asc(productionDays.scheduledOn))
      .limit(8),

    db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueOn: tasks.dueOn,
        priority: tasks.priority,
        clientName: clients.name,
      })
      .from(tasks)
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .where(
        and(
          inArray(tasks.assigneeId, taskAssignees),
          isNull(tasks.deletedAt),
          isNull(tasks.archivedAt),
          inArray(tasks.status, ["todo", "in_progress", "blocked"]),
          // Automatisch gegenereerde AI-verbeterpunten horen niet in de to-do.
          sql`not (${tasks.source} = 'automation' and ${tasks.entityType} = 'ai_insight')`,
        ),
      )
      .orderBy(sql`${tasks.dueOn} asc nulls last`)
      .limit(8),

    db
      .select({
        id: deliverables.id,
        title: deliverables.title,
        clientName: clients.name,
        status: deliverables.status,
        dueOn: deliverables.dueOn,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(
        and(
          eq(deliverables.editorId, viewer.id),
          isNull(deliverables.deletedAt),
          inArray(deliverables.status, ["editing", "editor_revision", "awaiting_editor"]),
        ),
      )
      .orderBy(sql`${deliverables.dueOn} asc nulls last`)
      .limit(8),
  ]);

  const tasksOut: MyTask[] = taskRows.map((t) => ({
    id: t.id,
    title: t.title,
    dueOn: t.dueOn,
    priority: t.priority,
    clientName: t.clientName,
    overdue: Boolean(t.dueOn && t.dueOn < today),
  }));

  const shoots = shootRows.map((s) => ({ ...s }));
  const videos = videoRows.map((v) => ({ ...v }));

  return { shoots, tasks: tasksOut, videos, hasAny: shoots.length > 0 || tasksOut.length > 0 || videos.length > 0 };
}
