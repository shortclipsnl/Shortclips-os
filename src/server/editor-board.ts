import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { inArray } from "drizzle-orm";
import { briefingSets, clients, deliverables, productionDays, users } from "@/db/schema";

// Tweede users-alias voor de vaste verantwoordelijke (coördinator) van de klant,
// zodat we die via één JOIN meenemen i.p.v. een subquery per rij (sneller board).
const coordUser = alias(users, "coord_user");
import { scopeToClients, type Viewer } from "@/server/auth/context";
import { subWorkingDays, workingDaysUntil } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { EDITOR_LEAD_DAYS, internalDeadline, isFirstVersionPending } from "@/lib/edit-deadline";
import { type EditPhase, type VideoStage } from "@/lib/statuses";
import type { EditorBriefing } from "@/server/actions/ai-tools";

export type BriefingStatus = "geen" | "bezig" | "klaar" | "bijgewerkt_script" | "mislukt";

// Volledig defensief: AI-gegenereerde briefings kunnen velden missen of een
// verkeerd type hebben. Nooit een harde crash (undefined.toLowerCase e.d.) die de
// hele Editing-pagina zou omleggen.
const normTitle = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const cleanLines = (arr: unknown): string[] =>
  (Array.isArray(arr) ? arr : []).map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean);
const cleanText = (s: unknown): string => (typeof s === "string" ? s.trim() : "");

/**
 * Bouwt de leesbare editor-briefingtekst voor één video uit de automatisch
 * gegenereerde briefing van de opname: de projectomschrijving + algemene
 * aandachtspunten, plus de specifieke punten van de short die bij deze video
 * hoort (gematcht op titel). Zo staat de briefing automatisch klaar in de kolom.
 * Fout-/leeg-bestendig: bij een rcommelige briefing geeft 'ie gewoon "" terug.
 */
function buildVideoBriefingText(content: EditorBriefing | null, videoTitle: string): string {
  if (!content || typeof content !== "object") return "";
  const intro = content.projectIntro;
  const shorts = Array.isArray(content.shorts) ? content.shorts : [];
  const vt = normTitle(videoTitle);
  const short =
    shorts.find((s) => s && normTitle(s.titel) === vt) ??
    (vt ? shorts.find((s) => s && (normTitle(s.titel).includes(vt) || vt.includes(normTitle(s.titel)))) : undefined) ??
    null;

  const parts: string[] = [];
  const omschrijving = cleanText(intro?.omschrijving);
  if (omschrijving) parts.push(omschrijving);
  const algemeen = cleanLines(intro?.algemeneAandachtspunten);
  if (algemeen.length) parts.push(`Algemene aandachtspunten:\n${algemeen.map((p) => `• ${p}`).join("\n")}`);
  if (short) {
    const titel = cleanText(short.titel);
    const block: string[] = [titel ? `Deze video — ${titel}` : "Deze video"];
    const so = cleanText(short.omschrijving);
    if (so) block.push(so);
    const punten = cleanLines(short.aandachtspunten);
    if (punten.length) block.push(punten.map((p) => `• ${p}`).join("\n"));
    parts.push(block.join("\n"));
  }
  return parts.join("\n\n").trim();
}

/**
 * Editing-board voor een editor, op basis van de video's (deliverables) die aan
 * hém zijn toegewezen — niet op basis van opnames. Veel video's komen binnen
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
  /** De vaste verantwoordelijke (coördinator) van de klant — voor de teamfilter,
   *  zodat Milou/Jiska/Jarno hun eigen klanten op het bord kunnen zien. */
  coordinatorId: string | null;
  coordinatorName: string | null;
  coordinatorAvatar: string | null;
  editorId: string | null;
  editorName: string | null;
  plannedShorts: number | null;
  /** Standaard aantal shorts voor deze klant (maandquota) — uit de portal. */
  clientDefaultShorts: number;
  dueOn: string | null;
  statusChangedAt: string;
  currentVersion: number;
  frameUrl: string | null;
  /** Handmatige briefing (override) — als die is ingevuld/aangepast. */
  briefing: string | null;
  /** Automatisch uit de script-PDF gegenereerde briefing voor deze video. */
  autoBriefing: string | null;
  /** Status van de automatische briefing van de opname. */
  briefingStatus: BriefingStatus;
  openComments: number;
  /** Link naar het script (interne scriptpagina, geüpload bestand of externe link). */
  scriptHref: string | null;
  /** Id van het geüploade script-pdf (van de opname), of null. */
  scriptFileId: string | null;
  /** Bestandsnaam van het geüploade script-pdf, voor de tooltip. */
  scriptFileName: string | null;
  /** Heeft deze video een gekoppelde opname(dag)? Zo niet, dan kan er geen script-pdf bij. */
  hasShoot: boolean;
  /** Echte opnamedatum uit de gekoppelde opnamedag (YYYY-MM-DD), of null als er
   *  geen betrouwbare opname gekoppeld is ("Opnamedatum nog niet bekend"). */
  opnameDate: string | null;
  /** Downloadlink naar het beeldmateriaal (opname-footage of Drive-map). */
  downloadHref: string | null;
  /** Werkdagen tot de KLANTdeadline (negatief = te laat). null als er geen deadline is. */
  workdaysToDeadline: number | null;
  overdue: boolean;
  /** Startdatum voor de batterij (opname = deadline − 14 werkdagen). */
  shootDate: string | null;
  elapsedWorkdays: number;
  totalWorkdays: number;
  batteryColor: "groen" | "blauw" | "oranje" | "rood";
  /* --- Editorperspectief: de INTERNE deadline (eerste versie = opname + 7
     werkdagen) i.p.v. de klantdeadline. Zo ziet de editor niet de ruime
     klantdatum maar zijn eigen, strakke deadline. Voor fases ná de eerste versie
     valt dit terug op de klantdeadline (de resterende tijd tot oplevering). --- */
  editorDueOn: string | null;
  editorWorkdaysToDeadline: number | null;
  editorElapsedWorkdays: number;
  editorTotalWorkdays: number;
  editorOverdue: boolean;
  editorBatteryColor: "groen" | "blauw" | "oranje" | "rood";
};

