import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, productionDays, scriptReviewComments, scriptReviewThreads, scriptReviewVersions, scriptReviews, users } from "@/db/schema";
import { assertClientAccess, scopeToClients, type Viewer } from "@/server/auth/context";

/**
 * Lees-laag voor de script-PDF-reviews (klantportaal + intern). Klantqueries
 * filteren hard op viewer.clientId; interne queries op de klant-scope van de
 * medewerker. Interne opmerkingen (visibility != 'client') komen nooit in de
 * klant-queries voorbij.
 */

export type ScriptReviewStatus =
  | "klaar_controle" | "feedback_gegeven" | "wordt_aangepast" | "opnieuw_controle" | "goedgekeurd";

/** De klant moet iets doen bij deze statussen (actie vereist). */
export const CLIENT_ACTION_STATUSES: ScriptReviewStatus[] = ["klaar_controle", "opnieuw_controle"];

export const SCRIPT_REVIEW_STATUS: Record<ScriptReviewStatus, { label: string; tone: "warn" | "info" | "good" | "neutral"; actie: "klant" | "shortclips" | "klaar" }> = {
  klaar_controle:   { label: "Klaar voor controle", tone: "warn", actie: "klant" },
  feedback_gegeven: { label: "Feedback gegeven",     tone: "info", actie: "shortclips" },
  wordt_aangepast:  { label: "Wordt aangepast",      tone: "info", actie: "shortclips" },
  opnieuw_controle: { label: "Opnieuw ter controle", tone: "warn", actie: "klant" },
  goedgekeurd:      { label: "Goedgekeurd",          tone: "good", actie: "klaar" },
};

export type PortalReviewListItem = {
  id: string;
  productionDayId: string;
  title: string;
  status: ScriptReviewStatus;
  currentVersion: number;
  currentVersionId: string | null;
  shootOn: string | null;
  shootTime: string | null;
  shootLocation: string | null;
  feedbackDeadline: string | null;
  openComments: number;
  approvedAt: string | null;
};

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

/** Huidige-versie-id + open klantopmerkingen per review (voor lijstweergave). */
async function enrich(reviewIds: string[]): Promise<Map<string, { versionId: string | null; openComments: number }>> {
  const map = new Map<string, { versionId: string | null; openComments: number }>();
  if (reviewIds.length === 0) return map;
  const [versionRows, commentRows] = await Promise.all([
    db.select({ reviewId: scriptReviewVersions.reviewId, id: scriptReviewVersions.id, v: scriptReviewVersions.versionNumber })
      .from(scriptReviewVersions)
      .where(inArray(scriptReviewVersions.reviewId, reviewIds)),
    db.select({ reviewId: scriptReviewThreads.reviewId, n: sql<number>`count(*)` })
      .from(scriptReviewThreads)
      .where(and(inArray(scriptReviewThreads.reviewId, reviewIds), eq(scriptReviewThreads.visibility, "client"), isNull(scriptReviewThreads.deletedAt)))
      .groupBy(scriptReviewThreads.reviewId),
  ]);
  const latest = new Map<string, { id: string; v: number }>();
  for (const r of versionRows) {
    const cur = latest.get(r.reviewId);
    if (!cur || r.v > cur.v) latest.set(r.reviewId, { id: r.id, v: r.v });
  }
  const comments = new Map(commentRows.map((c) => [c.reviewId, Number(c.n)]));
  for (const id of reviewIds) map.set(id, { versionId: latest.get(id)?.id ?? null, openComments: comments.get(id) ?? 0 });
  return map;
}

/** Alle reviews van de ingelogde klant — actie-vereist eerst, dan nieuwste. */
export async function listPortalScriptReviews(viewer: Viewer): Promise<PortalReviewListItem[]> {
  const clientId = viewer.clientId;
  if (!clientId) return [];
  const base = await db
    .select({
      id: scriptReviews.id,
      productionDayId: scriptReviews.productionDayId,
      title: scriptReviews.title,
      status: scriptReviews.status,
      currentVersion: scriptReviews.currentVersion,
      feedbackDeadline: scriptReviews.feedbackDeadline,
      approvedAt: scriptReviews.approvedAt,
      shootOn: productionDays.scheduledOn,
      shootTime: productionDays.startTime,
      shootLocation: productionDays.locationName,
      createdAt: scriptReviews.createdAt,
    })
    .from(scriptReviews)
    .innerJoin(productionDays, eq(productionDays.id, scriptReviews.productionDayId))
    .where(and(eq(scriptReviews.clientId, clientId), isNull(scriptReviews.deletedAt)))
    .orderBy(desc(scriptReviews.createdAt));

  const extra = await enrich(base.map((r) => r.id));
  const items: PortalReviewListItem[] = base.map((r) => ({
    id: r.id,
    productionDayId: r.productionDayId,
    title: r.title,
    status: r.status as ScriptReviewStatus,
    currentVersion: r.currentVersion,
    currentVersionId: extra.get(r.id)?.versionId ?? null,
    shootOn: r.shootOn ?? null,
    shootTime: r.shootTime ?? null,
    shootLocation: r.shootLocation ?? null,
    feedbackDeadline: r.feedbackDeadline ? r.feedbackDeadline.toISOString() : null,
    openComments: extra.get(r.id)?.openComments ?? 0,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
  }));
  // Actie-vereist eerst.
  const order = (s: ScriptReviewStatus) => (CLIENT_ACTION_STATUSES.includes(s) ? 0 : s === "goedgekeurd" ? 2 : 1);
  items.sort((a, b) => order(a.status) - order(b.status));
  return items;
}

