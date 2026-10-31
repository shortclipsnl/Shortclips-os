"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clearEditScript, createEditScriptUploadTarget, replaceEditScript } from "@/server/editing/script-file";
import {
  clients,
  deliverables,
  reviewComments,
  reviewThreads,
  users,
} from "@/db/schema";
import {
  assertClientAccess,
  requireInternal,
  requirePermission,
  requireViewer,
  ForbiddenError,
  type Viewer,
} from "@/server/auth/context";
import { isCoreStaff } from "@/server/core-staff";

/**
 * Wie de bestanden (downloadlinks + script) van een edit-project mag bijwerken:
 * - iedereen met videos:write;
 * - het kernteam (Milou, Jiska, Rutger) — zij beheren alle edit-projecten,
 *   net als de eigenaar;
 * - een editor voor zijn EIGEN edit-projecten, ook zonder videos:write.
 * Geeft een melding terug als het niet mag.
 */
function mayEditVideoFiles(viewer: Viewer, video: { editorId: string | null }): string | null {
  if (viewer.permissions.has("videos:write")) return null;
  if (isCoreStaff(viewer.email)) return null;
  if (video.editorId && video.editorId === viewer.id) return null;
  return "Je kunt alleen de bestanden van je eigen editprojecten bijwerken.";
}
import { auditLog, recordActivity } from "@/server/audit";
import { dispatch } from "@/server/automation";
import { notify } from "@/server/notifications";
import { syncContentForDeliverable } from "@/server/content-sync";
import { addWorkingDays } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { VIDEO_STAGES, VIDEO_STATUS, type VideoStage } from "@/lib/statuses";
import { AWARD_DONE_STATUSES, recordAwardsSafe } from "@/server/awards/service";

export type ActionResult = { ok: boolean; message?: string };

