import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, draaiboekNotes, draaiboeken, productionDays, users } from "@/db/schema";
import { assertClientAccess, ForbiddenError, isEditorRole, type Viewer } from "@/server/auth/context";
import { isCoreStaff } from "@/server/core-staff";
import { todayAmsterdam } from "@/lib/planning-deadline";
import { isDraaiboekContent, sessionProgress, type DraaiboekContent, type DraaiboekProgress, type DraaiboekStatus } from "./types";

/** Team Shortclips mag draaiboeken genereren, controleren en versturen. Videografen en editors niet. */
export function canManageDraaiboek(viewer: Viewer | null): boolean {
  if (!viewer || viewer.isPortalUser || isEditorRole(viewer)) return false;
  if (viewer.primaryRole === "videographer" && !isCoreStaff(viewer.email)) return false;
  return viewer.permissions.has("scripts:write") || isCoreStaff(viewer.email);
}

export function assertCanManageDraaiboek(viewer: Viewer): void {
  if (!canManageDraaiboek(viewer)) throw new ForbiddenError("Draaiboeken worden gecontroleerd en verstuurd door Team Shortclips.");
}

export type DraaiboekSummary = {
  productionDayId: string;
  status: DraaiboekStatus;
  sentToName: string | null;
  sentAt: string | null;
  pct: number;
};

/** Draaiboekstatus per opname, voor de scriptingpagina. */
export async function draaiboekStatusMap(productionDayIds: string[]): Promise<Record<string, DraaiboekSummary>> {
  if (productionDayIds.length === 0) return {};
  const rows = await db
    .select({
      productionDayId: draaiboeken.productionDayId,
      status: draaiboeken.status,
      sentAt: draaiboeken.sentAt,
      sentToName: users.fullName,
      content: draaiboeken.content,
      progress: draaiboeken.progress,
    })
    .from(draaiboeken)
    .leftJoin(users, eq(users.id, draaiboeken.sentToId))
    .where(and(inArray(draaiboeken.productionDayId, productionDayIds), isNull(draaiboeken.deletedAt)));
  const out: Record<string, DraaiboekSummary> = {};
  for (const r of rows) {
    const pct = isDraaiboekContent(r.content) ? sessionProgress(r.content, (r.progress ?? {}) as DraaiboekProgress).pct : 0;
    out[r.productionDayId] = {
      productionDayId: r.productionDayId,
      status: r.status as DraaiboekStatus,
      sentToName: r.sentToName ?? null,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      pct,
    };
  }
  return out;
}

export type DraaiboekDay = {
  id: string;
  clientId: string;
  clientName: string;
  clientLogo: string | null;
  clientColor: string | null;
  title: string;
  scheduledOn: string;
  startTime: string | null;
  endTime: string | null;
  locationName: string | null;
  locationAddress: string | null;
  videographerId: string | null;
  videographerName: string | null;
};

