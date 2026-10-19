import "server-only";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  deliverables,
  productionChecklistItems,
  productionDays,
  scripts,
  users,
} from "@/db/schema";
import { assertClientAccess, scopeToClients, type Viewer } from "@/server/auth/context";

const today = () => new Date().toISOString().slice(0, 10);

/** Maandag (start) en de eerstvolgende maandag (einde, exclusief) van de
 *  huidige kalenderweek — zodat "Deze week" altijd ma t/m zo beslaat. */
function currentWeekRange(): { start: string; end: string } {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // ma=0 … zo=6
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return { start: monday.toISOString().slice(0, 10), end: nextMonday.toISOString().slice(0, 10) };
}

export async function listProductionDays(
  viewer: Viewer,
  when: "komend" | "verleden" | "deze-week" = "komend",
) {
  const week = when === "deze-week" ? currentWeekRange() : null;
  return db
    .select({
      id: productionDays.id,
      title: productionDays.title,
      scheduledOn: productionDays.scheduledOn,
      startTime: productionDays.startTime,
      endTime: productionDays.endTime,
      locationName: productionDays.locationName,
      status: productionDays.status,
      phase: productionDays.phase,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      videographerName: users.fullName,
      videographerId: productionDays.videographerId,
      scriptCount: sql<number>`(select count(*) from scripts sc where sc.production_day_id = production_days.id and sc.deleted_at is null)`,
      unapprovedScripts: sql<number>`(select count(*) from scripts sc where sc.production_day_id = production_days.id and sc.deleted_at is null and sc.status not in ('approved','ready_to_shoot','shot'))`,
      openBlockers: sql<number>`(select count(*) from production_checklist_items ci where ci.production_day_id = production_days.id and ci.is_blocking = true and ci.is_done = false)`,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(users, eq(users.id, productionDays.videographerId))
    .where(
      and(
        isNull(productionDays.deletedAt),
        week
          ? and(gte(productionDays.scheduledOn, week.start), lt(productionDays.scheduledOn, week.end))
          : when === "komend"
            ? gte(productionDays.scheduledOn, today())
            : lt(productionDays.scheduledOn, today()),
        scopeToClients(viewer, productionDays.clientId),
      ),
    )
    .orderBy(
      when === "verleden"
        ? desc(productionDays.scheduledOn)
        : asc(productionDays.scheduledOn),
    )
    .limit(200);
}

/** Opnamedagen binnen een datumbereik [startIso, endIso) — voor de agenda-
 *  weergave (per week/maand doorbladeren). Zelfde velden als listProductionDays. */
export async function shootsInRange(viewer: Viewer, startIso: string, endIso: string) {
  return db
    .select({
      id: productionDays.id,
      title: productionDays.title,
      scheduledOn: productionDays.scheduledOn,
      startTime: productionDays.startTime,
      endTime: productionDays.endTime,
      locationName: productionDays.locationName,
      status: productionDays.status,
      phase: productionDays.phase,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      videographerName: users.fullName,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(users, eq(users.id, productionDays.videographerId))
    .where(
      and(
        isNull(productionDays.deletedAt),
        // Geannuleerde opnames tellen nergens mee (agenda, "eerstvolgende opname").
        ne(productionDays.status, "cancelled"),
        gte(productionDays.scheduledOn, startIso),
        lt(productionDays.scheduledOn, endIso),
        scopeToClients(viewer, productionDays.clientId),
      ),
    )
    .orderBy(asc(productionDays.scheduledOn), asc(productionDays.startTime))
    .limit(500);
}

/** Opnamestatistieken voor één maand (YYYY-MM): hoeveel gepland, afgerond, nog
 *  te doen, en of alle opnames die al hadden moeten plaatsvinden ook echt zijn
 *  uitgevoerd. Data komt uit production_days (gevoed door Google Agenda/Monday). */
export async function getMonthShootStats(viewer: Viewer, month?: string) {
  const m = month ?? new Date().toISOString().slice(0, 7);
  const [y, mm] = m.split("-").map(Number);
  const start = `${m}-01`;
  const next = new Date(Date.UTC(y!, mm!, 1)).toISOString().slice(0, 10); // 1e van de volgende maand

  const [row] = await db
    .select({
      planned: sql<number>`count(*) filter (where ${productionDays.status} <> 'cancelled')`,
      completed: sql<number>`count(*) filter (where ${productionDays.status} = 'completed')`,
      cancelled: sql<number>`count(*) filter (where ${productionDays.status} = 'cancelled')`,
      todo: sql<number>`count(*) filter (where ${productionDays.status} not in ('completed','cancelled'))`,
      pastNotDone: sql<number>`count(*) filter (where ${productionDays.status} not in ('completed','cancelled') and ${productionDays.scheduledOn} < ${today()})`,
    })
    .from(productionDays)
    .where(
      and(
        isNull(productionDays.deletedAt),
        gte(productionDays.scheduledOn, start),
        lt(productionDays.scheduledOn, next),
        scopeToClients(viewer, productionDays.clientId),
      ),
    );

  const planned = Number(row?.planned ?? 0);
  const pastNotDone = Number(row?.pastNotDone ?? 0);
  return {
    month: m,
    planned,
    completed: Number(row?.completed ?? 0),
    cancelled: Number(row?.cancelled ?? 0),
    todo: Number(row?.todo ?? 0),
    pastNotDone,
    allDone: pastNotDone === 0,
  };
}

/** Snelle cijfers voor bovenaan de Opnames-pagina. */
export async function getShootOverview(viewer: Viewer) {
  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const monthStart = new Date().toISOString().slice(0, 7) + "-01";

  const [weekRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(productionDays)
    .where(and(isNull(productionDays.deletedAt), gte(productionDays.scheduledOn, day(0)), lte(productionDays.scheduledOn, day(7)), ne(productionDays.status, "cancelled"), scopeToClients(viewer, productionDays.clientId)));

  const perVideographer = await db
    .select({ name: users.fullName, n: sql<number>`count(*)` })
    .from(productionDays)
    .leftJoin(users, eq(users.id, productionDays.videographerId))
    .where(and(isNull(productionDays.deletedAt), gte(productionDays.scheduledOn, monthStart), ne(productionDays.status, "cancelled"), scopeToClients(viewer, productionDays.clientId)))
    .groupBy(users.fullName)
    .orderBy(desc(sql`count(*)`));

  return {
    thisWeek: Number(weekRow?.n ?? 0),
    perVideographer: perVideographer.map((p) => ({ name: p.name ?? "Niet toegewezen", count: Number(p.n) })),
  };
}

/** De eerstvolgende geplande opname per actieve klant. */
export async function nextShootPerClient(viewer: Viewer) {
  const rows = await db
    .select({
      id: productionDays.id,
      clientId: productionDays.clientId,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      scheduledOn: productionDays.scheduledOn,
      status: productionDays.status,
      videographerId: productionDays.videographerId,
      videographerName: users.fullName,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(users, eq(users.id, productionDays.videographerId))
    .where(
      and(
        isNull(productionDays.deletedAt),
        isNull(clients.deletedAt),
        eq(clients.status, "active"),
        gte(productionDays.scheduledOn, today()),
        ne(productionDays.status, "cancelled"),
        scopeToClients(viewer, productionDays.clientId),
      ),
    )
    .orderBy(asc(productionDays.scheduledOn))
    .limit(400);

  const seen = new Set<string>();
  const out: typeof rows = [];
  for (const r of rows) {
    if (seen.has(r.clientId)) continue;
    seen.add(r.clientId);
    out.push(r);
  }
  return out;
}

export async function getProductionDay(viewer: Viewer, id: string) {
  const [day] = await db
    .select({
      id: productionDays.id,
      clientId: productionDays.clientId,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      title: productionDays.title,
      scheduledOn: productionDays.scheduledOn,
      startTime: productionDays.startTime,
      endTime: productionDays.endTime,
      locationName: productionDays.locationName,
      locationAddress: productionDays.locationAddress,
      status: productionDays.status,
      schedule: productionDays.schedule,
      notes: productionDays.notes,
      driveFolderId: productionDays.driveFolderId,
      frameProjectId: productionDays.frameProjectId,
      videographerName: users.fullName,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(users, eq(users.id, productionDays.videographerId))
    .where(and(eq(productionDays.id, id), isNull(productionDays.deletedAt)))
    .limit(1);

  if (!day) notFound();
  assertClientAccess(viewer, day.clientId);

  const [checklist, dayScripts, videos] = await Promise.all([
    db.select().from(productionChecklistItems)
      .where(eq(productionChecklistItems.productionDayId, id))
      .orderBy(asc(productionChecklistItems.sortOrder)),
    db.select({
      id: scripts.id, title: scripts.title, status: scripts.status,
      pillar: scripts.pillar, presenter: scripts.presenter, requirements: scripts.requirements,
    })
      .from(scripts)
      .where(and(eq(scripts.productionDayId, id), isNull(scripts.deletedAt)))
      .orderBy(asc(scripts.title)),
    db.select({ id: deliverables.id, title: deliverables.title, status: deliverables.status })
      .from(deliverables)
      .where(and(eq(deliverables.productionDayId, id), isNull(deliverables.deletedAt))),
  ]);

  return { day, checklist, scripts: dayScripts, videos };
}

export type ProductionDetail = Awaited<ReturnType<typeof getProductionDay>>;

/** Videografen voor de inline-keuzelijst: expliciete videografen én iedereen
 *  die al eens heeft gefilmd. */
export async function listVideographerOptions(): Promise<{ id: string; fullName: string }[]> {
  const res = await db.execute(sql`
    select u.id, u.full_name as "fullName"
    from users u
    where u.deleted_at is null and u.status = 'active'
      and (u.primary_role = 'videographer' or exists (
        select 1 from production_days p where p.videographer_id = u.id and p.deleted_at is null
      ))
    order by u.full_name
  `);
  return ((res as unknown as { rows?: { id: string; fullName: string }[] }).rows ?? []);
}