async function loadVideo(id: string) {
  const [row] = await db
    .select({
      id: deliverables.id,
      clientId: deliverables.clientId,
      title: deliverables.title,
      status: deliverables.status,
      editorId: deliverables.editorId,
      productionDayId: deliverables.productionDayId,
      internalRevisionRounds: deliverables.internalRevisionRounds,
      clientRevisionRounds: deliverables.clientRevisionRounds,
      coordinatorId: clients.coordinatorId,
      clientName: clients.name,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .where(eq(deliverables.id, id))
    .limit(1);
  return row;
}

/**
 * Vraag van de editor over een video → directe melding (pop-up + geluid) naar de
 * verantwoordelijke coördinator en de eigenaar, zodat er snel antwoord komt.
 */
export async function askEditorQuestion(videoId: string, question: string): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    const q = question.trim();
    if (q.length < 2) return { ok: false, message: "Typ eerst je vraag." };
    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    await notify({
      userIds: video.coordinatorId ? [video.coordinatorId] : [],
      roles: ["owner"],
      clientId: video.clientId,
      type: "editor_question",
      level: "warning",
      title: `Vraag van ${viewer.fullName.split(" ")[0] ?? "editor"} — ${video.clientName}`,
      body: q,
      href: `/videos/${videoId}`,
    });
    await recordActivity({
      clientId: video.clientId,
      type: "editor.question",
      title: `Vraag van editor over "${video.title}": ${q.slice(0, 140)}`,
      actor: { id: viewer.id, fullName: viewer.fullName },
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Downloadlink (beeldmateriaal) en/of scriptlink van een video zetten. */
export async function setEditingVideoLinks(
  videoId: string,
  links: { footageUrl?: string | null; scriptUrl?: string | null },
): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);
    const denied = mayEditVideoFiles(viewer, video);
    if (denied) return { ok: false, message: denied };

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if ("footageUrl" in links) patch.footageUrl = links.footageUrl?.trim() || null;
    if ("scriptUrl" in links) patch.scriptUrl = links.scriptUrl?.trim() || null;
    await db.update(deliverables).set(patch).where(eq(deliverables.id, videoId));

    revalidatePath("/videos");
    revalidatePath(`/videos/${videoId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const MAX_SCRIPT_BYTES = 10 * 1024 * 1024; // 10 MB — ruim voor een script-pdf

/**
 * Script-pdf uploaden bij een video. Een script hoort bij de OPNAME(dag): alle
 * shorts van dezelfde opname delen hetzelfde script. We bewaren het als base64 in
 * de database (klein bestand, geen externe opslag nodig) en vervangen een
 * eventueel bestaand script van die opname.
 */
export async function uploadVideoScript(
  videoId: string,
  file: { fileName: string; contentType: string; base64?: string; storagePath?: string; sizeBytes?: number },
): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);
    const denied = mayEditVideoFiles(viewer, video);
    if (denied) return { ok: false, message: denied };
    if (!video.productionDayId) {
      return { ok: false, message: "Deze video heeft geen gekoppelde opnamedag. Het script hoort bij een opname." };
    }

    const isPdf = file.contentType === "application/pdf" || file.fileName.toLowerCase().endsWith(".pdf");
    if (!isPdf) return { ok: false, message: "Alleen een pdf-bestand kan worden geüpload." };
    if (!file.base64 && !file.storagePath) return { ok: false, message: "Geen bestand ontvangen." };
    const sizeBytes = file.base64 ? Math.floor((file.base64.length * 3) / 4) : (file.sizeBytes ?? 0);
    if (sizeBytes > MAX_SCRIPT_BYTES) return { ok: false, message: "Het bestand is te groot (max 10 MB)." };
    if (sizeBytes === 0) return { ok: false, message: "Leeg bestand." };

    await replaceEditScript(video.productionDayId, { fileName: file.fileName, contentType: "application/pdf", sizeBytes, base64: file.base64, storagePath: file.storagePath }, viewer.id);

    revalidatePath("/videos");
    revalidatePath(`/videos/${videoId}`);
    return { ok: true, message: "Script geüpload." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Maakt een directe upload-URL (Supabase) zodat de browser de script-pdf buiten de
 * server-action om kan uploaden — nodig omdat Vercel request-bodies op 4,5MB cap't.
 * Geeft null terug als er geen opslag is ingesteld; de UI valt dan terug op base64.
 */
export async function createVideoScriptUploadUrl(videoId: string): Promise<ActionResult & { uploadUrl?: string; storagePath?: string; headers?: Record<string, string> }> {
  try {
    const viewer = await requireInternal();
    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);
    const denied = mayEditVideoFiles(viewer, video);
    if (denied) return { ok: false, message: denied };
    if (!video.productionDayId) return { ok: false, message: "Deze video heeft geen gekoppelde opnamedag." };
    const target = await createEditScriptUploadTarget(video.clientId);
    if (!target) return { ok: true }; // geen opslag ingesteld → base64-terugval
    return { ok: true, uploadUrl: target.uploadUrl, storagePath: target.key, headers: target.headers };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Het geüploade script-pdf van de opname van deze video verwijderen. */
export async function deleteVideoScript(videoId: string): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);
    const denied = mayEditVideoFiles(viewer, video);
    if (denied) return { ok: false, message: denied };
    if (!video.productionDayId) return { ok: true };

    await clearEditScript(video.productionDayId);
    revalidatePath("/videos");
    revalidatePath(`/videos/${videoId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Deadline (opleverdatum) van een video handmatig zetten of wissen. */
export async function setEditingVideoDeadline(
  videoId: string,
  input: { dueOn?: string | null; shootOn?: string | null },
): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    const clean = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    // De opnamedatum is het startpunt; de deadline is altijd 14 werkdagen later en
    // wordt automatisch gezet (niet apart invullen). Zet je de opname → deadline
    // volgt vanzelf; wis je de opname → deadline ook weg.
    if (input.shootOn !== undefined) {
      const shoot = clean(input.shootOn);
      set.shootOn = shoot;
      set.dueOn = shoot ? addWorkingDays(shoot, 14, nlHolidaySet()) : null;
      set.dueOnSource = "auto";
    } else if (input.dueOn !== undefined) {
      // Alleen een losse deadline aanpassen (handmatige override).
      const due = clean(input.dueOn);
      set.dueOn = due;
      set.dueOnSource = due ? "manual" : "auto";
    }
    await db.update(deliverables).set(set).where(eq(deliverables.id, videoId));

    revalidatePath("/videos");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Aantal shorts van een video zetten. */
export async function setEditingVideoShorts(videoId: string, shorts: number | null): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);
    const denied = mayEditVideoFiles(viewer, video);
    if (denied) return { ok: false, message: denied };

    const n = shorts === null ? null : Math.max(0, Math.min(99, Math.round(shorts)));
    await db.update(deliverables).set({ plannedShorts: n, updatedAt: new Date() }).where(eq(deliverables.id, videoId));

    revalidatePath("/videos");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Statuswissel: de kern van de pipeline. Zet ook tellers en automatiseringen aan. */
export async function changeVideoStatus(
  videoId: string,
  nextStatus: string,
): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    if (!VIDEO_STAGES.includes(nextStatus as VideoStage)) {
      return { ok: false, message: "Onbekende status." };
    }

    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    // Publiceren en goedkeuren vragen om een extra recht.
    if (["approved", "ready_to_publish"].includes(nextStatus) && !viewer.permissions.has("videos:approve")) {
      return { ok: false, message: "Je mag video's niet goedkeuren." };
    }
    if (["scheduled", "published"].includes(nextStatus) && !viewer.permissions.has("videos:publish")) {
      return { ok: false, message: "Je mag video's niet publiceren." };
    }
    // Interne review verplicht: een video gaat niet naar de klant zonder akkoord
    // van de Content Creative. Alleen een Content Creative/coördinator/eigenaar
    // mag de status op "Feedback klant" (naar de klant) zetten.
    if (nextStatus === "client_review") {
      const approverRoles = ["owner", "admin", "project_coordinator", "content_creator"];
      if (!approverRoles.includes(viewer.primaryRole)) {
        return { ok: false, message: "Alleen een Content Creative mag een video naar de klant sturen — laat de interne review eerst akkoord geven." };
      }
    }

    const patch: Record<string, unknown> = {
      status: nextStatus as VideoStage,
      statusChangedAt: new Date(),
      updatedAt: new Date(),
    };
    if (nextStatus === "editor_revision") {
      patch.internalRevisionRounds = video.internalRevisionRounds + 1;
    }
    if (nextStatus === "client_revision") {
      patch.clientRevisionRounds = video.clientRevisionRounds + 1;
    }
    if (nextStatus === "approved") patch.approvedAt = new Date();
    if (nextStatus === "published") patch.publishedAt = new Date();

    await db.update(deliverables).set(patch).where(eq(deliverables.id, videoId));

    // Showcase: awards van de editor bijwerken zodra de video klantgoedgekeurd of
    // afgerond is (nooit blokkerend; het nachtelijke vangnet herstelt).
    if ((AWARD_DONE_STATUSES as readonly string[]).includes(nextStatus)) {
      await recordAwardsSafe(video.editorId);
    }

    const label = VIDEO_STATUS[nextStatus as VideoStage]?.label ?? nextStatus;
    await Promise.all([
      auditLog({
        viewer,
        action: "video.status_changed",
        entityType: "deliverable",
        entityId: videoId,
        clientId: video.clientId,
        changes: { van: video.status, naar: nextStatus },
      }),
      recordActivity({
        clientId: video.clientId,
        type: "video.status_changed",
        title: `Video naar ${label}: ${video.title}`,
        entityType: "deliverable",
        entityId: videoId,
        actor: { id: viewer.id, fullName: viewer.fullName },
        isClientVisible: ["client_review", "approved", "published"].includes(nextStatus),
      }),
      dispatch({
        trigger: "video.status_changed",
        clientId: video.clientId,
        entityType: "deliverable",
        entityId: videoId,
        data: {
          from: video.status,
          to: nextStatus,
          title: video.title,
          coordinatorId: video.coordinatorId,
          productionDayId: video.productionDayId,
          actorId: viewer.id,
          href: `/videos/${videoId}`,
        },
      }),
    ]);

    // Koppeling met de contentplanning gelijktrekken (één gekoppeld record).
    await syncContentForDeliverable(videoId);

    revalidatePath(`/videos/${videoId}`);
    revalidatePath("/videos");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return { ok: true, message: `Status gewijzigd naar ${label}.` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Vult de editor in op alle video's die er nog geen hebben, op basis van de
 * vaste editor per klant (clients.editorName / "welke editor doet welke klant").
 * Zo verschijnen die video's meteen op het board van de juiste editor. Reversibel:
 * per video is de editor altijd nog aan te passen.
 */
export async function autofillEditorsFromClients(): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:assign");
    const { listEditorOptions } = await import("@/server/videos");
    const { firstNameKey } = await import("@/lib/editors");

    const editorUsers = await listEditorOptions();
    const byKey = new Map<string, string>();
    for (const e of editorUsers) { const k = firstNameKey(e.fullName); if (k && !byKey.has(k)) byKey.set(k, e.id); }

    const cls = await db.select({ id: clients.id, editorName: clients.editorName }).from(clients).where(isNull(clients.deletedAt));
    let count = 0;
    let unmatched = 0;
    for (const c of cls) {
      if (!c.editorName) continue;
      const uid = byKey.get(firstNameKey(c.editorName));
      if (!uid) { unmatched++; continue; }
      const res = await db
        .update(deliverables)
        .set({ editorId: uid, updatedAt: new Date() })
        .where(and(eq(deliverables.clientId, c.id), isNull(deliverables.editorId), isNull(deliverables.deletedAt)))
        .returning({ id: deliverables.id });
      count += res.length;
    }
    if (count > 0) {
      await auditLog({ viewer, action: "videos.autofill_editors", entityType: "deliverable", entityId: "bulk", changes: { count } });
      revalidatePath("/videos");
    }
    const extra = unmatched > 0 ? ` (${unmatched} klant${unmatched === 1 ? "" : "en"} zonder herkenbare editor overgeslagen)` : "";
    return { ok: true, message: count > 0 ? `${count} video${count === 1 ? "" : "'s"} gekoppeld aan de juiste editor${extra}.` : `Alle video's hadden al een editor${extra}.` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function assignEditor(
  videoId: string,
  editorId: string | null,
): Promise<ActionResult> {
  try {
    // Editors toewijzen mag iedereen met videos:assign én het vaste kantoorteam
    // (Milou, Jiska, Rutger), net als de eigenaar — zelfde uitzondering als bij
    // het bijwerken van de bestanden (mayEditVideoFiles).
    const viewer = await requireInternal();
    if (!viewer.permissions.has("videos:assign") && !isCoreStaff(viewer.email)) {
      throw new ForbiddenError(
        `Hiervoor is het recht "videos:assign" nodig. Vraag een beheerder om toegang.`,
      );
    }
    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    await db
      .update(deliverables)
      .set({
        editorId,
        // Zonder editor kan er niet geëdit worden; terug naar de wachtrij.
        status: editorId ? (video.status === "awaiting_editor" ? "editing" : video.status) : "awaiting_editor",
        statusChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deliverables.id, videoId));

    await auditLog({
      viewer,
      action: "video.editor_assigned",
      entityType: "deliverable",
      entityId: videoId,
      clientId: video.clientId,
      changes: { van: video.editorId, naar: editorId },
    });
    await recordActivity({
      clientId: video.clientId,
      type: "video.assigned",
      title: editorId ? `Editor toegewezen: ${video.title}` : `Editor losgekoppeld: ${video.title}`,
      entityType: "deliverable",
      entityId: videoId,
      actor: { id: viewer.id, fullName: viewer.fullName },
    });

    revalidatePath(`/videos/${videoId}`);
    revalidatePath("/videos");
    return { ok: true, message: editorId ? "Editor toegewezen." : "Editor losgekoppeld." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Deadline (klantlevering) handmatig zetten of wissen vanuit de lijst.
 *  Een handmatige datum wordt gemarkeerd als "manual" en niet meer automatisch
 *  overschreven door de opnamedatum-herberekening. */
export async function setVideoDeadline(videoId: string, dueOn: string | null): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { ok: false, message: "Ongeldige datum." };
    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    await db
      .update(deliverables)
      .set({ dueOn: dueOn ?? null, dueOnSource: dueOn ? "manual" : "auto", updatedAt: new Date() })
      .where(eq(deliverables.id, videoId));

    revalidatePath(`/videos/${videoId}`);
    revalidatePath("/videos");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const commentSchema = z.object({
  body: z.string().trim().min(1, "Schrijf eerst een opmerking.").max(4000),
  visibility: z.enum(["internal", "client"]),
  timecodeMs: z.number().int().nonnegative().nullable().optional(),
});

export async function addComment(
  videoId: string,
  input: { body: string; visibility: "internal" | "client"; timecodeMs?: number | null },
): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    const parsed = commentSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message };
    }

    const needed = parsed.data.visibility === "client" ? "comments:write_client" : "comments:write_internal";
    if (!viewer.permissions.has(needed)) {
      return { ok: false, message: "Je mag hier geen opmerking plaatsen." };
    }

    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    const [thread] = await db
      .insert(reviewThreads)
      .values({
        deliverableId: videoId,
        visibility: parsed.data.visibility,
        timecodeMs: parsed.data.timecodeMs ?? null,
      })
      .returning({ id: reviewThreads.id });

    await db.insert(reviewComments).values({
      threadId: thread!.id,
      body: parsed.data.body,
      authorUserId: viewer.id,
      authorName: viewer.fullName,
      source: "shortclips_os",
      timecodeMs: parsed.data.timecodeMs ?? null,
    });

    await recordActivity({
      clientId: video.clientId,
      type: "video.comment_added",
      title: `Feedback geplaatst op ${video.title}`,
      entityType: "deliverable",
      entityId: videoId,
      actor: { id: viewer.id, fullName: viewer.fullName },
      isClientVisible: parsed.data.visibility === "client",
    });

    revalidatePath(`/videos/${videoId}`);
    return { ok: true, message: "Opmerking geplaatst." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function resolveThread(threadId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("comments:write_internal");
    const [thread] = await db
      .select({ id: reviewThreads.id, deliverableId: reviewThreads.deliverableId, isResolved: reviewThreads.isResolved })
      .from(reviewThreads)
      .where(eq(reviewThreads.id, threadId))
      .limit(1);
    if (!thread) return { ok: false, message: "Feedbackdraad niet gevonden." };

    const video = await loadVideo(thread.deliverableId);
    if (!video) return { ok: false, message: "Video niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    await db
      .update(reviewThreads)
      .set({
        isResolved: !thread.isResolved,
        resolvedAt: thread.isResolved ? null : new Date(),
        resolvedById: thread.isResolved ? null : viewer.id,
      })
      .where(eq(reviewThreads.id, threadId));

    revalidatePath(`/videos/${thread.deliverableId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Editing-projecten van een klant — voor het koppelen van een briefing aan
 *  het project waar hij bij hoort. Nieuwste bovenaan. */
export async function listClientEditProjects(clientId: string): Promise<{
  ok: boolean;
  message?: string;
  projects: { id: string; title: string; statusLabel: string; hasBriefing: boolean; editorId: string | null; editorName: string | null }[];
}> {
  try {
    const viewer = await requirePermission("videos:write");
    if (!clientId) return { ok: false, message: "Geen klant.", projects: [] };
    assertClientAccess(viewer, clientId);
    const rows = await db
      .select({
        id: deliverables.id,
        title: deliverables.title,
        status: deliverables.status,
        briefing: deliverables.briefing,
        editorId: deliverables.editorId,
        editorName: users.fullName,
      })
      .from(deliverables)
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(eq(deliverables.clientId, clientId), isNull(deliverables.deletedAt)))
      .orderBy(desc(deliverables.statusChangedAt))
      .limit(60);
    return {
      ok: true,
      projects: rows.map((r) => ({
        id: r.id,
        title: r.title,
        statusLabel: VIDEO_STATUS[r.status]?.label ?? r.status,
        hasBriefing: !!(r.briefing && r.briefing.trim()),
        editorId: r.editorId,
        editorName: r.editorName,
      })),
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message, projects: [] };
    throw error;
  }
}

/** De editor van een project een berichtje sturen dat de briefing klaarstaat. */
export async function notifyEditorOfBriefing(videoId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    const video = await loadVideo(videoId);
    if (!video) return { ok: false, message: "Project niet gevonden." };
    assertClientAccess(viewer, video.clientId);
    if (!video.editorId) return { ok: false, message: "Dit project heeft nog geen editor." };
    await notify({
      userIds: [video.editorId],
      clientId: video.clientId,
      type: "briefing_ready",
      level: "info",
      title: `Nieuwe briefing klaar van ${viewer.fullName}`,
      body: `De editingbriefing voor "${video.title}" staat klaar op het project.`,
      href: `/videos/${videoId}`,
      entityType: "deliverable",
      entityId: videoId,
      dedupeKey: `briefing_ready:${videoId}`,
    });
    return { ok: true, message: "Editor is op de hoogte gebracht." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const briefingSchema = z.object({
  videoId: z.string().uuid(),
  briefing: z.string().trim().min(1, "Lege briefing.").max(8000),
});

/** De gegenereerde editingbriefing aan een project koppelen: hij verschijnt dan
 *  op de projectpagina en bij de editor — zo staat de briefing waar hij hoort. */
export async function attachBriefingToProject(input: { videoId: string; briefing: string }): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("videos:write");
    const p = briefingSchema.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Ongeldig." };
    const video = await loadVideo(p.data.videoId);
    if (!video) return { ok: false, message: "Project niet gevonden." };
    assertClientAccess(viewer, video.clientId);

    await db
      .update(deliverables)
      .set({ briefing: p.data.briefing, updatedAt: new Date() })
      .where(eq(deliverables.id, p.data.videoId));

    await auditLog({
      viewer,
      action: "video.briefing_attached",
      entityType: "deliverable",
      entityId: p.data.videoId,
      clientId: video.clientId,
    });
    await recordActivity({
      clientId: video.clientId,
      type: "video.briefing_attached",
      title: `Briefing gekoppeld: ${video.title}`,
      entityType: "deliverable",
      entityId: p.data.videoId,
      actor: { id: viewer.id, fullName: viewer.fullName },
    });

    revalidatePath(`/videos/${p.data.videoId}`);
    revalidatePath("/videos");
    return { ok: true, message: "Briefing gekoppeld aan het project." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
