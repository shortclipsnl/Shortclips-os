"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, productionDays } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { EDIT_PHASE_ORDER } from "@/lib/statuses";

export type ActionResult = { ok: boolean; message?: string };

async function loadProject(id: string) {
  const [row] = await db
    .select({ id: productionDays.id, clientId: productionDays.clientId, editorId: productionDays.editorId, editStatus: productionDays.editStatus })
    .from(productionDays)
    .where(and(eq(productionDays.id, id), isNull(productionDays.deletedAt)))
    .limit(1);
  return row;
}

/** Editor toewijzen aan een opname/edit-project. Wijst ook meteen alle shorts van
 *  die opname aan deze editor toe, zodat ze op het board van die editor komen. */
export async function setProjectEditor(id: string, editorId: string | null): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:assign");
    const project = await loadProject(id);
    if (!project) return { ok: false, message: "Project niet gevonden." };
    assertClientAccess(viewer, project.clientId);

    await db
      .update(productionDays)
      .set({ editorId, updatedAt: new Date() })
      .where(eq(productionDays.id, id));

    // Shorts van deze opname meeverhuizen naar de nieuwe editor.
    await db
      .update(deliverables)
      .set({ editorId, updatedAt: new Date() })
      .where(and(eq(deliverables.productionDayId, id), isNull(deliverables.deletedAt)));

    await auditLog({
      viewer,
      action: "editproject.editor_assigned",
      entityType: "production_day",
      entityId: id,
      clientId: project.clientId,
      changes: { van: project.editorId, naar: editorId },
    });

    revalidatePath("/videos");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Editingfase van het project wijzigen (te_plannen … afgerond). */
export async function setProjectEditStatus(id: string, status: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    if (!EDIT_PHASE_ORDER.includes(status as (typeof EDIT_PHASE_ORDER)[number])) {
      return { ok: false, message: "Onbekende fase." };
    }
    const project = await loadProject(id);
    if (!project) return { ok: false, message: "Project niet gevonden." };
    assertClientAccess(viewer, project.clientId);

    await db
      .update(productionDays)
      .set({ editStatus: status, updatedAt: new Date() })
      .where(eq(productionDays.id, id));

    await auditLog({
      viewer,
      action: "editproject.status_changed",
      entityType: "production_day",
      entityId: id,
      clientId: project.clientId,
      changes: { van: project.editStatus, naar: status },
    });

    revalidatePath("/videos");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Aantal geplande shorts voor een opname zetten. */
export async function setProjectPlannedShorts(id: string, plannedShorts: number | null): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    const project = await loadProject(id);
    if (!project) return { ok: false, message: "Project niet gevonden." };
    assertClientAccess(viewer, project.clientId);
    const n = plannedShorts === null ? null : Math.max(0, Math.min(99, Math.round(plannedShorts)));

    await db.update(productionDays).set({ plannedShorts: n, updatedAt: new Date() }).where(eq(productionDays.id, id));
    revalidatePath("/videos");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Download-link (beeldmateriaal) en/of scriptlink zetten. */
export async function setProjectLinks(
  id: string,
  links: { footageUrl?: string | null; scriptUrl?: string | null },
): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    const project = await loadProject(id);
    if (!project) return { ok: false, message: "Project niet gevonden." };
    assertClientAccess(viewer, project.clientId);

    const clean = (u: string | null | undefined) => {
      if (u === undefined) return undefined;
      const v = (u ?? "").trim();
      return v.length === 0 ? null : v;
    };
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (links.footageUrl !== undefined) patch.footageUrl = clean(links.footageUrl);
    if (links.scriptUrl !== undefined) patch.scriptUrl = clean(links.scriptUrl);

    await db.update(productionDays).set(patch).where(eq(productionDays.id, id));
    revalidatePath("/videos");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
