import "server-only";
import { notFound } from "next/navigation";
import {
  and,
  desc,
  eq,
  isNull,
} from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, productionDays, scriptVersions, scripts, users } from "@/db/schema";
import { assertClientAccess, scopeToClients, type Viewer } from "@/server/auth/context";

export async function listScripts(
  viewer: Viewer,
  filter: { status?: string; clientSlug?: string } = {},
) {
  const conditions = [isNull(scripts.deletedAt), scopeToClients(viewer, scripts.clientId)];
  if (filter.status) conditions.push(eq(scripts.status, filter.status as "idea"));
  if (filter.clientSlug) conditions.push(eq(clients.slug, filter.clientSlug));

  return db
    .select({
      id: scripts.id,
      title: scripts.title,
      status: scripts.status,
      pillar: scripts.pillar,
      format: scripts.format,
      currentVersion: scripts.currentVersion,
      updatedAt: scripts.updatedAt,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      creatorName: users.fullName,
      shootOn: productionDays.scheduledOn,
    })
    .from(scripts)
    .innerJoin(clients, eq(clients.id, scripts.clientId))
    .leftJoin(users, eq(users.id, scripts.creatorId))
    .leftJoin(productionDays, eq(productionDays.id, scripts.productionDayId))
    .where(and(...conditions))
    .orderBy(desc(scripts.updatedAt))
    .limit(300);
}

export async function getScript(viewer: Viewer, id: string) {
  const [script] = await db
    .select({
      id: scripts.id,
      clientId: scripts.clientId,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      title: scripts.title,
      status: scripts.status,
      pillar: scripts.pillar,
      format: scripts.format,
      hook: scripts.hook,
      body: scripts.body,
      cta: scripts.cta,
      shotList: scripts.shotList,
      requirements: scripts.requirements,
      locationName: scripts.locationName,
      presenter: scripts.presenter,
      internalNotes: scripts.internalNotes,
      clientNotes: scripts.clientNotes,
      currentVersion: scripts.currentVersion,
      approvedAt: scripts.approvedAt,
      updatedAt: scripts.updatedAt,
      creatorName: users.fullName,
      productionDayId: scripts.productionDayId,
      shootOn: productionDays.scheduledOn,
      shootTitle: productionDays.title,
    })
    .from(scripts)
    .innerJoin(clients, eq(clients.id, scripts.clientId))
    .leftJoin(users, eq(users.id, scripts.creatorId))
    .leftJoin(productionDays, eq(productionDays.id, scripts.productionDayId))
    .where(and(eq(scripts.id, id), isNull(scripts.deletedAt)))
    .limit(1);

  if (!script) notFound();
  assertClientAccess(viewer, script.clientId);

  const [versions, videos] = await Promise.all([
    db.select({
      id: scriptVersions.id,
      versionNumber: scriptVersions.versionNumber,
      changeSummary: scriptVersions.changeSummary,
      status: scriptVersions.status,
      createdAt: scriptVersions.createdAt,
      snapshot: scriptVersions.snapshot,
      authorName: users.fullName,
    })
      .from(scriptVersions)
      .leftJoin(users, eq(users.id, scriptVersions.authorId))
      .where(eq(scriptVersions.scriptId, id))
      .orderBy(desc(scriptVersions.versionNumber)),

    db.select({ id: deliverables.id, title: deliverables.title, status: deliverables.status })
      .from(deliverables)
      .where(and(eq(deliverables.scriptId, id), isNull(deliverables.deletedAt))),
  ]);

  return { script, versions, videos };
}

export type ScriptDetail = Awaited<ReturnType<typeof getScript>>;
