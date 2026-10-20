import "server-only";
import { and, between, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentCalendar, deliverables, productionDays } from "@/db/schema";

export type HandoverItem = {
  id: string;
  label: string;
  clientName: string | null;
  date: string | null;
  role: string;
};

export type LeaveHandover = {
  shoots: HandoverItem[];
  deliveries: HandoverItem[];
  posts: HandoverItem[];
  clients: HandoverItem[];
  total: number;
};

/**
 * Overdrachtslijst bij goedgekeurd verlof: wat moet er tijdens de afwezigheid van
 * deze persoon worden overgenomen? Opnames, video-opleveringen en posts die in de
 * verlofperiode vallen, plus de klanten waar de persoon vast coördinator van is.
 * Volledig afgeleid uit de bestaande koppelingen in de portal.
 */
export async function getLeaveHandover(
  userId: string,
  startOn: string,
  endOn: string,
): Promise<LeaveHandover> {
  const [shootRows, deliveryRows, postRows, clientRows] = await Promise.all([
    // Opnames in de periode waar de persoon videograaf, editor of coördinator is.
    db
      .select({
        id: productionDays.id,
        title: productionDays.title,
        scheduledOn: productionDays.scheduledOn,
        clientName: clients.name,
        videographerId: productionDays.videographerId,
        editorId: productionDays.editorId,
        coordinatorId: productionDays.coordinatorId,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(
        and(
          isNull(productionDays.deletedAt),
          ne(productionDays.status, "cancelled"),
          between(productionDays.scheduledOn, startOn, endOn),
          or(
            eq(productionDays.videographerId, userId),
            eq(productionDays.editorId, userId),
            eq(productionDays.coordinatorId, userId),
          ),
        ),
      ),

    // Video-opleveringen met deadline in de periode, toegewezen aan de persoon.
    db
      .select({
        id: deliverables.id,
        title: deliverables.title,
        dueOn: deliverables.dueOn,
        clientName: clients.name,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(
        and(
          isNull(deliverables.deletedAt),
          eq(deliverables.editorId, userId),
          between(deliverables.dueOn, startOn, endOn),
          sql`${deliverables.status} not in ('published','approved','ready_to_publish','scheduled','analysis_available')`,
        ),
      ),

    // Posts in de periode die de persoon beheert (eigenaar van de post of
    // coördinator van de klant), en nog niet gepubliceerd zijn.
    db
      .select({
        id: contentCalendar.id,
        title: contentCalendar.title,
        scheduledOn: contentCalendar.scheduledOn,
        clientName: clients.name,
      })
      .from(contentCalendar)
      .innerJoin(clients, eq(clients.id, contentCalendar.clientId))
      .where(
        and(
          isNull(contentCalendar.deletedAt),
          between(contentCalendar.scheduledOn, startOn, endOn),
          ne(contentCalendar.status, "published"),
          or(eq(contentCalendar.ownerId, userId), eq(clients.coordinatorId, userId)),
        ),
      ),

    // Klanten waar de persoon vast coördinator van is.
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(isNull(clients.deletedAt), eq(clients.status, "active"), eq(clients.coordinatorId, userId))),
  ]);

  const roleFor = (r: { videographerId: string | null; editorId: string | null; coordinatorId: string | null }) =>
    r.videographerId === userId ? "videograaf" : r.editorId === userId ? "editor" : "coördinator";

  const shoots: HandoverItem[] = shootRows.map((r) => ({
    id: r.id,
    label: r.title ?? "Opname",
    clientName: r.clientName,
    date: r.scheduledOn,
    role: roleFor(r),
  }));
  const deliveries: HandoverItem[] = deliveryRows.map((r) => ({
    id: r.id,
    label: r.title,
    clientName: r.clientName,
    date: r.dueOn,
    role: "oplevering",
  }));
  const posts: HandoverItem[] = postRows.map((r) => ({
    id: r.id,
    label: r.title,
    clientName: r.clientName,
    date: r.scheduledOn,
    role: "post",
  }));
  const clientItems: HandoverItem[] = clientRows.map((r) => ({
    id: r.id,
    label: r.name,
    clientName: r.name,
    date: null,
    role: "coördinator",
  }));

  return {
    shoots,
    deliveries,
    posts,
    clients: clientItems,
    total: shoots.length + deliveries.length + posts.length + clientItems.length,
  };
}
