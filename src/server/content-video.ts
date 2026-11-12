import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentCalendar, deliverables, frameAssets } from "@/db/schema";
import { cleanVideoTitle } from "@/lib/portal-status";
import { prettySessionName } from "@/server/portal-frame";
import { autoMatch, latestVersions, type MatchableVideo, videoKey } from "@/lib/content-video-match";

/**
 * Video bij een bericht in de contentplanning. Eén bron voor alles: de
 * Frame-bibliotheek (`frame_assets`) die ook het klantportaal en de interne
 * knop "Short video's" gebruiken. De planning bewaart hooguit een verwijzing
 * (`content_calendar.frame_asset_id`), nooit een kopie van de video.
 *
 * Volgorde:
 * 1. Handmatig gekoppeld → die video, maar altijd de nieuwste versie ervan in
 *    dezelfde opnamesessie (vervangen door een nieuwe versie = automatisch mee).
 * 2. Anders automatisch op titel, alleen bij een sterke, eenduidige match.
 * 3. Anders: geen video ("Nog geen video gekoppeld").
 */

export type ContentVideo = {
  id: string;
  title: string;
  fileName: string;
  sessionTitle: string;
  subfolder: string | null;
  durationSeconds: number | null;
  /** "handmatig" of "automatisch" gekoppeld. */
  source: "handmatig" | "automatisch";
  /** De handmatig gekoppelde video is inmiddels vervangen door een nieuwere versie. */
  upgraded: boolean;
  viewUrl: string | null;
};

export type ContentVideoCandidateSession = {
  key: string;
  title: string;
  videos: Array<{ id: string; title: string; subfolder: string | null; durationSeconds: number | null }>;
};

type Row = MatchableVideo & { durationSeconds: number | null; viewUrl: string | null };

async function clientVideos(clientId: string): Promise<Row[]> {
  const rows = await db
    .select({
      id: frameAssets.id,
      name: frameAssets.name,
      clientId: frameAssets.clientId,
      sessionFolderId: frameAssets.sessionFolderId,
      sessionName: frameAssets.sessionName,
      sessionCreatedAt: frameAssets.sessionCreatedAt,
      sessionProductionDayId: frameAssets.sessionProductionDayId,
      subfolder: frameAssets.subfolderName,
      frameCreatedAt: frameAssets.frameCreatedAt,
      versionCount: frameAssets.versionCount,
      durationSeconds: frameAssets.durationSeconds,
      viewUrl: frameAssets.viewUrl,
    })
    .from(frameAssets)
    .where(and(eq(frameAssets.clientId, clientId), isNull(frameAssets.deletedAt)));
  return rows.map((r) => ({ ...r, sessionKey: r.sessionFolderId ?? "los" }));
}

function toVideo(v: Row, source: ContentVideo["source"], upgraded: boolean): ContentVideo {
  return {
    id: v.id,
    title: cleanVideoTitle(v.name) || v.name,
    fileName: v.name,
    sessionTitle: prettySessionName(v.sessionName),
    subfolder: v.subfolder,
    durationSeconds: v.durationSeconds,
    source,
    upgraded,
    viewUrl: v.viewUrl,
  };
}

export type ContentItemForVideo = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  scheduledOn: string;
  frameAssetId: string | null;
  productionDayId: string | null;
};

/** Het planningsbericht met wat nodig is om de video te bepalen. */
export async function getContentItemForVideo(itemId: string): Promise<ContentItemForVideo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return null;
  const [r] = await db
    .select({
      id: contentCalendar.id,
      clientId: contentCalendar.clientId,
      clientName: clients.name,
      title: contentCalendar.title,
      scheduledOn: contentCalendar.scheduledOn,
      frameAssetId: contentCalendar.frameAssetId,
      productionDayId: contentCalendar.productionDayId,
      deliverableDayId: deliverables.productionDayId,
    })
    .from(contentCalendar)
    .innerJoin(clients, eq(clients.id, contentCalendar.clientId))
    .leftJoin(deliverables, eq(deliverables.id, contentCalendar.deliverableId))
    .where(and(eq(contentCalendar.id, itemId), isNull(contentCalendar.deletedAt)))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    clientId: r.clientId,
    clientName: r.clientName,
    title: r.title,
    scheduledOn: String(r.scheduledOn).slice(0, 10),
    frameAssetId: r.frameAssetId,
    productionDayId: r.productionDayId ?? r.deliverableDayId ?? null,
  };
}

/** De video die bij dit bericht hoort, of null. */
export async function resolveContentVideo(item: ContentItemForVideo): Promise<ContentVideo | null> {
  const all = await clientVideos(item.clientId);
  if (!all.length) return null;

  if (item.frameAssetId) {
    const linked = all.find((v) => v.id === item.frameAssetId);
    if (linked) {
      // Nieuwste versie van dezelfde video in dezelfde opnamesessie.
      const key = videoKey(linked.name, item.clientName);
      const latest = latestVersions(
        all.filter((v) => v.sessionKey === linked.sessionKey && (key ? videoKey(v.name, item.clientName) === key : v.id === linked.id)),
        item.clientName,
      )[0] ?? linked;
      return toVideo(latest, "handmatig", latest.id !== linked.id);
    }
    // Gekoppelde video bestaat niet meer in Frame: val terug op automatisch.
  }

  const match = autoMatch(item, latestVersions(all, item.clientName), item.clientName);
  return match ? toVideo(match, "automatisch", false) : null;
}

/** Kiezer: alle video's van de klant per opnamesessie, alleen de nieuwste versies. */
export async function contentVideoCandidates(item: ContentItemForVideo): Promise<ContentVideoCandidateSession[]> {
  const latest = latestVersions(await clientVideos(item.clientId), item.clientName);
  const sessions = new Map<string, ContentVideoCandidateSession & { at: number }>();
  for (const v of latest) {
    let s = sessions.get(v.sessionKey);
    if (!s) {
      s = { key: v.sessionKey, title: prettySessionName(v.sessionName), videos: [], at: v.sessionCreatedAt?.getTime() ?? 0 };
      sessions.set(v.sessionKey, s);
    }
    s.videos.push({ id: v.id, title: cleanVideoTitle(v.name) || v.name, subfolder: v.subfolder, durationSeconds: v.durationSeconds });
  }
  return [...sessions.values()]
    .sort((a, b) => (a.key === "los" ? 1 : b.key === "los" ? -1 : b.at - a.at))
    .map(({ at: _at, ...s }) => ({ ...s, videos: s.videos.sort((x, y) => x.title.localeCompare(y.title, "nl", { numeric: true })) }));
}

/** Handmatig koppelen (of terug naar automatisch met null). Alleen video's van dezelfde klant. */
export async function setContentVideo(item: ContentItemForVideo, frameAssetId: string | null): Promise<boolean> {
  if (frameAssetId) {
    const [a] = await db
      .select({ id: frameAssets.id })
      .from(frameAssets)
      .where(and(eq(frameAssets.id, frameAssetId), eq(frameAssets.clientId, item.clientId), isNull(frameAssets.deletedAt)))
      .limit(1);
    if (!a) return false;
  }
  await db.update(contentCalendar).set({ frameAssetId, updatedAt: new Date() }).where(eq(contentCalendar.id, item.id));
  return true;
}