const TOTAL_WORKDAYS = 14; // opname → klantoplevering

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
      shootOn: deliverables.shootOn,
      briefing: deliverables.briefing,
      currentVersion: deliverables.currentVersion,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      coordinatorId: clients.coordinatorId,
      coordinatorName: coordUser.fullName,
      coordinatorAvatar: coordUser.avatarUrl,
      editorId: deliverables.editorId,
      editorName: users.fullName,
      plannedShorts: deliverables.plannedShorts,
      clientDefaultShorts: clients.monthlyVideoQuota,
      scriptId: deliverables.scriptId,
      scriptUrl: deliverables.scriptUrl,
      footageUrl: deliverables.footageUrl,
      driveFolderId: deliverables.driveFolderId,
      frameUrl: deliverables.frameUrl,
      // Beeldmateriaal- en scriptlink + opnamedatum van de gekoppelde opnamedag,
      // nu via één JOIN i.p.v. drie subqueries per rij (sneller board).
      dayFootageUrl: productionDays.footageUrl,
      dayScriptUrl: productionDays.scriptUrl,
      dayScriptFileId: sql<string | null>`(
        select f.id from edit_project_files f
        where f.production_day_id = deliverables.production_day_id and f.kind = 'script'
        order by f.created_at desc limit 1
      )`,
      dayScriptFileName: sql<string | null>`(
        select f.file_name from edit_project_files f
        where f.production_day_id = deliverables.production_day_id and f.kind = 'script'
        order by f.created_at desc limit 1
      )`,
      productionDayId: deliverables.productionDayId,
      // De ECHTE opnamedatum uit de gekoppelde opnamedag (nooit verzonnen): is er
      // geen gekoppelde opname, dan blijft dit null → "Opnamedatum nog niet bekend".
      dayScheduledOn: productionDays.scheduledOn,
      openComments: sql<number>`(
        select count(*) from review_threads rt
        where rt.deliverable_id = deliverables.id
          and rt.is_resolved = false and rt.deleted_at is null
      )`,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .leftJoin(users, eq(users.id, deliverables.editorId))
    .leftJoin(coordUser, eq(coordUser.id, clients.coordinatorId))
    .leftJoin(productionDays, eq(productionDays.id, deliverables.productionDayId))
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

  // Automatische editor-briefings van de betrokken opnames in bulk ophalen, zodat
  // elke video zijn briefing (uit de PDF) automatisch in de kolom krijgt.
  const dayIds = [...new Set(rows.map((r) => r.productionDayId).filter((x): x is string => !!x))];
  const briefingByDay = new Map<string, { content: EditorBriefing | null; status: BriefingStatus }>();
  if (dayIds.length) {
    try {
      const bsets = await db
        .select({ productionDayId: briefingSets.productionDayId, status: briefingSets.status, content: briefingSets.content })
        .from(briefingSets)
        .where(and(isNull(briefingSets.deletedAt), inArray(briefingSets.productionDayId, dayIds)));
      for (const b of bsets) {
        briefingByDay.set(b.productionDayId, {
          content: (b.content as unknown as EditorBriefing) ?? null,
          status: (b.status as BriefingStatus) ?? "geen",
        });
      }
    } catch {
      // Briefings zijn een extraatje in de kolom — nooit het hele bord laten vallen.
    }
  }

  return rows.map((r) => {
    const workdaysToDeadline = r.dueOn ? workingDaysUntil(today, r.dueOn, holidays) : null;
    const status = r.status as VideoStage;
    const phase = STATUS_TO_EDIT_PHASE[status] ?? "te_plannen";
    // Batterij: opname → oplevering. De opnamedatum is handmatig gezet (shootOn)
    // of synthetisch (deadline − 14 werkdagen). Zo lopen beide uiteinden mee met
    // wat op het board is ingevuld.
    const shootDate = r.shootOn ?? (r.dueOn ? subWorkingDays(r.dueOn, TOTAL_WORKDAYS, holidays) : null);
    const totalWorkdays =
      shootDate && r.dueOn ? Math.max(1, workingDaysUntil(shootDate, r.dueOn, holidays)) : TOTAL_WORKDAYS;
    const elapsedWorkdays = shootDate
      ? Math.max(0, Math.min(totalWorkdays, workingDaysUntil(shootDate, today, holidays)))
      : 0;
    const done = phase === "afgerond";
    const atEditor = status === "editing" || status === "editor_revision" || status === "client_revision";
    let batteryColor: "groen" | "blauw" | "oranje" | "rood";
    if (done) batteryColor = "groen";
    else if (workdaysToDeadline !== null && workdaysToDeadline < 0) batteryColor = "rood";
    else if (workdaysToDeadline !== null && workdaysToDeadline <= 2) batteryColor = "oranje";
    else if (atEditor) batteryColor = "blauw";
    else batteryColor = "groen";

    // Editorperspectief: interne deadline (opname + 7 wd) voor de eerste versie;
    // daarna de klantdeadline als resterende tijd tot oplevering.
    const firstVersion = isFirstVersionPending(status);
    const editorDueOn = firstVersion ? internalDeadline(r.shootOn, r.dueOn, holidays) : r.dueOn;
    const editorTotalWorkdays = firstVersion ? EDITOR_LEAD_DAYS : totalWorkdays;
    const editorWorkdaysToDeadline = editorDueOn ? workingDaysUntil(today, editorDueOn, holidays) : null;
    const editorElapsedWorkdays = shootDate
      ? Math.max(0, Math.min(editorTotalWorkdays, workingDaysUntil(shootDate, today, holidays)))
      : 0;
    const editorOverdue = !!editorDueOn && editorDueOn < today && firstVersion;
    let editorBatteryColor: "groen" | "blauw" | "oranje" | "rood";
    if (done) editorBatteryColor = "groen";
    else if (editorWorkdaysToDeadline !== null && editorWorkdaysToDeadline < 0) editorBatteryColor = "rood";
    else if (editorWorkdaysToDeadline !== null && editorWorkdaysToDeadline <= 2) editorBatteryColor = "oranje";
    else if (atEditor) editorBatteryColor = "blauw";
    else editorBatteryColor = "groen";
    // Script: interne scriptpagina > scriptlinkvan de video >
    // geüpload scriptbestand van de opname > externe scriptlink van de opname.
    const scriptHref = r.scriptId
      ? `/scripts/${r.scriptId}`
      : r.scriptUrl ||
        (r.dayScriptFileId ? `/api/edit-files/${r.dayScriptFileId}` : null) ||
        r.dayScriptUrl ||
        null;
    // Download: downloadlinkvan de video > footage van de opname >
    // Drive-map van de video.
    const downloadHref =
      r.footageUrl ||
      r.dayFootageUrl ||
      (r.driveFolderId ? `https://drive.google.com/drive/folders/${r.driveFolderId}` : null);
    return {
      id: r.id,
      title: r.title,
      status,
      phase,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      clientColor: r.clientColor,
      clientLogo: r.clientLogo,
      coordinatorId: r.coordinatorId ?? null,
      coordinatorName: r.coordinatorName ?? null,
      coordinatorAvatar: r.coordinatorAvatar ?? null,
      editorId: r.editorId,
      editorName: r.editorName,
      plannedShorts: r.plannedShorts === null ? null : Number(r.plannedShorts),
      clientDefaultShorts: Number(r.clientDefaultShorts ?? 0),
      dueOn: r.dueOn,
      statusChangedAt:
        typeof r.statusChangedAt === "string"
          ? r.statusChangedAt
          : (r.statusChangedAt as Date).toISOString(),
      currentVersion: Number(r.currentVersion ?? 0),
      frameUrl: r.frameUrl,
      briefing: r.briefing,
      autoBriefing: (() => {
        try {
          const b = r.productionDayId ? briefingByDay.get(r.productionDayId) : undefined;
          if (!b || b.status === "geen" || b.status === "mislukt") return null;
          const text = buildVideoBriefingText(b.content, r.title);
          return text || null;
        } catch {
          return null;
        }
      })(),
      briefingStatus: (r.productionDayId ? briefingByDay.get(r.productionDayId)?.status : undefined) ?? "geen",
      openComments: Number(r.openComments ?? 0),
      scriptHref,
      scriptFileId: r.dayScriptFileId,
      scriptFileName: r.dayScriptFileName,
      hasShoot: !!r.productionDayId,
      opnameDate: r.dayScheduledOn,
      downloadHref,
      workdaysToDeadline,
      overdue: !!r.dueOn && r.dueOn < today,
      shootDate,
      elapsedWorkdays,
      totalWorkdays,
      batteryColor,
      editorDueOn,
      editorWorkdaysToDeadline,
      editorElapsedWorkdays,
      editorTotalWorkdays,
      editorOverdue,
      editorBatteryColor,
    };
  });
}