async function loadDay(productionDayId: string): Promise<DraaiboekDay | null> {
  const [d] = await db
    .select({
      id: productionDays.id,
      clientId: productionDays.clientId,
      clientName: clients.name,
      clientLogo: clients.logoUrl,
      clientColor: clients.color,
      title: productionDays.title,
      scheduledOn: productionDays.scheduledOn,
      startTime: productionDays.startTime,
      endTime: productionDays.endTime,
      locationName: productionDays.locationName,
      locationAddress: productionDays.locationAddress,
      videographerId: productionDays.videographerId,
      videographerName: users.fullName,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(users, eq(users.id, productionDays.videographerId))
    .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
    .limit(1);
  return d ? { ...d, scheduledOn: String(d.scheduledOn) } : null;
}

export type DraaiboekNoteView = {
  id: string;
  videoKey: string;
  kind: "notitie" | "blokkade";
  text: string | null;
  summary: string | null;
  hasAudio: boolean;
  durationSec: number | null;
  createdAt: string;
  createdById: string | null;
  createdByName: string | null;
};

async function loadNotes(draaiboekId: string): Promise<DraaiboekNoteView[]> {
  const rows = await db
    .select({
      id: draaiboekNotes.id,
      videoKey: draaiboekNotes.videoKey,
      kind: draaiboekNotes.kind,
      text: draaiboekNotes.text,
      summary: draaiboekNotes.summary,
      audioMime: draaiboekNotes.audioMime,
      durationSec: draaiboekNotes.durationSec,
      createdAt: draaiboekNotes.createdAt,
      createdById: draaiboekNotes.createdById,
      createdByName: users.fullName,
    })
    .from(draaiboekNotes)
    .leftJoin(users, eq(users.id, draaiboekNotes.createdById))
    .where(and(eq(draaiboekNotes.draaiboekId, draaiboekId), isNull(draaiboekNotes.deletedAt)))
    .orderBy(asc(draaiboekNotes.createdAt));
  return rows.map((r) => ({
    id: r.id,
    videoKey: r.videoKey,
    kind: r.kind === "blokkade" ? "blokkade" : "notitie",
    text: r.text,
    summary: r.summary,
    hasAudio: Boolean(r.audioMime),
    durationSec: r.durationSec,
    createdAt: r.createdAt.toISOString(),
    createdById: r.createdById,
    createdByName: r.createdByName,
  }));
}

export type DraaiboekView = {
  id: string | null;
  day: DraaiboekDay;
  status: DraaiboekStatus | null;
  content: DraaiboekContent | null;
  progress: DraaiboekProgress;
  sourceFileName: string | null;
  generatedAt: string | null;
  sentAt: string | null;
  sentToId: string | null;
  sentToName: string | null;
  finishedAt: string | null;
  finishNote: string | null;
  notes: DraaiboekNoteView[];
};

async function loadView(productionDayId: string): Promise<DraaiboekView | null> {
  const day = await loadDay(productionDayId);
  if (!day) return null;
  const [d] = await db
    .select({
      id: draaiboeken.id,
      status: draaiboeken.status,
      content: draaiboeken.content,
      progress: draaiboeken.progress,
      sourceFileName: draaiboeken.sourceFileName,
      generatedAt: draaiboeken.generatedAt,
      sentAt: draaiboeken.sentAt,
      sentToId: draaiboeken.sentToId,
      sentToName: users.fullName,
      finishedAt: draaiboeken.finishedAt,
      finishNote: draaiboeken.finishNote,
    })
    .from(draaiboeken)
    .leftJoin(users, eq(users.id, draaiboeken.sentToId))
    .where(and(eq(draaiboeken.productionDayId, productionDayId), isNull(draaiboeken.deletedAt)))
    .limit(1);
  return {
    id: d?.id ?? null,
    day,
    status: (d?.status as DraaiboekStatus) ?? null,
    content: d && isDraaiboekContent(d.content) ? d.content : null,
    progress: (d?.progress ?? {}) as DraaiboekProgress,
    sourceFileName: d?.sourceFileName ?? null,
    generatedAt: d?.generatedAt ? d.generatedAt.toISOString() : null,
    sentAt: d?.sentAt ? d.sentAt.toISOString() : null,
    sentToId: d?.sentToId ?? null,
    sentToName: d?.sentToName ?? null,
    finishedAt: d?.finishedAt ? d.finishedAt.toISOString() : null,
    finishNote: d?.finishNote ?? null,
    notes: d ? await loadNotes(d.id) : [],
  };
}

/** Controle-weergave voor het team (ook als er nog geen draaiboek is). */
export async function getDraaiboekForControl(viewer: Viewer, productionDayId: string): Promise<DraaiboekView | null> {
  assertCanManageDraaiboek(viewer);
  const view = await loadView(productionDayId);
  if (!view) return null;
  assertClientAccess(viewer, view.day.clientId);
  return view;
}

/** Is deze gebruiker de videograaf van dit draaiboek? */
function isAssignedVideographer(viewer: Viewer, view: DraaiboekView): boolean {
  return view.sentToId === viewer.id || view.day.videographerId === viewer.id;
}

/** Mobiele weergave voor de videograaf: alleen verstuurde draaiboeken van de eigen opnames. */
export async function getDraaiboekForVideographer(viewer: Viewer, productionDayId: string): Promise<DraaiboekView | null> {
  const view = await loadView(productionDayId);
  if (!view || !view.id || !view.content) return null;
  const manager = canManageDraaiboek(viewer);
  if (!manager && !isAssignedVideographer(viewer, view)) throw new ForbiddenError("Deze opname is niet aan jou toegewezen.");
  if (!manager && view.status === "concept") return null;
  return view;
}

/** Mag deze gebruiker voortgang en notities vastleggen bij dit draaiboek? */
export async function assertCanRecord(viewer: Viewer, productionDayId: string): Promise<{ id: string; clientId: string; content: DraaiboekContent; status: DraaiboekStatus }> {
  const [d] = await db
    .select({ id: draaiboeken.id, clientId: draaiboeken.clientId, status: draaiboeken.status, content: draaiboeken.content, sentToId: draaiboeken.sentToId, videographerId: productionDays.videographerId })
    .from(draaiboeken)
    .innerJoin(productionDays, eq(productionDays.id, draaiboeken.productionDayId))
    .where(and(eq(draaiboeken.productionDayId, productionDayId), isNull(draaiboeken.deletedAt)))
    .limit(1);
  if (!d || !isDraaiboekContent(d.content)) throw new ForbiddenError("Dit draaiboek bestaat niet (meer).");
  const assigned = d.sentToId === viewer.id || d.videographerId === viewer.id;
  if (!assigned && !canManageDraaiboek(viewer)) throw new ForbiddenError("Deze opname is niet aan jou toegewezen.");
  if (d.status === "concept" && !canManageDraaiboek(viewer)) throw new ForbiddenError("Dit draaiboek wordt nog gecontroleerd.");
  return { id: d.id, clientId: d.clientId, content: d.content, status: d.status as DraaiboekStatus };
}

export type VideographerSession = {
  productionDayId: string;
  clientName: string;
  clientLogo: string | null;
  clientColor: string | null;
  title: string;
  scheduledOn: string;
  startTime: string | null;
  endTime: string | null;
  locationName: string | null;
  videos: number;
  pct: number;
  status: DraaiboekStatus;
};

/**
 * Opnames met een verstuurd draaiboek voor de videograaf: vandaag plus de komende
 * twee weken. Team Shortclips ziet alle verstuurde draaiboeken.
 */
export async function listVideographerSessions(viewer: Viewer): Promise<{ today: string; sessions: VideographerSession[] }> {
  const today = todayAmsterdam();
  const until = new Date(`${today}T12:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 14);
  const untilIso = until.toISOString().slice(0, 10);
  const manager = canManageDraaiboek(viewer);
  const rows = await db
    .select({
      productionDayId: draaiboeken.productionDayId,
      status: draaiboeken.status,
      content: draaiboeken.content,
      progress: draaiboeken.progress,
      clientName: clients.name,
      clientLogo: clients.logoUrl,
      clientColor: clients.color,
      title: productionDays.title,
      scheduledOn: productionDays.scheduledOn,
      startTime: productionDays.startTime,
      endTime: productionDays.endTime,
      locationName: productionDays.locationName,
    })
    .from(draaiboeken)
    .innerJoin(productionDays, eq(productionDays.id, draaiboeken.productionDayId))
    .innerJoin(clients, eq(clients.id, draaiboeken.clientId))
    .where(
      and(
        isNull(draaiboeken.deletedAt),
        isNull(productionDays.deletedAt),
        inArray(draaiboeken.status, ["verstuurd", "afgerond", "afgerond_open"]),
        gte(productionDays.scheduledOn, today),
        lte(productionDays.scheduledOn, untilIso),
        manager ? undefined : or(eq(draaiboeken.sentToId, viewer.id), eq(productionDays.videographerId, viewer.id)),
      ),
    )
    .orderBy(asc(productionDays.scheduledOn), asc(productionDays.startTime), desc(draaiboeken.sentAt));
  const sessions = rows.map((r) => {
      const content = isDraaiboekContent(r.content) ? r.content : null;
      return {
        productionDayId: r.productionDayId,
        clientName: r.clientName,
        clientLogo: r.clientLogo,
        clientColor: r.clientColor,
        title: r.title,
        scheduledOn: String(r.scheduledOn),
        startTime: r.startTime,
        endTime: r.endTime,
        locationName: r.locationName,
        videos: content?.videos.length ?? 0,
        pct: content ? sessionProgress(content, (r.progress ?? {}) as DraaiboekProgress).pct : 0,
        status: r.status as DraaiboekStatus,
      };
    });
  return { today, sessions };
}

/** Wie kan het draaiboek ontvangen: videografen en het vaste team. */
export async function videographerOptions(): Promise<Array<{ id: string; name: string }>> {
  const rows = await db
    .select({ id: users.id, name: users.fullName, email: users.email, role: users.primaryRole })
    .from(users)
    .where(and(isNull(users.deletedAt), eq(users.status, "active")))
    .orderBy(asc(users.fullName));
  return rows.filter((r) => r.role === "videographer" || isCoreStaff(r.email)).map((r) => ({ id: r.id, name: r.name }));
}