export type PortalReviewDetail = {
  id: string;
  title: string;
  status: ScriptReviewStatus;
  currentVersion: number;
  currentVersionId: string | null;
  shootOn: string | null;
  shootTime: string | null;
  shootLocation: string | null;
  feedbackDeadline: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  threads: Array<{
    id: string;
    versionNumber: number;
    pageNumber: number | null;
    posX: number | null;
    posY: number | null;
    isResolved: boolean;
    createdAt: string;
    authorName: string | null;
    comments: Array<{ id: string; body: string; authorName: string | null; createdAt: string }>;
  }>;
};

/** Eén review met de huidige PDF-versie en de klant-zichtbare opmerkingen. */
export async function getPortalScriptReview(viewer: Viewer, reviewId: string): Promise<PortalReviewDetail | null> {
  const clientId = viewer.clientId;
  if (!clientId) return null;
  const [r] = await db
    .select({
      id: scriptReviews.id,
      title: scriptReviews.title,
      status: scriptReviews.status,
      currentVersion: scriptReviews.currentVersion,
      feedbackDeadline: scriptReviews.feedbackDeadline,
      approvedAt: scriptReviews.approvedAt,
      approvedByName: users.fullName,
      shootOn: productionDays.scheduledOn,
      shootTime: productionDays.startTime,
      shootLocation: productionDays.locationName,
    })
    .from(scriptReviews)
    .innerJoin(productionDays, eq(productionDays.id, scriptReviews.productionDayId))
    .leftJoin(users, eq(users.id, scriptReviews.approvedById))
    .where(and(eq(scriptReviews.id, reviewId), eq(scriptReviews.clientId, clientId), isNull(scriptReviews.deletedAt)))
    .limit(1);
  if (!r) return null;

  const [version] = await db
    .select({ id: scriptReviewVersions.id })
    .from(scriptReviewVersions)
    .where(eq(scriptReviewVersions.reviewId, reviewId))
    .orderBy(desc(scriptReviewVersions.versionNumber))
    .limit(1);

  const threadRows = await db
    .select()
    .from(scriptReviewThreads)
    .where(and(eq(scriptReviewThreads.reviewId, reviewId), eq(scriptReviewThreads.visibility, "client"), isNull(scriptReviewThreads.deletedAt)))
    .orderBy(asc(scriptReviewThreads.createdAt));
  const commentRows = threadRows.length
    ? await db
        .select({ id: scriptReviewComments.id, threadId: scriptReviewComments.threadId, body: scriptReviewComments.body, authorName: scriptReviewComments.authorName, createdAt: scriptReviewComments.createdAt })
        .from(scriptReviewComments)
        // Klant ziet geen interne reacties.
        .where(and(inArray(scriptReviewComments.threadId, threadRows.map((t) => t.id)), eq(scriptReviewComments.isInternal, false)))
        .orderBy(asc(scriptReviewComments.createdAt))
    : [];

  return {
    id: r.id,
    title: r.title,
    status: r.status as ScriptReviewStatus,
    currentVersion: r.currentVersion,
    currentVersionId: version?.id ?? null,
    shootOn: r.shootOn ?? null,
    shootTime: r.shootTime ?? null,
    shootLocation: r.shootLocation ?? null,
    feedbackDeadline: r.feedbackDeadline ? r.feedbackDeadline.toISOString() : null,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    approvedByName: r.approvedByName ?? null,
    threads: threadRows.map((t) => ({
      id: t.id,
      versionNumber: t.versionNumber,
      pageNumber: t.pageNumber ?? null,
      posX: t.posX != null ? Number(t.posX) : null,
      posY: t.posY != null ? Number(t.posY) : null,
      isResolved: t.isResolved,
      createdAt: t.createdAt.toISOString(),
      authorName: t.authorName ?? null,
      comments: commentRows.filter((c) => c.threadId === t.id).map((c) => ({ id: c.id, body: c.body, authorName: c.authorName ?? null, createdAt: c.createdAt.toISOString() })),
    })),
  };
}

