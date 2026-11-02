import "server-only";
import { and, asc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { captionItems, captionSets, clients, productionDays, shootScriptSources, users } from "@/db/schema";
import { assertClientAccess, scopeToClients, type Viewer } from "@/server/auth/context";
import { shootHasReviewPdf } from "@/server/captions/generate";

const today = () => new Date().toISOString().slice(0, 10);

/** Afgeleide status voor de lijst — breder dan de set-status (dekt ook "geen
 *  PDF" en "wacht op generatie"). */
export type CaptionListStatus =
  | "pdf_ontbreekt"
  | "wacht"
  | "bezig"
  | "klaar_controle"
  | "gedeeltelijk"
  | "bijgewerkt_script"
  | "gecontroleerd"
  | "mislukt";

export type ShootCaptionRow = {
  productionDayId: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  scheduledOn: string;
  title: string;
  scriptCount: number;
  captionCount: number;
  hasPdf: boolean;
  status: CaptionListStatus;
  generatedAt: string | null;
  /** Automatische Drive-koppeling: "gekoppeld" (bron), "suggestie" (wacht op
   *  bevestiging) of null. Met de bestandsnaam en reden voor het team. */
  driveStatus: "gekoppeld" | "suggestie" | "afgewezen" | null;
  driveFileName: string | null;
  driveReason: string | null;
};

export type CaptionOverview = {
  rows: ShootCaptionRow[];
  stats: { komend: number; klaar: number; teGenereren: number; gecontroleerd: number };
};

/**
 * Aankomende opnames met hun caption-status voor het overzicht bovenaan de
 * Caption Maker. Hard gescoopt op de klanttoegang van de medewerker.
 */
export async function listShootCaptionOverview(
  viewer: Viewer,
  filters: { search?: string; status?: CaptionListStatus | "alle"; from?: string; to?: string } = {},
): Promise<CaptionOverview> {
  const rowsRaw = await db
    .select({
      productionDayId: productionDays.id,
      clientId: productionDays.clientId,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      scheduledOn: productionDays.scheduledOn,
      title: productionDays.title,
      setStatus: captionSets.status,
      generatedAt: captionSets.generatedAt,
      scriptCount: sql<number>`(select count(*)::int from scripts sc where sc.production_day_id = production_days.id and sc.deleted_at is null)`,
      captionCount: sql<number>`(select count(*)::int from caption_items ci where ci.caption_set_id = caption_sets.id)`,
      driveStatus: shootScriptSources.status,
      driveFileName: shootScriptSources.fileName,
      driveReason: shootScriptSources.matchReason,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(captionSets, and(eq(captionSets.productionDayId, productionDays.id), isNull(captionSets.deletedAt)))
    .leftJoin(shootScriptSources, eq(shootScriptSources.productionDayId, productionDays.id))
    .where(
      and(
        isNull(productionDays.deletedAt),
        ne(productionDays.status, "cancelled"),
        gte(productionDays.scheduledOn, filters.from ?? today()),
        filters.to ? lte(productionDays.scheduledOn, filters.to) : sql`true`,
        scopeToClients(viewer, productionDays.clientId) ?? sql`true`,
      ),
    )
    .orderBy(asc(productionDays.scheduledOn))
    .limit(300);

  const withPdf = await shootHasReviewPdf(rowsRaw.map((r) => r.productionDayId));

  let rows: ShootCaptionRow[] = rowsRaw.map((r) => {
    const hasPdf = withPdf.has(r.productionDayId);
    const status: CaptionListStatus = r.setStatus
      ? (r.setStatus as CaptionListStatus)
      : hasPdf
        ? "wacht"
        : "pdf_ontbreekt";
    return {
      productionDayId: r.productionDayId,
      clientId: r.clientId,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      clientColor: r.clientColor ?? null,
      clientLogo: r.clientLogo ?? null,
      scheduledOn: r.scheduledOn,
      title: r.title,
      scriptCount: Number(r.scriptCount ?? 0),
      captionCount: Number(r.captionCount ?? 0),
      hasPdf,
      status,
      generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
      driveStatus: (r.driveStatus as ShootCaptionRow["driveStatus"]) ?? null,
      driveFileName: r.driveFileName ?? null,
      driveReason: r.driveReason ?? null,
    };
  });

  // Zoeken (klantnaam/titel) en status-filter in JS — lijst is begrensd.
  const q = filters.search?.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.clientName.toLowerCase().includes(q) || r.title.toLowerCase().includes(q));
  if (filters.status && filters.status !== "alle") rows = rows.filter((r) => r.status === filters.status);

  const stats = {
    komend: rows.length,
    klaar: rows.filter((r) => r.status === "klaar_controle" || r.status === "bijgewerkt_script").length,
    teGenereren: rows.filter((r) => r.status === "wacht" || r.status === "mislukt" || r.status === "bezig").length,
    gecontroleerd: rows.filter((r) => r.status === "gecontroleerd").length,
  };
  return { rows, stats };
}

export type CaptionItem = {
  id: string;
  position: number;
  shortTitle: string;
  hook: string;
  caption: string;
  hashtags: string[];
  status: "gegenereerd" | "bewerkt";
  isEdited: boolean;
  staleFromNewVersion: boolean;
};

export type ShootCaptionsDetail = {
  productionDayId: string;
  clientId: string;
  clientName: string;
  scheduledOn: string;
  title: string;
  hasPdf: boolean;
  set: {
    id: string;
    status: CaptionListStatus;
    generatedAt: string | null;
    errorMessage: string | null;
    checkedByName: string | null;
    checkedAt: string | null;
  } | null;
  items: CaptionItem[];
};

/** Eén opname met al zijn captions (voor "Bekijk captions"). */
export async function getShootCaptions(viewer: Viewer, productionDayId: string): Promise<ShootCaptionsDetail | null> {
  const [day] = await db
    .select({
      id: productionDays.id,
      clientId: productionDays.clientId,
      clientName: clients.name,
      scheduledOn: productionDays.scheduledOn,
      title: productionDays.title,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
    .limit(1);
  if (!day) return null;
  assertClientAccess(viewer, day.clientId);

  const [set] = await db
    .select({
      id: captionSets.id,
      status: captionSets.status,
      generatedAt: captionSets.generatedAt,
      errorMessage: captionSets.errorMessage,
      checkedByName: users.fullName,
      checkedAt: captionSets.checkedAt,
    })
    .from(captionSets)
    .leftJoin(users, eq(users.id, captionSets.checkedById))
    .where(and(eq(captionSets.productionDayId, productionDayId), isNull(captionSets.deletedAt)))
    .limit(1);

  const items = set
    ? await db
        .select()
        .from(captionItems)
        .where(eq(captionItems.captionSetId, set.id))
        .orderBy(asc(captionItems.position))
    : [];

  const withPdf = await shootHasReviewPdf([productionDayId]);

  return {
    productionDayId,
    clientId: day.clientId,
    clientName: day.clientName,
    scheduledOn: day.scheduledOn,
    title: day.title,
    hasPdf: withPdf.has(productionDayId),
    set: set
      ? {
          id: set.id,
          status: set.status as CaptionListStatus,
          generatedAt: set.generatedAt ? set.generatedAt.toISOString() : null,
          errorMessage: set.errorMessage ?? null,
          checkedByName: set.checkedByName ?? null,
          checkedAt: set.checkedAt ? set.checkedAt.toISOString() : null,
        }
      : null,
    items: items.map((it) => ({
      id: it.id,
      position: it.position,
      shortTitle: it.shortTitle,
      hook: it.hook,
      caption: it.caption,
      hashtags: Array.isArray(it.hashtags) ? (it.hashtags as string[]) : [],
      status: it.status as "gegenereerd" | "bewerkt",
      isEdited: it.isEdited,
      staleFromNewVersion: it.staleFromNewVersion,
    })),
  };
}
