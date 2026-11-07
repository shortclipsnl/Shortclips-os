import "server-only";
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentCalendar, deliverables, scripts } from "@/db/schema";
import { cleanPlanningTitle } from "@/lib/portal-status";
import { buildPlanningChecklist, type Checklist } from "@/lib/content-planning-status";

/**
 * Eén centrale lader voor "Jouw contentplanning": het statusoverzicht in het
 * klantportaal en de contentplanning-PDF (klant én team) lezen allebei hier.
 * Bron is uitsluitend de bestaande contentkalender (content_calendar) van de
 * klant, en daarvan alleen wat met de klant is gedeeld (clientApproved). Zo
 * zien klant en team in de PDF exact hetzelfde als in het portaal en bestaat
 * er geen tweede planning.
 *
 * Toegang wordt NIET hier gecontroleerd maar in de aanroeper (route/pagina):
 * die bepaalt welke clientId er mag worden geladen.
 */

const TZ = "Europe/Amsterdam";

export type PlanningPost = {
  id: string;
  title: string;
  scheduledOn: string;
  scheduledAt: string | null;
  platforms: string[];
  status: string;
  caption: string | null;
  videoStatus: string | null;
};

export type ContentPlanningOverview = {
  clientId: string;
  clientName: string;
  logoUrl: string | null;
  weHandlePosting: boolean;
  /** Vandaag (Europe/Amsterdam), YYYY-MM-DD. */
  today: string;
  /** Maandag van deze week: begin van het venster. */
  fromMonday: string;
  posts: PlanningPost[];
  /** Concepten die nog niet met de klant zijn gedeeld (alleen relevant voor het team). */
  unsharedCount: number;
  checklist: Checklist;
  generatedAt: Date;
};

export function todayAmsterdam(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Maximaal aantal weken vooruit in de PDF; voorkomt eindeloze documenten. */
const MAX_WEEKS = 26;

export async function loadContentPlanningOverview(clientId: string, now = new Date()): Promise<ContentPlanningOverview | null> {
  const [client] = await db
    .select({ id: clients.id, name: clients.name, logoUrl: clients.logoUrl, weHandlePosting: clients.weHandlePosting })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return null;

  const today = todayAmsterdam(now);
  const fromMonday = mondayOf(today);
  const until = new Date(`${fromMonday}T12:00:00Z`);
  until.setUTCDate(until.getUTCDate() + MAX_WEEKS * 7);
  const untilIso = until.toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: contentCalendar.id,
      title: contentCalendar.title,
      scheduledOn: contentCalendar.scheduledOn,
      scheduledAt: contentCalendar.scheduledAt,
      platforms: contentCalendar.platforms,
      status: contentCalendar.status,
      caption: contentCalendar.caption,
      videoStatus: deliverables.status,
    })
    .from(contentCalendar)
    .leftJoin(deliverables, and(eq(deliverables.id, contentCalendar.deliverableId), isNull(deliverables.deletedAt)))
    .where(and(
      eq(contentCalendar.clientId, clientId),
      isNull(contentCalendar.deletedAt),
      eq(contentCalendar.clientApproved, true),
      gte(contentCalendar.scheduledOn, fromMonday),
      sql`${contentCalendar.scheduledOn} < ${untilIso}`,
    ))
    .orderBy(asc(contentCalendar.scheduledOn), asc(contentCalendar.scheduledAt), asc(contentCalendar.createdAt));

  const posts: PlanningPost[] = rows
    // Mislukte publicaties tonen we niet als planning; die pakt het team op.
    .filter((r) => r.status !== "failed")
    .map((r) => ({
      id: r.id,
      title: cleanPlanningTitle(r.title, { fallback: "Nieuwe video", clientName: client.name }),
      scheduledOn: r.scheduledOn,
      scheduledAt: r.scheduledAt ? r.scheduledAt.slice(0, 5) : null,
      platforms: Array.isArray(r.platforms) ? (r.platforms as string[]) : [],
      status: r.status,
      caption: r.caption ?? null,
      videoStatus: r.videoStatus ?? null,
    }));

  const [[vids], [scr], [unshared]] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(deliverables)
      .where(and(eq(deliverables.clientId, clientId), isNull(deliverables.deletedAt), eq(deliverables.status, "client_review"))),
    db.select({ n: sql<number>`count(*)` }).from(scripts)
      .where(and(eq(scripts.clientId, clientId), isNull(scripts.deletedAt), eq(scripts.status, "client_review"))),
    db.select({ n: sql<number>`count(*)` }).from(contentCalendar)
      .where(and(
        eq(contentCalendar.clientId, clientId), isNull(contentCalendar.deletedAt), eq(contentCalendar.clientApproved, false),
        inArray(contentCalendar.status, ["ready", "scheduled", "published"]), gte(contentCalendar.scheduledOn, fromMonday),
      )),
  ]);

  const checklist = buildPlanningChecklist({
    weHandlePosting: client.weHandlePosting,
    posts,
    videosAwaitingClient: Number(vids?.n ?? 0),
    scriptsAwaitingClient: Number(scr?.n ?? 0),
    today,
  });

  return {
    clientId: client.id,
    clientName: client.name,
    logoUrl: client.logoUrl ?? null,
    weHandlePosting: client.weHandlePosting,
    today,
    fromMonday,
    posts,
    unsharedCount: Number(unshared?.n ?? 0),
    checklist,
    generatedAt: now,
  };
}