/** PDF-bytes van één versie — klant-veilig (toegang via de klant van de review). */
export async function getScriptPdfVersion(versionId: string): Promise<{ fileName: string; contentType: string; dataBase64: string; clientId: string } | null> {
  const [row] = await db
    .select({
      fileName: scriptReviewVersions.fileName,
      contentType: scriptReviewVersions.contentType,
      dataBase64: scriptReviewVersions.dataBase64,
      clientId: scriptReviews.clientId,
    })
    .from(scriptReviewVersions)
    .innerJoin(scriptReviews, eq(scriptReviews.id, scriptReviewVersions.reviewId))
    .where(eq(scriptReviewVersions.id, versionId))
    .limit(1);
  return row ?? null;
}

/* ----------------------------------------------------------- intern */

export type ClientWithSessions = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  color: string | null;
  sessions: Array<{ id: string; scheduledOn: string; title: string | null; locationName: string | null; hasReview: boolean }>;
};

/** Actieve klanten (gescoopt) met hun komende opnamesessies — voor het
 *  "Versturen ter controle"-formulier. */
export async function listClientsWithSessions(viewer: Viewer): Promise<ClientWithSessions[]> {
  const today = new Date().toISOString().slice(0, 10);
  const clientRows = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug, logoUrl: clients.logoUrl, color: clients.color })
    .from(clients)
    .where(and(isNull(clients.deletedAt), eq(clients.status, "active"), scopeToClients(viewer, clients.id) ?? sql`true`))
    .orderBy(asc(clients.name));
  if (clientRows.length === 0) return [];

  const ids = clientRows.map((c) => c.id);
  const sessionRows = await db
    .select({ id: productionDays.id, clientId: productionDays.clientId, scheduledOn: productionDays.scheduledOn, title: productionDays.title, locationName: productionDays.locationName })
    .from(productionDays)
    .where(and(inArray(productionDays.clientId, ids), isNull(productionDays.deletedAt), sql`${productionDays.scheduledOn} >= ${today}`))
    .orderBy(asc(productionDays.scheduledOn));
  const reviewRows = await db
    .select({ productionDayId: scriptReviews.productionDayId })
    .from(scriptReviews)
    .where(and(inArray(scriptReviews.clientId, ids), isNull(scriptReviews.deletedAt)));
  const withReview = new Set(reviewRows.map((r) => r.productionDayId));

  return clientRows.map((c) => ({
    ...c,
    sessions: sessionRows
      .filter((s) => s.clientId === c.id)
      .map((s) => ({ id: s.id, scheduledOn: s.scheduledOn, title: s.title ?? null, locationName: s.locationName ?? null, hasReview: withReview.has(s.id) })),
  }));
}

export type InternalReviewItem = {
  id: string;
  title: string;
  clientName: string;
  clientSlug: string;
  status: ScriptReviewStatus;
  currentVersion: number;
  shootOn: string | null;
  openComments: number;
  updatedAt: string;
};

