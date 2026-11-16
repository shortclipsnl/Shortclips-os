import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentCalendar, publications } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { resolveContentVideosForClient } from "@/server/content-video";
import { cleanCaption } from "@/lib/clean-caption";
import {
  DEFAULT_PLATFORMS,
  addDays,
  mondayOf,
  captionHeadline,
  captionIsFinal,
  clientPostStatus,
  clientPostTitle,
  sortPlatforms,
  type ClientPostStatus,
} from "@/lib/client-content-planning";

/** Eén geplande video zoals de klant hem ziet. Bevat bewust geen interne velden. */
export type ClientAgendaPost = {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  scheduledOn: string;
  /** HH:MM of null */
  scheduledAt: string | null;
  platforms: string[];
  status: ClientPostStatus;
  thumbUrl: string | null;
  /** Alleen als de video klaar of online is (definitieve caption). */
  caption: string | null;
  /** Openbare links per kanaal, alleen bij gepubliceerde video's. */
  links: Array<{ platform: string; url: string }>;
};

export type ClientAgenda = {
  clientName: string;
  weHandlePosting: boolean;
  posts: ClientAgendaPost[];
};

const amsDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });

/**
 * De contentplanning van de klant voor het portaal, voor de periode from..to.
 *
 * Eén bron: de interne contentplanning (`content_calendar`). Elke wijziging die
 * het team daar doet (inplannen, datum, tijd, kanalen, status, publiceren) is
 * bij de volgende paginaweergave direct zichtbaar; er is geen kopie of tweede
 * agenda. De klant-id komt altijd uit de sessie, nooit uit de URL, en we lezen
 * uitsluitend klantrelevante velden (geen notities, eigenaar, contenttype of
 * interne vlaggen).
 */
