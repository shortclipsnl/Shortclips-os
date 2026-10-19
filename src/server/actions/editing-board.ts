"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, editProjectFiles, productionDays } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { EDIT_PHASE_ORDER } from "@/lib/statuses";

export type ActionResult = { ok: boolean; message?: string };

const MAX_SCRIPT_BYTES = 10 * 1024 * 1024; // 10 MB — ruim voor een script-pdf

/** Handmatig een nieuw edit-project (opname) aanmaken, los van de Google-sync. */
export async function createEditingProject(input: {
  clientId: string;
  scheduledOn: string;
  title: string;
  editorId?: string | null;
  plannedShorts?: number | null;
}): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    const title = input.title.trim();
    if (!title) return { ok: false, message: "Geef het project een titel." };
    if (!input.clientId) return { ok: false, message: "Kies een klant." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledOn)) return { ok: false, message: "Kies een opnamedatum." };
    assertClientAccess(viewer, input.clientId);

    await db.insert(productionDays).values({
      clientId: input.clientId,
      title: title.slice(0, 200),
      scheduledOn: input.scheduledOn,
      editorId: input.editorId ?? null,
      plannedShorts: input.plannedShorts ?? null,
      status: "planned",
    });

    revalidatePath("/videos");
    return { ok: true, message: "Project aangemaakt." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

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

/** Handmatige oplevering-deadline zetten (of wissen → terug naar automatisch). */
export async function setProjectDeadline(id: string, dueOn: string | null): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { ok: false, message: "Ongeldige datum." };
    const project = await loadProject(id);
    if (!project) return { ok: false, message: "Project niet gevonden." };
    assertClientAccess(viewer, project.clientId);

    await db.update(productionDays).set({ editDueOn: dueOn ?? null, updatedAt: new Date() }).where(eq(productionDays.id, id));
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

/** Script-pdf uploaden bij een edit-project. Vervangt een eventueel bestaand
 *  script. Wordt als base64 in de database bewaard (klein bestand). */
export async function uploadProjectScript(
  id: string,
  file: { fileName: string; contentType: string; base64: string },
): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    const project = await loadProject(id);
    if (!project) return { ok: false, message: "Project niet gevonden." };
    assertClientAccess(viewer, project.clientId);

    const isPdf = file.contentType === "application/pdf" || file.fileName.toLowerCase().endsWith(".pdf");
    if (!isPdf) return { ok: false, message: "Alleen een pdf-bestand kan worden geüpload." };
    const sizeBytes = Math.floor((file.base64.length * 3) / 4);
    if (sizeBytes > MAX_SCRIPT_BYTES) return { ok: false, message: "Het bestand is te groot (max 10 MB)." };
    if (sizeBytes === 0) return { ok: false, message: "Leeg bestand." };

    // Oud script vervangen.
    await db.delete(editProjectFiles).where(and(eq(editProjectFiles.productionDayId, id), eq(editProjectFiles.kind, "script")));
    await db.insert(editProjectFiles).values({
      productionDayId: id,
      kind: "script",
      fileName: file.fileName.slice(0, 255),
      contentType: "application/pdf",
      sizeBytes,
      dataBase64: file.base64,
      uploadedById: viewer.id,
    });

    revalidatePath("/videos");
    return { ok: true, message: "Script geüpload." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Het geüploade script-pdf verwijderen. */
export async function deleteProjectScript(id: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    const project = await loadProject(id);
    if (!project) return { ok: false, message: "Project niet gevonden." };
    assertClientAccess(viewer, project.clientId);

    await db.delete(editProjectFiles).where(and(eq(editProjectFiles.productionDayId, id), eq(editProjectFiles.kind, "script")));
    revalidatePath("/videos");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