/** Alle reviews die de medewerker mag zien (klant-scope), nieuwste eerst. */
export async function listInternalScriptReviews(viewer: Viewer): Promise<InternalReviewItem[]> {
  const base = await db
    .select({
      id: scriptReviews.id,
      title: scriptReviews.title,
      status: scriptReviews.status,
      currentVersion: scriptReviews.currentVersion,
      updatedAt: scriptReviews.updatedAt,
      clientName: clients.name,
      clientSlug: clients.slug,
      shootOn: productionDays.scheduledOn,
    })
    .from(scriptReviews)
    .innerJoin(clients, eq(clients.id, scriptReviews.clientId))
    .innerJoin(productionDays, eq(productionDays.id, scriptReviews.productionDayId))
    .where(and(isNull(scriptReviews.deletedAt), scopeToClients(viewer, scriptReviews.clientId) ?? sql`true`))
    .orderBy(desc(scriptReviews.updatedAt))
    .limit(100);

  const extra = await enrich(base.map((r) => r.id));
  return base.map((r) => ({
    id: r.id,
    title: r.title,
    clientName: r.clientName,
    clientSlug: r.clientSlug,
    status: r.status as ScriptReviewStatus,
    currentVersion: r.currentVersion,
    shootOn: r.shootOn ?? null,
    openComments: extra.get(r.id)?.openComments ?? 0,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export type InternalReviewDetail = {
  id: string;
  title: string;
  status: ScriptReviewStatus;
  clientId: string;
  clientName: string;
  clientSlug: string;
  currentVersion: number;
  currentVersionId: string | null;
  shootOn: string | null;
  shootTime: string | null;
  shootLocation: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  approvedVersion: number | null;
  versions: Array<{ id: string; versionNumber: number; fileName: string; note: string | null; createdAt: string }>;
  threads: Array<{
    id: string;
    versionNumber: number;
    pageNumber: number | null;
    posX: number | null;
    posY: number | null;
    visibility: string;
    isResolved: boolean;
    authorName: string | null;
    createdAt: string;
    comments: Array<{ id: string; body: string; authorName: string | null; isInternal: boolean; createdAt: string }>;
  }>;
};

/** Volledige review voor het interne portaal (alle versies + alle opmerkingen). */
export async function getInternalScriptReview(viewer: Viewer, reviewId: string): Promise<InternalReviewDetail | null> {
  const [r] = await db
    .select({
      id: scriptReviews.id,
      title: scriptReviews.title,
      status: scriptReviews.status,
      clientId: scriptReviews.clientId,
      currentVersion: scriptReviews.currentVersion,
      approvedAt: scriptReviews.approvedAt,
      approvedByName: users.fullName,
      approvedVersion: scriptReviews.approvedVersion,
      clientName: clients.name,
      clientSlug: clients.slug,
      shootOn: productionDays.scheduledOn,
      shootTime: productionDays.startTime,
      shootLocation: productionDays.locationName,
    })
    .from(scriptReviews)
    .innerJoin(clients, eq(clients.id, scriptReviews.clientId))
    .innerJoin(productionDays, eq(productionDays.id, scriptReviews.productionDayId))
    .leftJoin(users, eq(users.id, scriptReviews.approvedById))
    .where(and(eq(scriptReviews.id, reviewId), isNull(scriptReviews.deletedAt)))
    .limit(1);
  if (!r) return null;
  assertClientAccess(viewer, r.clientId);

  const versions = await db
    .select({ id: scriptReviewVersions.id, versionNumber: scriptReviewVersions.versionNumber, fileName: scriptReviewVersions.fileName, note: scriptReviewVersions.note, createdAt: scriptReviewVersions.createdAt })
    .from(scriptReviewVersions)
    .where(eq(scriptReviewVersions.reviewId, reviewId))
    .orderBy(desc(scriptReviewVersions.versionNumber));

  const threadRows = await db
    .select()
    .from(scriptReviewThreads)
    .where(and(eq(scriptReviewThreads.reviewId, reviewId), isNull(scriptReviewThreads.deletedAt)))
    .orderBy(asc(scriptReviewThreads.createdAt));
  const commentRows = threadRows.length
    ? await db
        .select({ id: scriptReviewComments.id, threadId: scriptReviewComments.threadId, body: scriptReviewComments.body, authorName: scriptReviewComments.authorName, isInternal: scriptReviewComments.isInternal, createdAt: scriptReviewComments.createdAt })
        .from(scriptReviewComments)
        .where(inArray(scriptReviewComments.threadId, threadRows.map((t) => t.id)))
        .orderBy(asc(scriptReviewComments.createdAt))
    : [];

  return {
    id: r.id,
    title: r.title,
    status: r.status as ScriptReviewStatus,
    clientId: r.clientId,
    clientName: r.clientName,
    clientSlug: r.clientSlug,
    currentVersion: r.currentVersion,
    currentVersionId: versions[0]?.id ?? null,
    shootOn: r.shootOn ?? null,
    shootTime: r.shootTime ?? null,
    shootLocation: r.shootLocation ?? null,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    approvedByName: r.approvedByName ?? null,
    approvedVersion: r.approvedVersion ?? null,
    versions: versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, fileName: v.fileName, note: v.note ?? null, createdAt: v.createdAt.toISOString() })),
    threads: threadRows.map((t) => ({
      id: t.id,
      versionNumber: t.versionNumber,
      pageNumber: t.pageNumber ?? null,
      posX: t.posX != null ? Number(t.posX) : null,
      posY: t.posY != null ? Number(t.posY) : null,
      visibility: t.visibility,
      isResolved: t.isResolved,
      authorName: t.authorName ?? null,
      createdAt: t.createdAt.toISOString(),
      comments: commentRows.filter((c) => c.threadId === t.id).map((c) => ({ id: c.id, body: c.body, authorName: c.authorName ?? null, isInternal: c.isInternal, createdAt: c.createdAt.toISOString() })),
    })),
  };
}

/** Controleert of de medewerker bij deze review mag (klant-scope). */
export async function assertReviewAccess(viewer: Viewer, reviewId: string): Promise<{ id: string; clientId: string; productionDayId: string; currentVersion: number } | null> {
  const [r] = await db
    .select({ id: scriptReviews.id, clientId: scriptReviews.clientId, productionDayId: scriptReviews.productionDayId, currentVersion: scriptReviews.currentVersion })
    .from(scriptReviews)
    .where(and(eq(scriptReviews.id, reviewId), isNull(scriptReviews.deletedAt)))
    .limit(1);
  if (!r) return null;
  assertClientAccess(viewer, r.clientId);
  return r;
}