export async function getClientAgenda(viewer: Viewer, from: string, to: string): Promise<ClientAgenda> {
  const clientId = viewer.clientId;
  if (!clientId) return { clientName: "", weHandlePosting: true, posts: [] };

  const [cl] = await db
    .select({ name: clients.name, we: clients.weHandlePosting })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const clientName = cl?.name ?? "";

  const rows = await db
    .select({
      id: contentCalendar.id,
      title: contentCalendar.title,
      scheduledOn: contentCalendar.scheduledOn,
      scheduledAt: contentCalendar.scheduledAt,
      status: contentCalendar.status,
      platforms: contentCalendar.platforms,
      caption: contentCalendar.caption,
      coverUrl: contentCalendar.coverUrl,
      frameAssetId: contentCalendar.frameAssetId,
      productionDayId: contentCalendar.productionDayId,
    })
    .from(contentCalendar)
    .where(and(
      eq(contentCalendar.clientId, clientId),
      isNull(contentCalendar.deletedAt),
      gte(contentCalendar.scheduledOn, from),
      lte(contentCalendar.scheduledOn, to),
    ))
    .orderBy(asc(contentCalendar.scheduledOn), asc(contentCalendar.scheduledAt));

  if (rows.length === 0) return { clientName, weHandlePosting: cl?.we ?? true, posts: [] };
  const ids = rows.map((r) => r.id);

  // Publicaties: gekoppeld aan een planningsitem, of (nog) los op dezelfde dag.
  const pubRows = await db
    .select({
      id: publications.id,
      calendarItemId: publications.calendarItemId,
      platform: publications.platform,
      status: publications.status,
      externalUrl: publications.externalUrl,
      publishedAt: publications.publishedAt,
      hasThumb: sql<boolean>`${publications.thumbnailData} is not null`,
    })
    .from(publications)
    .where(and(
      eq(publications.clientId, clientId),
      isNull(publications.deletedAt),
      sql`(${inArray(publications.calendarItemId, ids)} or (${publications.calendarItemId} is null and ${publications.status} = 'published' and ${publications.publishedAt} >= (${from}::date - 1) and ${publications.publishedAt} < (${to}::date + 2)))`,
    ));

  type Pub = (typeof pubRows)[number];
  const linked = new Map<string, Pub[]>();
  const looseByDay = new Map<string, Pub[]>();
  for (const p of pubRows) {
    if (p.calendarItemId) linked.set(p.calendarItemId, [...(linked.get(p.calendarItemId) ?? []), p]);
    else if (p.publishedAt) {
      const day = amsDay(new Date(p.publishedAt));
      looseByDay.set(day, [...(looseByDay.get(day) ?? []), p]);
    }
  }
  // Losse publicaties alleen toewijzen als er die dag precies één gepubliceerd item is.
  const publishedPerDay = new Map<string, number>();
  for (const r of rows) if (r.status === "published") publishedPerDay.set(String(r.scheduledOn), (publishedPerDay.get(String(r.scheduledOn)) ?? 0) + 1);
  const pubsFor = (r: (typeof rows)[number]): Pub[] => {
    const own = linked.get(r.id) ?? [];
    if (own.length || r.status !== "published") return own;
    const day = String(r.scheduledOn).slice(0, 10);
    return publishedPerDay.get(day) === 1 ? looseByDay.get(day) ?? [] : [];
  };

  // Kanalen als het team ze niet per bericht heeft ingevuld: waar deze klant de
  // laatste 60 dagen echt op publiceerde, anders de vaste Shortclips-kanalen.
  const recent = await db
    .selectDistinct({ platform: publications.platform })
    .from(publications)
    .where(and(
      eq(publications.clientId, clientId),
      isNull(publications.deletedAt),
      eq(publications.status, "published"),
      gte(publications.publishedAt, new Date(Date.now() - 60 * 86_400_000)),
    ));
  const clientPlatforms = recent.length ? sortPlatforms(recent.map((r) => String(r.platform))) : [...DEFAULT_PLATFORMS];

  // Video uit de Frame-bibliotheek als thumbnail (zelfde koppeling als intern).
  const needVideo = rows.filter((r) => !r.coverUrl);
  const videos = needVideo.length
    ? await resolveContentVideosForClient(
        needVideo.map((r) => ({
          id: r.id,
          clientId,
          clientName,
          title: r.title,
          scheduledOn: String(r.scheduledOn).slice(0, 10),
          frameAssetId: r.frameAssetId,
          productionDayId: r.productionDayId,
        })),
      ).catch(() => new Map())
    : new Map();

  const posts: ClientAgendaPost[] = rows.map((r) => {
    const pubs = pubsFor(r);
    const status = clientPostStatus(r.status);
    const final = captionIsFinal(r.status);
    const caption = final && r.caption?.trim() ? cleanCaption(r.caption) : null;
    const own = Array.isArray(r.platforms) ? (r.platforms as string[]).filter(Boolean) : [];
    const published = pubs.filter((p) => p.status === "published");
    const platforms = own.length
      ? sortPlatforms(own)
      : published.length
        ? sortPlatforms(published.map((p) => String(p.platform)))
        : clientPlatforms;
    const links = status === "published"
      ? sortPlatforms(published.filter((p) => p.externalUrl).map((p) => String(p.platform))).map((pl) => ({
          platform: pl,
          url: published.find((p) => String(p.platform) === pl && p.externalUrl)!.externalUrl!,
        }))
      : [];
    const video = videos.get(r.id);
    const pubThumb = published.find((p) => p.hasThumb);
    const thumbUrl = r.coverUrl
      ? r.coverUrl
      : video
        ? `/api/portal/frame/${video.id}/thumb`
        : pubThumb
          ? `/api/portal/post-thumb/${pubThumb.id}`
          : null;
    const title =
      clientPostTitle(r.title, clientName) ||
      (caption ? captionHeadline(caption) : "") ||
      (video ? video.title : "") ||
      "Nieuwe video";
    return {
      id: r.id,
      title,
      scheduledOn: String(r.scheduledOn).slice(0, 10),
      scheduledAt: r.scheduledAt ? String(r.scheduledAt).slice(0, 5) : null,
      platforms,
      status,
      thumbUrl,
      caption,
      links,
    };
  });

  return { clientName, weHandlePosting: cl?.we ?? true, posts };
}

/**
 * Aantal geplande video's per week (maandag) voor de vooruitblik "Komende
 * weken". Zelfde bron en dezelfde klantafbakening als `getClientAgenda`.
 */
export async function countClientAgendaByWeek(viewer: Viewer, from: string, to: string): Promise<Array<{ weekStart: string; count: number }>> {
  const clientId = viewer.clientId;
  if (!clientId) return [];
  const rows = await db
    .select({ day: contentCalendar.scheduledOn })
    .from(contentCalendar)
    .where(and(
      eq(contentCalendar.clientId, clientId),
      isNull(contentCalendar.deletedAt),
      gte(contentCalendar.scheduledOn, from),
      lte(contentCalendar.scheduledOn, to),
    ));
  const out: Array<{ weekStart: string; count: number }> = [];
  for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) out.push({ weekStart: w, count: 0 });
  for (const r of rows) {
    const wk = mondayOf(String(r.day).slice(0, 10));
    const hit = out.find((x) => x.weekStart === wk);
    if (hit) hit.count++;
  }
  return out;
}
