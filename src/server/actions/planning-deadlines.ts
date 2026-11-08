"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { planningDeadlines } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { activeDeadlineFor, startDeadlineIfNone, type HistoryEntry } from "@/server/planning-deadlines";

export type DeadlineActionResult = { ok: boolean; message?: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function refresh() {
  revalidatePath("/calendar");
  revalidatePath("/portal/content");
}

async function guarded(fn: () => Promise<DeadlineActionResult>): Promise<DeadlineActionResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Handmatig de deadline van een lopende afteller aanpassen, met vastlegging. */
export async function adjustPlanningDeadline(clientId: string, newDate: string, reason: string): Promise<DeadlineActionResult> {
  return guarded(async () => {
    const viewer = await requirePermission("calendar:write");
    assertClientAccess(viewer, clientId);
    if (!ISO.test(newDate)) return { ok: false, message: "Kies een geldige datum." };
    const why = reason.trim();
    if (why.length < 3) return { ok: false, message: "Geef kort aan waarom de deadline verandert." };
    const row = await activeDeadlineFor(clientId);
    if (!row) return { ok: false, message: "Er loopt geen deadline voor deze klant." };
    if (newDate <= row.startedOn) return { ok: false, message: "De deadline moet na de startdatum liggen." };
    if (newDate === row.deadlineOn) return { ok: true };
    const entry: HistoryEntry = { at: new Date().toISOString(), byName: viewer.fullName, action: "deadline aangepast", from: row.deadlineOn, to: newDate, reason: why.slice(0, 300) };
    await db
      .update(planningDeadlines)
      .set({ deadlineOn: newDate, history: [...((row.history as HistoryEntry[]) ?? []), entry], updatedAt: new Date() })
      .where(and(eq(planningDeadlines.id, row.id), eq(planningDeadlines.status, "active")));
    await auditLog({ viewer, action: "planning_deadline.adjusted", entityType: "planning_deadline", entityId: row.id, clientId, changes: { from: row.deadlineOn, to: newDate, reason: entry.reason } });
    refresh();
    return { ok: true };
  });
}

/** Handmatig op Afgerond zetten (bijv. afspraken telefonisch geregeld). */
export async function completePlanningDeadline(clientId: string): Promise<DeadlineActionResult> {
  return guarded(async () => {
    const viewer = await requirePermission("calendar:write");
    assertClientAccess(viewer, clientId);
    const row = await activeDeadlineFor(clientId);
    if (!row) return { ok: false, message: "Er loopt geen deadline voor deze klant." };
    const entry: HistoryEntry = { at: new Date().toISOString(), byName: viewer.fullName, action: "afgerond" };
    await db
      .update(planningDeadlines)
      .set({ status: "completed", completedAt: new Date(), completedVia: "manual", completedById: viewer.id, history: [...((row.history as HistoryEntry[]) ?? []), entry], updatedAt: new Date() })
      .where(and(eq(planningDeadlines.id, row.id), eq(planningDeadlines.status, "active")));
    await auditLog({ viewer, action: "planning_deadline.completed", entityType: "planning_deadline", entityId: row.id, clientId, changes: { via: "manual" } });
    refresh();
    return { ok: true };
  });
}

/** Afteller handmatig starten voor een klant waarvan de planning al eerder gedeeld is. */
export async function startPlanningDeadline(clientId: string): Promise<DeadlineActionResult> {
  return guarded(async () => {
    const viewer = await requirePermission("calendar:write");
    assertClientAccess(viewer, clientId);
    const started = await startDeadlineIfNone(clientId, viewer.id);
    if (!started) return { ok: false, message: "Voor deze klant loopt al een deadline." };
    await auditLog({ viewer, action: "planning_deadline.started", entityType: "client", entityId: clientId, clientId, changes: { via: "manual" } });
    refresh();
    return { ok: true };
  });
}
