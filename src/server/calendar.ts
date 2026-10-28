import "server-only";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentCalendar, deliverables, users } from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";

export type CalendarFilter = {
  from: string;
  to: string;
  clientSlug?: string;
  status?: string;
  platform?: string;
  ownerId?: string;
};

export async function listCalendar(viewer: Viewer, filter: CalendarFilter) {
  const conditions = [
    isNull(contentCalendar.deletedAt),
    gte(contentCalendar.scheduledOn, filter.from),
    lte(contentCalendar.scheduledOn, filter.to),
    scopeToClients(viewer, contentCalendar.clientId),
  ];
  if (filter.clientSlug) conditions.push(eq(clients.slug, filter.clientSlug));
  if (filter.status) conditions.push(eq(contentCalendar.status, filter.status as "ready"));
  if (filter.ownerId) conditions.push(eq(contentCalendar.ownerId, filter.ownerId));

  const rows = await db
    .select({
      id: contentCalendar.id,
      title: contentCalendar.title,
      scheduledOn: contentCalendar.scheduledOn,
      scheduledAt: contentCalendar.scheduledAt,
      status: contentCalendar.status,
      platforms: contentCalendar.platforms,
      contentType: contentCalendar.contentType,
      caption: contentCalendar.caption,
      deliverableId: contentCalendar.deliverableId,
      videoStatus: deliverables.status,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      weHandlePosting: clients.weHandlePosting,
      ownerName: users.fullName,
    })
    .from(contentCalendar)
    .innerJoin(clients, eq(clients.id, contentCalendar.clientId))
    .leftJoin(deliverables, eq(deliverables.id, contentCalendar.deliverableId))
    .leftJoin(users, eq(users.id, contentCalendar.ownerId))
    .where(and(...conditions))
    .orderBy(asc(contentCalendar.scheduledOn), asc(contentCalendar.scheduledAt))
    .limit(500);

  if (!filter.platform) return rows;
  // Items zonder gekoppelde platforms blijven zichtbaar onder elk platformfilter,
  // zodat filteren nooit stilletjes de hele planning leegtrekt.
  return rows.filter((r) => {
    const ps = (r.platforms as string[]) ?? [];
    return ps.length === 0 || ps.includes(filter.platform!);
  });
}

export type CalendarItem = Awaited<ReturnType<typeof listCalendar>>[number];

/** Kalendermaand als raster van weken, inclusief de dagen ervoor en erna. */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // Maandag als eerste dag van de week.
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - offset);

  const weeks: string[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
    // Stoppen zodra de volgende maand begint en de week vol is.
    if (cursor.getUTCMonth() !== month - 1 && cursor.getUTCDate() > 7) break;
  }
  return weeks;
}
