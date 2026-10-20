import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, users } from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";
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
  editorName: string | null;
  dueOn: string | null;
  statusChangedAt: string;
  currentVersion: number;
  frameUrl: string | null;
  briefing: string | null;
  openComments: number;
  /** Link naar het script (interne scriptpagina, geüpload bestand of externe link). */
  scriptHref: string | null;
  /** Downloadlink naar het beeldmateriaal (opname-footage of Drive-map). */
  downloadHref: string | null;
  /** Werkdagen tot de deadline (negatief = te laat). null als er geen deadline is. */
  workdaysToDeadline: number | null;
  overdue: boolean;
};

/**
 * @param opts.allEditors  true = alle editors (voor eigenaar/coördinator, met de
 *   editor per rij). Standaard alleen de eigen video's van de viewer.
 */
export async function listEditorBoard(
  viewer: Viewer,
  opts: { allEditors?: boolean } = {},
): Promise<EditorBoardVideo[]> {
  const holidays = nlHolidaySet();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

  // Eigen werk (editor) óf alle editors binnen de toegestane klanten (eigenaar).
  const scopeCond = opts.allEditors
    ? scopeToClients(viewer, deliverables.clientId)
    : eq(deliverables.editorId, viewer.id);

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
      editorName: users.fullName,
      scriptId: deliverables.scriptId,
      scriptUrl: deliverables.scriptUrl,
      footageUrl: deliverables.footageUrl,
      driveFolderId: deliverables.driveFolderId,
      frameUrl: deliverables.frameUrl,
      // Beeldmateriaal- en scriptlink van de gekoppelde opname (fallback):
      // daar zet de coördinator de downloadlink en het script ook neer.
      dayFootageUrl: sql<string | null>`(
        select pd.footage_url from production_days pd where pd.id = deliverables.production_day_id
      )`,
      dayScriptUrl: sql<string | null>`(
        select pd.script_url from production_days pd where pd.id = deliverables.production_day_id
      )`,
      dayScriptFileId: sql<string | null>`(
        select f.id from edit_project_files f
        where f.production_day_id = deliverables.production_day_id and f.kind = 'script'
        order by f.created_at desc limit 1
      )`,
      openComments: sql<number>`(
        select count(*) from review_threads rt
        where rt.deliverable_id = deliverables.id
          and rt.is_resolved = false and rt.deleted_at is null
      )`,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .leftJoin(users, eq(users.id, deliverables.editorId))
    .where(
      and(
        isNull(deliverables.deletedAt),
        scopeCond,
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
    // Actief werk eerst, afgeronde video's achteraan — anders kunnen oude
    // opleveringen (met een deadline in het verleden) het limiet opvullen en de
    // lopende opdrachten wegdrukken.
    .orderBy(
      sql`case when ${deliverables.status} in ('approved','ready_to_publish','scheduled','published','analysis_available') then 1 else 0 end`,
      asc(deliverables.dueOn),
      desc(deliverables.statusChangedAt),
    )
    .limit(400);

  return rows.map((r) => {
    const workdaysToDeadline = r.dueOn ? workingDaysUntil(today, r.dueOn, holidays) : null;
    // Script: interne scriptpagina > scriptlink van de video (Monday) >
    // geüpload scriptbestand van de opname > externe scriptlink van de opname.
    const scriptHref = r.scriptId
      ? `/scripts/${r.scriptId}`
      : r.scriptUrl ||
        (r.dayScriptFileId ? `/api/edit-files/${r.dayScriptFileId}` : null) ||
        r.dayScriptUrl ||
        null;
    // Download: downloadlink van de video (Monday) > footage van de opname >
    // Drive-map van de video.
    const downloadHref =
      r.footageUrl ||
      r.dayFootageUrl ||
      (r.driveFolderId ? `https://drive.google.com/drive/folders/${r.driveFolderId}` : null);
    return {
      id: r.id,
      title: r.title,
      status: r.status as VideoStage,
      phase: STATUS_TO_EDIT_PHASE[r.status as VideoStage] ?? "te_plannen",
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      clientColor: r.clientColor,
      clientLogo: r.clientLogo,
      editorName: r.editorName,
      dueOn: r.dueOn,
      statusChangedAt:
        typeof r.statusChangedAt === "string"
          ? r.statusChangedAt
          : (r.statusChangedAt as Date).toISOString(),
      currentVersion: Number(r.currentVersion ?? 0),
      frameUrl: r.frameUrl,
      briefing: r.briefing,
      openComments: Number(r.openComments ?? 0),
      scriptHref,
      downloadHref,
      workdaysToDeadline,
      overdue: !!r.dueOn && r.dueOn < today,
    };
  });
}
