import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { assertClientAccess, type Viewer } from "@/server/auth/context";
import { getPublishedVideoResults } from "@/server/portal-videos";
import { loadClientMemoryForPeriod, type ClientMemory } from "./index";
import { buildYearView, firstSentence, yearPeriod, type YearView } from "./year-view";

/**
 * Contentgeheugen in het klantportaal: alle resultaten van het huidige
 * kalenderjaar (of vanaf de latere startdatum van de klant), uit dezelfde
 * databron als de Resultatenpagina. Alleen de eigen klant (assertClientAccess).
 */

const rowsOf = <T,>(res: unknown): T[] => (((res as { rows?: unknown[] }).rows ?? res) as T[]);

export type ClientYearMemory = { cm: ClientMemory; view: YearView };

async function loadTranscriptOpenings(clientId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const res = await db.execute(sql`
      select va.publication_id, vt.full_text
      from video_analyses va
      join video_transcripts vt on vt.analysis_id = va.id
      where va.client_id = ${clientId} and va.deleted_at is null and va.publication_id is not null
        and vt.full_text is not null and length(vt.full_text) > 8`);
    for (const r of rowsOf<{ publication_id: string; full_text: string }>(res)) {
      const s = firstSentence(r.full_text);
      if (s && !out.has(r.publication_id)) out.set(r.publication_id, s);
    }
  } catch {
    /* geen video-analyse: alleen scriptopeningen */
  }
  return out;
}

/** Zelfde videoherkenning als de Resultatenpagina (isVideoPost): duur bekend, of een video-/reel-URL. */
async function loadVideoPublicationIds(clientId: string): Promise<Set<string>> {
  const res = await db.execute(sql`
    select id from publications
    where client_id = ${clientId} and deleted_at is null and status = 'published'
      and (coalesce(duration_seconds, 0) > 0
        or (platform::text = 'tiktok' and external_url ~ '/video/')
        or (platform::text = 'youtube')
        or external_url ~ '/reels?/|/videos?/')`);
  return new Set(rowsOf<{ id: string }>(res).map((r) => r.id));
}

async function loadLastMeasured(clientId: string): Promise<string | null> {
  try {
    const res = await db.execute(sql`select max(updated_at) as at from social_metrics where client_id = ${clientId}`);
    const at = rowsOf<{ at: string | Date | null }>(res)[0]?.at;
    return at ? new Date(at).toISOString() : null;
  } catch {
    return null;
  }
}

export async function getClientYearMemory(viewer: Viewer, clientId: string, now: Date = new Date()): Promise<ClientYearMemory | null> {
  assertClientAccess(viewer, clientId);
  const [c] = await db.select({ startedOn: clients.startedOn }).from(clients).where(and(eq(clients.id, clientId), isNull(clients.deletedAt))).limit(1);
  if (!c) return null;
  const period = yearPeriod(now, c.startedOn ? String(c.startedOn) : null);
  const [cm, videos, transcripts, videoPublicationIds, lastMeasured] = await Promise.all([
    loadClientMemoryForPeriod(clientId, period.from),
    getPublishedVideoResults(clientId),
    loadTranscriptOpenings(clientId),
    loadVideoPublicationIds(clientId),
    loadLastMeasured(clientId),
  ]);
  if (!cm) return null;
  return { cm, view: buildYearView({ period, videos, memory: cm.memory, ai: cm.ai, transcripts, videoPublicationIds, lastMeasured }) };
}
