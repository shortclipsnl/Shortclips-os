import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientIntegrations, deliverables, frameAssets, productionDays, scriptReviews } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { cleanVideoTitle, reviewDeadline } from "@/lib/portal-status";

/**
 * Videopagina van het klantportaal: de echte opnamesessies en video's uit het
 * Frame.io-project van de klant (gespiegeld in `frame_assets`). Statussen komen
 * alleen uit het editingproject dat aantoonbaar bij die opnamedag hoort; is er
 * geen koppeling, dan tonen we geen status (niets verzinnen).
 */

export type SessionStatusKey = "feedback" | "verwerken" | "goedgekeurd" | "online" | "productie";

export type PortalFrameVideo = {
  id: string;
  title: string;
  fileName: string;
  subfolder: string | null;
  durationSeconds: number | null;
  createdAt: string | null;
  versionCount: number;
};

export type PortalFrameSession = {
  key: string;
  title: string;
  shootDate: string | null;
  createdAt: string | null;
  status: { key: SessionStatusKey; label: string } | null;
  /** Deliverable-id om in het portaal akkoord te geven (alleen bij status feedback). */
  approveId: string | null;
  feedbackDeadline: string | null;
  videos: PortalFrameVideo[];
};

export type PortalFrameLibrary = {
  connected: boolean;
  sessions: PortalFrameSession[];
  totalVideos: number;
  /** Deelbare review-link van de klant in Frame (alleen als het team die heeft ingesteld). */
  reviewUrl: string | null;
  lastSyncedAt: string | null;
};

const PRODUCTIE = new Set(["recorded", "footage_upload", "awaiting_editor", "editing", "internal_review", "editor_revision"]);

function sessionStatus(status: string | null, sessionCreatedAt: Date | null): PortalFrameSession["status"] {
  if (!status) return null;
  if (status === "client_review") return { key: "feedback", label: "Klaar voor jouw feedback" };
  if (status === "client_revision") return { key: "verwerken", label: "Feedback wordt verwerkt" };
  if (["approved", "ready_to_publish", "scheduled"].includes(status)) return { key: "goedgekeurd", label: "Goedgekeurd" };
  if (["published", "analysis_available"].includes(status)) return { key: "online", label: "Online" };
  // Interne fases alleen tonen voor recente sessies; bij oude sessies is de
  // interne status vaak niet bijgewerkt en zou "in productie" misleiden.
  if (PRODUCTIE.has(status) && sessionCreatedAt && Date.now() - sessionCreatedAt.getTime() < 30 * 86_400_000) {
    return { key: "productie", label: "In productie" };
  }
  return null;
}

