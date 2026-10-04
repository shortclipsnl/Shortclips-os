import "server-only";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  deliverables,
  productionChecklistItems,
  productionDays,
  scripts,
  users,
} from "@/db/schema";
import { assertClientAccess, scopeToClients, type Viewer } from "@/server/auth/context";

const today = () => new Date().toISOString().slice(0, 10);

export async function listProductionDays(viewer: Viewer, when: "komend" | "verleden" = "komend") {
  return db
    .select({
      id: productionDays.id,
      title: productionDays.title,
      scheduledOn: productionDays.scheduledOn,
      startTime: productionDays.startTime,
      endTime: productionDays.endTime,
      locationName: productionDays.locationName,
      status: productionDays.status,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      videographerName: users.fullName,
      scriptCount: sql<number>`(select count(*) from scripts sc where sc.production_day_id = production_days.id and sc.deleted_at is null)`,
      unapprovedScripts: sql<number>`(select count(*) from scripts sc where sc.production_day_id = production_days.id and sc.deleted_at is null and sc.status not in ('approved','ready_to_shoot','shot'))`,
      openBlockers: sql<number>`(select count(*) from production_checklist_items ci where ci.production_day_id = production_days.id and ci.is_blocking = true and ci.is_done = false)`,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(users, eq(users.id, productionDays.videographerId))
    .where(
      and(
        isNull(productionDays.deletedAt),
        when === "komend"
          ? gte(productionDays.scheduledOn, today())
          : lt(productionDays.scheduledOn, today()),
        scopeToClients(viewer, productionDays.clientId),
      ),
    )
    .orderBy(
      when === "komend"
        ? asc(productionDays.scheduledOn)
        : desc(productionDays.scheduledOn),
    )
    .limit(200);
}

export async function getProductionDay(viewer: Viewer, id: string) {
  const [day] = await db
    .select({
      id: productionDays.id,
      clientId: productionDays.clientId,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      title: productionDays.title,
      scheduledOn: productionDays.scheduledOn,
      startTime: productionDays.startTime,
      endTime: productionDays.endTime,
      locationName: productionDays.locationName,
      locationAddress: productionDays.locationAddress,
      status: productionDays.status,
      schedule: productionDays.schedule,
      notes: productionDays.notes,
      driveFolderId: productionDays.driveFolderId,
      frameProjectId: productionDays.frameProjectId,
      videographerName: users.fullName,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(users, eq(users.id, productionDays.videographerId))
    .where(and(eq(productionDays.id, id), isNull(productionDays.deletedAt)))
    .limit(1);

  if (!day) notFound();
  assertClientAccess(viewer, day.clientId);

  const [checklist, dayScripts, videos] = await Promise.all([
    db.select().from(productionChecklistItems)
      .where(eq(productionChecklistItems.productionDayId, id))
      .orderBy(asc(productionChecklistItems.sortOrder)),
    db.select({
      id: scripts.id, title: scripts.title, status: scripts.status,
      pillar: scripts.pillar, presenter: scripts.presenter, requirements: scripts.requirements,
    })
      .from(scripts)
      .where(and(eq(scripts.productionDayId, id), isNull(scripts.deletedAt)))
      .orderBy(asc(scripts.title)),
    db.select({ id: deliverables.id, title: deliverables.title, status: deliverables.status })
      .from(deliverables)
      .where(and(eq(deliverables.productionDayId, id), isNull(deliverables.deletedAt))),
  ]);

  return { day, checklist, scripts: dayScripts, videos };
}

export type ProductionDetail = Awaited<ReturnType<typeof getProductionDay>>;
