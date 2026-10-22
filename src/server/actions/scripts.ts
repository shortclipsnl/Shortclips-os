"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, scriptVersions, scripts } from "@/db/schema";
import {
  assertClientAccess,
  ForbiddenError,
  requirePermission,
} from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { dispatch } from "@/server/automation";
import { SCRIPT_STATUS } from "@/lib/statuses";
import { rememberApprovedScript } from "@/server/scripts/learning";

export type ActionResult = { ok: boolean; message?: string };

const contentSchema = z.object({
  title: z.string().trim().min(1, "Een script heeft een titel nodig.").max(240),
  hook: z.string().max(2000).nullish(),
  body: z.string().max(20000).nullish(),
  cta: z.string().max(2000).nullish(),
  shotList: z.string().max(8000).nullish(),
  requirements: z.string().max(4000).nullish(),
  internalNotes: z.string().max(8000).nullish(),
  changeSummary: z.string().max(400).nullish(),
});

async function loadScript(id: string) {
  const [row] = await db
    .select({
      id: scripts.id,
      clientId: scripts.clientId,
      title: scripts.title,
      status: scripts.status,
      currentVersion: scripts.currentVersion,
      hook: scripts.hook,
      body: scripts.body,
      cta: scripts.cta,
      shotList: scripts.shotList,
      requirements: scripts.requirements,
      internalNotes: scripts.internalNotes,
      coordinatorId: clients.coordinatorId,
    })
    .from(scripts)
    .innerJoin(clients, eq(clients.id, scripts.clientId))
    .where(eq(scripts.id, id))
    .limit(1);
  return row;
}

/**
 * Opslaan maakt automatisch een nieuwe versie aan met een momentopname van de
 * vorige inhoud. Zo is de geschiedenis compleet zonder dat iemand eraan hoeft
 * te denken.
 */
export async function saveScript(
  scriptId: string,
  input: z.input<typeof contentSchema>,
): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const parsed = contentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };

    const current = await loadScript(scriptId);
    if (!current) return { ok: false, message: "Script niet gevonden." };
    assertClientAccess(viewer, current.clientId);

    const nextVersion = current.currentVersion + 1;

    await db.insert(scriptVersions).values({
      scriptId,
      versionNumber: nextVersion,
      snapshot: {
        title: parsed.data.title,
        hook: parsed.data.hook ?? null,
        body: parsed.data.body ?? null,
        cta: parsed.data.cta ?? null,
        shotList: parsed.data.shotList ?? null,
        requirements: parsed.data.requirements ?? null,
      },
      changeSummary: parsed.data.changeSummary || "Handmatig bijgewerkt",
      status: current.status,
      authorId: viewer.id,
    });

    await db
      .update(scripts)
      .set({
        title: parsed.data.title,
        hook: parsed.data.hook ?? null,
        body: parsed.data.body ?? null,
        cta: parsed.data.cta ?? null,
        shotList: parsed.data.shotList ?? null,
        requirements: parsed.data.requirements ?? null,
        internalNotes: parsed.data.internalNotes ?? null,
        currentVersion: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(scripts.id, scriptId));

    await auditLog({
      viewer,
      action: "script.updated",
      entityType: "script",
      entityId: scriptId,
      clientId: current.clientId,
      changes: { versie: nextVersion },
    });
    await recordActivity({
      clientId: current.clientId,
      type: "script.updated",
      title: `Script aangepast: ${parsed.data.title}`,
      body: parsed.data.changeSummary || undefined,
      entityType: "script",
      entityId: scriptId,
      actor: { id: viewer.id, fullName: viewer.fullName },
    });

    revalidatePath(`/scripts/${scriptId}`);
    return { ok: true, message: `Opgeslagen als versie ${nextVersion}.` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function changeScriptStatus(
  scriptId: string,
  nextStatus: string,
): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    if (!(nextStatus in SCRIPT_STATUS)) return { ok: false, message: "Onbekende status." };

    const current = await loadScript(scriptId);
    if (!current) return { ok: false, message: "Script niet gevonden." };
    assertClientAccess(viewer, current.clientId);

    if (["approved", "ready_to_shoot"].includes(nextStatus) && !viewer.permissions.has("scripts:approve")) {
      return { ok: false, message: "Je mag scripts niet goedkeuren." };
    }

    await db
      .update(scripts)
      .set({
        status: nextStatus as "approved",
        approvedAt: nextStatus === "approved" ? new Date() : null,
        approvedById: nextStatus === "approved" ? viewer.id : null,
        updatedAt: new Date(),
      })
      .where(eq(scripts.id, scriptId));

    await auditLog({
      viewer,
      action: "script.status_changed",
      entityType: "script",
      entityId: scriptId,
      clientId: current.clientId,
      changes: { van: current.status, naar: nextStatus },
    });
    await recordActivity({
      clientId: current.clientId,
      type: "script.status_changed",
      title: `Script naar ${SCRIPT_STATUS[nextStatus]!.label}: ${current.title}`,
      entityType: "script",
      entityId: scriptId,
      actor: { id: viewer.id, fullName: viewer.fullName },
      isClientVisible: ["client_review", "approved"].includes(nextStatus),
    });
    await dispatch({
      trigger: "script.status_changed",
      clientId: current.clientId,
      entityType: "script",
      entityId: scriptId,
      data: { from: current.status, to: nextStatus, coordinatorId: current.coordinatorId },
    });

    // Leerlus: een goedgekeurd script onthouden als sterk voorbeeld, zodat de
    // scriptgenerator er voortaan van spiegelt. Nooit blokkerend.
    if (nextStatus === "approved") {
      try {
        await rememberApprovedScript({
          clientId: current.clientId,
          scriptId,
          title: current.title,
          hook: current.hook,
          body: current.body,
          userId: viewer.id,
        });
      } catch {
        /* leren mag goedkeuren nooit tegenhouden */
      }
    }

    revalidatePath(`/scripts/${scriptId}`);
    revalidatePath("/scripts");
    return { ok: true, message: `Status: ${SCRIPT_STATUS[nextStatus]!.label}.` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
