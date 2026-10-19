import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { workingDaysUntil } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { type EditPhase, type VideoStage } from "@/lib/statuses";

/**
 * Editing-board voor een editor, op basis van de video's (deliverables) die aan
 * hém zijn toegewezen — niet op basis van opnames. Veel video's komen via Monday
 * binnen zonder opname, dus het opname-board (editing-board.ts) laat die niet
 * zien. Dit board toont de editor exact zijn eigen werk, gegroepeerd per fase.
 */

/** Videostatus → editingfase (zelfde indeling als het opname-board). */
const STATUS_TO_EDIT_PHASE: Record<VideoStage, EditPhase> = {
  recorded: "te_plannen",
  footage_upload: "te_plannen",
  awaiting_editor: "te_plannen",
  editing: "in_edit",
  editor_revision: "in_edit",
  internal_review: "interne_controle",
  client_review: "bij_klant",
  client_revision: "feedback_verwerken",
  approved: "afgerond",
  ready_to_publish: "afgerond",
  scheduled: "afgerond",
  published: "afgerond",
  analysis_available: "afgerond",
};

export type EditorBoardVideo = {
  id: string;
  title: string;
  status: VideoStage;
  phase: EditPhase;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  dueOn: string | null;
  statusChangedAt: string;
  currentVersion: number;
  scriptId: string | null;
  driveFolderId: string | null;
  frameUrl: string | null;
  briefing: string | null;
  openComments: number;
  /** Werkdagen tot de deadline (negatief = te laat). null als er geen deadline is. */
  workdaysToDeadline: number | null;
  overdue: boolean;
};

export async function listEditorBoard(viewer: Viewer): Promise<EditorBoardVideo[]> {
  const holidays = nlHolidaySet();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

  const rows = await db
    .select({
      id: deliverables.id,
      title: deliverables.title,
      status: deliverables.status,
      statusChangedAt: deliverables.statusChangedAt,
      dueOn: deliverables.dueOn,
      briefing: deliverables.briefing,
      currentVersion: deliverables.currentVersion,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      scriptId: deliverables.scriptId,
      driveFolderId: deliverables.driveFolderId,
      frameUrl: deliverables.frameUrl,
      openComments: sql<number>`(
        select count(*) from review_threads rt
        where rt.deliverable_id = deliverables.id
          and rt.is_resolved = false and rt.deleted_at is null
      )`,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .where(
      and(
        isNull(deliverables.deletedAt),
        eq(deliverables.editorId, viewer.id),
        // Actief werk altijd; afgeronde video's alleen de laatste 45 dagen, zodat
        // het board niet eindeloos volloopt met oude opleveringen.
        sql`(
          ${deliverables.status} in ('recorded','footage_upload','awaiting_editor','editing','editor_revision','internal_review','client_review','client_revision')
          or (
            ${deliverables.status} in ('approved','ready_to_publish','scheduled','published','analysis_available')
            and ${deliverables.statusChangedAt} > now() - interval '45 days'
          )
        )`,
      ),
    )
    .orderBy(asc(deliverables.dueOn), desc(deliverables.statusChangedAt))
    .limit(300);

  return rows.map((r) => {
    const workdaysToDeadline = r.dueOn ? workingDaysUntil(today, r.dueOn, holidays) : null;
    return {
      id: r.id,
      title: r.title,
      status: r.status as VideoStage,
      phase: STATUS_TO_EDIT_PHASE[r.status as VideoStage] ?? "te_plannen",
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      clientColor: r.clientColor,
      clientLogo: r.clientLogo,
      dueOn: r.dueOn,
      statusChangedAt:
        typeof r.statusChangedAt === "string"
          ? r.statusChangedAt
          : (r.statusChangedAt as Date).toISOString(),
      currentVersion: Number(r.currentVersion ?? 0),
      scriptId: r.scriptId,
      driveFolderId: r.driveFolderId,
      frameUrl: r.frameUrl,
      briefing: r.briefing,
      openComments: Number(r.openComments ?? 0),
      workdaysToDeadline,
      overdue: !!r.dueOn && r.dueOn < today,
    };
  });
}
