import "server-only";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  adEditProjects,
  captionSets,
  clientReports,
  clients,
  contentResearchRuns,
  videoAnalyses,
} from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";

/**
 * Uniforme status van de AI-taken die NU op de achtergrond draaien, verzameld uit
 * alle AI-functies (Content Research, Video Intelligence, Captions, Maandrapportages,
 * AI-editor). Elk van die functies draait al server-side (via `after()`/cron) met
 * een eigen afrondmelding; dit geeft het team één overzicht van wat er loopt —
 * los van de pagina of browsersessie waar het gestart is.
 *
 * Alleen-lezen en permissie-gescoped (klanten waar de viewer toegang toe heeft).
 * Een "actieve" taak is een lopende status die recent is bijgewerkt — zo blijft een
 * vastgelopen rij niet eeuwig als "bezig" staan.
 */
export type ActiveAiTask = {
  kind: "content_research" | "video_intelligence" | "captions" | "maandrapport" | "ai_editor";
  label: string;
  sub: string | null;
  href: string;
  startedAt: string | null;
};
export type ActiveAiTasks = { count: number; items: ActiveAiTask[] };

/** Taken ouder dan dit tonen we niet meer als "actief" (vangnet tegen vastgelopen rijen). */
const FRESH_MINUTES = 30;
const PER_SOURCE = 25;

export async function getActiveAiTasks(viewer: Viewer): Promise<ActiveAiTasks> {
  // AI-functies zijn intern; klanten in het portaal zien deze indicator niet.
  if (viewer.isPortalUser) return { count: 0, items: [] };

  const since = new Date(Date.now() - FRESH_MINUTES * 60_000);
  const crScope = scopeToClients(viewer, contentResearchRuns.clientId);
  const viScope = scopeToClients(viewer, videoAnalyses.clientId);
  const csScope = scopeToClients(viewer, captionSets.clientId);
  const mrScope = scopeToClients(viewer, clientReports.clientId);
  const aeScope = scopeToClients(viewer, adEditProjects.clientId);

  const [cr, vi, cs, mr, ae] = await Promise.all([
    db
      .select({ id: contentResearchRuns.id, clientId: contentResearchRuns.clientId, name: clients.name, startedAt: contentResearchRuns.startedAt, updatedAt: contentResearchRuns.updatedAt })
      .from(contentResearchRuns)
      .leftJoin(clients, eq(clients.id, contentResearchRuns.clientId))
      .where(and(eq(contentResearchRuns.status, "bezig"), isNull(contentResearchRuns.deletedAt), gte(contentResearchRuns.updatedAt, since), crScope ?? undefined))
      .orderBy(desc(contentResearchRuns.updatedAt))
      .limit(PER_SOURCE),
    db
      .select({ id: videoAnalyses.id, clientId: videoAnalyses.clientId, name: clients.name, title: videoAnalyses.title, updatedAt: videoAnalyses.updatedAt })
      .from(videoAnalyses)
      .leftJoin(clients, eq(clients.id, videoAnalyses.clientId))
      .where(and(inArray(videoAnalyses.status, ["queued", "downloading", "processing"]), gte(videoAnalyses.updatedAt, since), viScope ?? undefined))
      .orderBy(desc(videoAnalyses.updatedAt))
      .limit(PER_SOURCE),
    db
      .select({ id: captionSets.id, clientId: captionSets.clientId, name: clients.name, updatedAt: captionSets.updatedAt })
      .from(captionSets)
      .leftJoin(clients, eq(clients.id, captionSets.clientId))
      .where(and(eq(captionSets.status, "bezig"), gte(captionSets.updatedAt, since), csScope ?? undefined))
      .orderBy(desc(captionSets.updatedAt))
      .limit(PER_SOURCE),
    db
      .select({ id: clientReports.id, clientId: clientReports.clientId, name: clients.name, period: clientReports.period, updatedAt: clientReports.updatedAt })
      .from(clientReports)
      .leftJoin(clients, eq(clients.id, clientReports.clientId))
      .where(and(inArray(clientReports.status, ["gegevens_verzamelen", "analyse_bezig"]), isNull(clientReports.deletedAt), gte(clientReports.updatedAt, since), mrScope ?? undefined))
      .orderBy(desc(clientReports.updatedAt))
      .limit(PER_SOURCE),
    db
      .select({ id: adEditProjects.id, title: adEditProjects.title, name: clients.name, phase: adEditProjects.phase, updatedAt: adEditProjects.updatedAt })
      .from(adEditProjects)
      .leftJoin(clients, eq(clients.id, adEditProjects.clientId))
      .where(and(inArray(adEditProjects.status, ["queued", "processing"]), isNull(adEditProjects.deletedAt), gte(adEditProjects.updatedAt, since), aeScope ?? undefined))
      .orderBy(desc(adEditProjects.updatedAt))
      .limit(PER_SOURCE),
  ]);

  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const items: ActiveAiTask[] = [
    ...cr.map((r) => ({ kind: "content_research" as const, label: "Content Research", sub: r.name ?? null, href: `/ai/content-research/${r.clientId}`, startedAt: iso(r.startedAt ?? r.updatedAt) })),
    ...vi.map((r) => ({ kind: "video_intelligence" as const, label: "Video-analyse", sub: r.title || r.name || null, href: "/video-intelligence", startedAt: iso(r.updatedAt) })),
    ...cs.map((r) => ({ kind: "captions" as const, label: "Captions", sub: r.name ?? null, href: "/ai/caption", startedAt: iso(r.updatedAt) })),
    ...mr.map((r) => ({ kind: "maandrapport" as const, label: "Maandrapport", sub: r.name ? `${r.name} · ${r.period}` : r.period, href: "/analytics/maandrapportages", startedAt: iso(r.updatedAt) })),
    ...ae.map((r) => ({ kind: "ai_editor" as const, label: "AI-editor", sub: r.title || r.name || r.phase || null, href: "/ai-editor", startedAt: iso(r.updatedAt) })),
  ];

  items.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return { count: items.length, items };
}
