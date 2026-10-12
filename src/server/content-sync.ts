import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { contentCalendar, deliverables } from "@/db/schema";

/**
 * Koppelt het Editing Dashboard aan de Contentplanning: een video bestaat als
 * één record (deliverable) en verschijnt als één gekoppelde publicatie in de
 * contentplanning zodra die klaar is om in te plannen. De publicatiedatum wordt
 * gelijkgehouden (contentplanning is de bron), en "gepubliceerd" wordt
 * doorgezet. Zo hoeft niemand dezelfde video dubbel in te voeren.
 */

// Stappen waarin een video in de contentplanning thuishoort.
const PUBLISHABLE = ["approved", "ready_to_publish", "scheduled", "published"] as const;
// Alleen hiervoor maken we een nieuw planningsrecord aan (geen retroactieve
// vloed voor al lang gepubliceerde video's).
const CREATE_STATES = new Set(["approved", "ready_to_publish", "scheduled"]);

function mapStatus(videoStatus: string): "to_prepare" | "ready" | "scheduled" | "published" {
  if (videoStatus === "published") return "published";
  if (videoStatus === "scheduled") return "scheduled";
  if (videoStatus === "approved" || videoStatus === "ready_to_publish") return "ready";
  return "to_prepare";
}

/** Eén video synchroniseren naar de contentplanning. Idempotent. */
export async function syncContentForDeliverable(deliverableId: string): Promise<{ action: string }> {
  const [d] = await db
    .select({
      id: deliverables.id,
      clientId: deliverables.clientId,
      title: deliverables.title,
      status: deliverables.status,
      plannedPublishOn: deliverables.plannedPublishOn,
      dueOn: deliverables.dueOn,
    })
    .from(deliverables)
    .where(and(eq(deliverables.id, deliverableId), isNull(deliverables.deletedAt)))
    .limit(1);
  if (!d) return { action: "skip:not_found" };

  const [existing] = await db
    .select({ id: contentCalendar.id, scheduledOn: contentCalendar.scheduledOn, status: contentCalendar.status })
    .from(contentCalendar)
    .where(and(eq(contentCalendar.deliverableId, deliverableId), isNull(contentCalendar.deletedAt)))
    .limit(1);

  if (existing) {
    // Publicatiedatum: contentplanning is leidend → spiegel naar de video.
    if (existing.scheduledOn && existing.scheduledOn !== d.plannedPublishOn) {
      await db.update(deliverables).set({ plannedPublishOn: existing.scheduledOn, updatedAt: new Date() }).where(eq(deliverables.id, d.id));
    }
    // "Gepubliceerd" doorzetten naar de planning.
    if (d.status === "published" && existing.status !== "published") {
      await db.update(contentCalendar).set({ status: "published", updatedAt: new Date() }).where(eq(contentCalendar.id, existing.id));
      return { action: "update:published" };
    }
    return { action: "noop" };
  }

  if (!CREATE_STATES.has(d.status)) return { action: "skip:not_publishable" };

  const scheduledOn = d.plannedPublishOn ?? d.dueOn ?? new Date().toISOString().slice(0, 10);
  await db.insert(contentCalendar).values({
    clientId: d.clientId,
    deliverableId: d.id,
    title: d.title,
    scheduledOn,
    status: mapStatus(d.status),
    platforms: [],
  });
  // Datum terugspiegelen zodat video en planning dezelfde datum tonen.
  if (d.plannedPublishOn !== scheduledOn) {
    await db.update(deliverables).set({ plannedPublishOn: scheduledOn, updatedAt: new Date() }).where(eq(deliverables.id, d.id));
  }
  return { action: "create" };
}

/** Alle publiceerbare video's reconciliëren naar de contentplanning. */
export async function reconcileContentFromVideos(): Promise<{ created: number; updated: number; checked: number }> {
  const rows = await db
    .select({ id: deliverables.id })
    .from(deliverables)
    .where(and(isNull(deliverables.deletedAt), inArray(deliverables.status, [...PUBLISHABLE])));

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const res = await syncContentForDeliverable(r.id);
    if (res.action === "create") created++;
    else if (res.action.startsWith("update")) updated++;
  }
  return { created, updated, checked: rows.length };
}