/** Leesbare sessienaam: "SESSIE 3 - 24 APRIL" → "Sessie 3 · 24 april". */
export function prettySessionName(raw: string | null): string {
  if (!raw) return "Overige video's";
  let t = raw.replace(/\s+/g, " ").trim();
  if (/[A-Z]/.test(t) && !/[a-z]/.test(t)) t = t.toLowerCase();
  t = t.replace(/\s+-\s+/g, " · ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export async function getPortalFrameLibrary(viewer: Viewer): Promise<PortalFrameLibrary> {
  const clientId = viewer.clientId;
  if (!clientId) return { connected: false, sessions: [], totalVideos: 0, reviewUrl: null, lastSyncedAt: null };
  return getFrameLibraryForClient(clientId);
}

/**
 * Dezelfde videobibliotheek per klant, los van wie er kijkt. Wordt gedeeld door
 * het klantportaal en de interne klantenpagina (knop "Short video's"), zodat
 * beide exact dezelfde sessies, video's en Frame-koppeling tonen. De aanroeper
 * is verantwoordelijk voor de toegangscontrole op de klant.
 */
export async function getFrameLibraryForClient(clientId: string): Promise<PortalFrameLibrary> {

  const [links, rows] = await Promise.all([
    db
      .select({ externalUrl: clientIntegrations.externalUrl, lastSyncedAt: clientIntegrations.lastSyncedAt })
      .from(clientIntegrations)
      .where(and(eq(clientIntegrations.clientId, clientId), eq(clientIntegrations.provider, "frameio"))),
    db
      .select({
        id: frameAssets.id,
        name: frameAssets.name,
        sessionFolderId: frameAssets.sessionFolderId,
        sessionName: frameAssets.sessionName,
        sessionCreatedAt: frameAssets.sessionCreatedAt,
        dayId: frameAssets.sessionProductionDayId,
        subfolder: frameAssets.subfolderName,
        durationSeconds: frameAssets.durationSeconds,
        versionCount: frameAssets.versionCount,
        createdAt: frameAssets.frameCreatedAt,
      })
      .from(frameAssets)
      .where(and(eq(frameAssets.clientId, clientId), isNull(frameAssets.deletedAt)))
      .orderBy(desc(frameAssets.sessionCreatedAt), frameAssets.subfolderName, frameAssets.name),
  ]);

  const dayIds = [...new Set(rows.map((r) => r.dayId).filter((d): d is string => !!d))];
  const [days, dels] = dayIds.length
    ? await Promise.all([
        db.select({ id: productionDays.id, on: productionDays.scheduledOn }).from(productionDays).where(inArray(productionDays.id, dayIds)),
        db
          .select({ id: deliverables.id, dayId: deliverables.productionDayId, status: deliverables.status, changed: deliverables.statusChangedAt })
          .from(deliverables)
          .where(and(eq(deliverables.clientId, clientId), inArray(deliverables.productionDayId, dayIds), isNull(deliverables.deletedAt))),
      ])
    : [[], []];
  const dayOn = new Map(days.map((d) => [d.id, d.on]));
  // Per opnamedag de status die voor de klant het belangrijkst is.
  const RANK = ["client_review", "client_revision", "editing", "internal_review", "editor_revision", "awaiting_editor", "footage_upload", "recorded", "approved", "ready_to_publish", "scheduled", "published", "analysis_available"];
  const delByDay = new Map<string, { id: string; status: string; changed: Date }>();
  for (const d of dels) {
    if (!d.dayId) continue;
    const cur = delByDay.get(d.dayId);
    if (!cur || RANK.indexOf(d.status) < RANK.indexOf(cur.status)) delByDay.set(d.dayId, { id: d.id, status: d.status, changed: d.changed });
  }

  const sessions = new Map<string, PortalFrameSession>();
  for (const r of rows) {
    const key = r.sessionFolderId ?? "los";
    let s = sessions.get(key);
    if (!s) {
      const del = r.dayId ? delByDay.get(r.dayId) ?? null : null;
      const st = sessionStatus(del?.status ?? null, r.sessionCreatedAt);
      s = {
        key,
        title: prettySessionName(r.sessionName),
        shootDate: r.dayId ? dayOn.get(r.dayId) ?? null : null,
        createdAt: r.sessionCreatedAt?.toISOString() ?? null,
        status: st,
        approveId: st?.key === "feedback" ? del!.id : null,
        feedbackDeadline: st?.key === "feedback" ? reviewDeadline(del!.changed)?.toISOString() ?? null : null,
        videos: [],
      };
      sessions.set(key, s);
    }
    s.videos.push({
      id: r.id,
      title: cleanVideoTitle(r.name) || r.name,
      fileName: r.name,
      subfolder: r.subfolder,
      durationSeconds: r.durationSeconds,
      createdAt: r.createdAt?.toISOString() ?? null,
      versionCount: r.versionCount,
    });
  }

  const list = [...sessions.values()].sort((a, b) => {
    if (a.key === "los") return 1;
    if (b.key === "los") return -1;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });
  const link = links.find((l) => l.externalUrl) ?? links[0];
  return {
    connected: links.length > 0,
    sessions: list,
    totalVideos: rows.length,
    reviewUrl: link?.externalUrl ?? null,
    lastSyncedAt: links.map((l) => l.lastSyncedAt).filter(Boolean).sort().reverse()[0]?.toISOString() ?? null,
  };
}

/** Lichte tellers voor de navigatie: waar wacht iets op de klant? */
export async function getPortalActionCounts(viewer: Viewer): Promise<{ scripts: number; videos: number }> {
  const clientId = viewer.clientId;
  if (!clientId) return { scripts: 0, videos: 0 };
  const [s, v] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(scriptReviews)
      .where(and(eq(scriptReviews.clientId, clientId), isNull(scriptReviews.deletedAt), inArray(scriptReviews.status, ["klaar_controle", "opnieuw_controle"]))),
    db.select({ n: sql<number>`count(*)::int` }).from(deliverables)
      .where(and(eq(deliverables.clientId, clientId), isNull(deliverables.deletedAt), eq(deliverables.status, "client_review"))),
  ]);
  return { scripts: Number(s[0]?.n ?? 0), videos: Number(v[0]?.n ?? 0) };
}
