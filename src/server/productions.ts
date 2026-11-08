import "server-only";
import { clientIsActive } from "@/server/client-activity";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clientPackages,
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
      // Gekoppelde scripts, zodat de agenda direct een "open script"-knop kan
      // tonen: bij precies één script een directe link, bij meer de opnamedetail.
      scriptCount: sql<number>`(select count(*) from scripts sc where sc.production_day_id = production_days.id and sc.deleted_at is null)`,
      scriptId: sql<string | null>`(select sc.id from scripts sc where sc.production_day_id = production_days.id and sc.deleted_at is null order by sc.created_at asc limit 1)`,
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
 *  uitgevoerd. Data komt uit production_days (gevoed door Google Agenda). */
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

  const [perVideographer, defaultVg] = await Promise.all([
    db
      .select({ name: users.fullName, avatar: users.avatarUrl, n: sql<number>`count(*)` })
      .from(productionDays)
      .leftJoin(users, eq(users.id, productionDays.videographerId))
      .where(and(isNull(productionDays.deletedAt), gte(productionDays.scheduledOn, monthStart), ne(productionDays.status, "cancelled"), scopeToClients(viewer, productionDays.clientId)))
      .groupBy(users.fullName, users.avatarUrl)
      .orderBy(desc(sql`count(*)`)),
    getDefaultVideographer(),
  ]);

  // Opnamedagen zonder gekoppelde videograaf tellen bij de standaard-videograaf
  // (Rutger), zodat deze telling klopt met de tabel die hem ook invult.
  const merged = new Map<string, { count: number; avatarUrl: string | null }>();
  for (const p of perVideographer) {
    const name = p.name ?? defaultVg?.fullName ?? "Niet toegewezen";
    const avatarUrl = p.name ? p.avatar : defaultVg?.avatarUrl ?? null;
    const cur = merged.get(name);
    merged.set(name, { count: (cur?.count ?? 0) + Number(p.n), avatarUrl: cur?.avatarUrl ?? avatarUrl });
  }

  return {
    thisWeek: Number(weekRow?.n ?? 0),
    perVideographer: [...merged.entries()].map(([name, v]) => ({ name, count: v.count, avatarUrl: v.avatarUrl })).sort((a, b) => b.count - a.count),
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
      scriptingStatus: productionDays.scriptingStatus,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(users, eq(users.id, productionDays.videographerId))
    .where(
      and(
        isNull(productionDays.deletedAt),
        isNull(clients.deletedAt),
        clientIsActive(),
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
/**
 * De standaard-videograaf (Rutger). Vrijwel elke opname draait hij; als een
 * opnamedag nog geen videograaf gekoppeld heeft, tonen we Rutger als
 * standaard in plaats van een "nog geen videograaf"-melding. Een expliciet
 * gekozen andere videograaf blijft uiteraard voorrang houden.
 */
export async function getDefaultVideographer(): Promise<{ id: string; fullName: string; avatarUrl: string | null } | null> {
  const [r] = await db
    .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(and(eq(users.email, "rutger@shortclips.nl"), isNull(users.deletedAt), eq(users.status, "active")))
    .limit(1);
  return r ?? null;
}

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

/* ----------------------- Nog niet ingepland ----------------------- */

/** Prioriteit van een klant zonder volgende opname, van urgent naar rustig. */
export type UnplannedPriority = "eerste" | "achterstallig" | "nu" | "binnenkort";

export type UnplannedClient = {
  clientId: string;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  /** Laatste (niet-geannuleerde) opname vóór vandaag, of null als er nog nooit één was. */
  lastShootOn: string | null;
  /** Ritme in dagen tussen opnames (pakket → historie → standaard 30). */
  intervalDays: number;
  /** Waar het ritme vandaan komt, voor de uitleg in de lijst. */
  intervalSource: "pakket" | "historie" | "standaard";
  /** Gewenste periode voor de volgende opname [from, to] (YYYY-MM-DD). */
  windowFrom: string | null;
  windowTo: string | null;
  /** Uiterste datum om in te plannen: 14 dagen vóór de gewenste opname,
   *  zodat er tijd is voor scripting (fase start op −14d). */
  planBy: string | null;
  priority: UnplannedPriority;
  /** Dagen te laat t.o.v. de gewenste opnamedatum (alleen bij achterstallig). */
  daysLate: number;
};

const PRIORITY_ORDER: Record<UnplannedPriority, number> = { eerste: 0, achterstallig: 1, nu: 2, binnenkort: 3 };
const SCRIPTING_LEAD_DAYS = 14;
const WINDOW_HALF_DAYS = 7;

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(aIso: string, bIso: string): number {
  return Math.round((Date.parse(`${bIso}T12:00:00Z`) - Date.parse(`${aIso}T12:00:00Z`)) / 86_400_000);
}
function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/**
 * Actieve klanten zonder ingeplande volgende opname. Een klant verdwijnt hier
 * automatisch uit zodra er een opnamedag op of na vandaag staat (ook als die
 * via de Google Agenda-sync binnenkomt). Respecteert de klantscope van de
 * viewer, dus iedereen ziet alleen klanten waar hij/zij toegang toe heeft.
 *
 * Gewenste periode: laatste opname + ritme (± 7 dagen). Het ritme komt uit het
 * actieve pakket (opnamedagen per maand), anders uit de mediane tussenpoos van
 * minimaal 3 eerdere opnamemomenten, anders standaard maandelijks.
 */
export async function unplannedClients(viewer: Viewer): Promise<UnplannedClient[]> {
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

  const candidates = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      color: clients.color,
      logo: clients.logoUrl,
    })
    .from(clients)
    .where(
      and(
        isNull(clients.deletedAt),
        clientIsActive(),
        sql`(${clients.endedOn} is null or ${clients.endedOn} > ${todayIso})`,
        sql`not exists (
          select 1 from production_days pd
          where pd.client_id = ${clients.id} and pd.deleted_at is null
            and pd.status <> 'cancelled' and pd.scheduled_on >= ${todayIso}
        )`,
        scopeToClients(viewer, clients.id),
      ),
    );
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const [history, packages] = await Promise.all([
    db
      .select({ clientId: productionDays.clientId, scheduledOn: productionDays.scheduledOn })
      .from(productionDays)
      .where(
        and(
          isNull(productionDays.deletedAt),
          ne(productionDays.status, "cancelled"),
          lt(productionDays.scheduledOn, todayIso),
          inArray(productionDays.clientId, ids),
        ),
      )
      .orderBy(desc(productionDays.scheduledOn)),
    db
      .select({ clientId: clientPackages.clientId, shootDays: clientPackages.shootDaysPerMonth })
      .from(clientPackages)
      .where(and(eq(clientPackages.isActive, true), inArray(clientPackages.clientId, ids))),
  ]);

  const pastByClient = new Map<string, string[]>();
  for (const h of history) {
    const list = pastByClient.get(h.clientId) ?? [];
    const iso = toIso(h.scheduledOn);
    // Meerdaagse opnames (dagen binnen 3 dagen van elkaar) tellen als één
    // opnamemoment; max 7 recente momenten. Lijst is aflopend gesorteerd.
    const prev = list[list.length - 1];
    if ((!prev || daysBetween(iso, prev) > 3) && list.length < 7) list.push(iso);
    pastByClient.set(h.clientId, list);
  }
  const shootDaysByClient = new Map<string, number>();
  for (const p of packages) shootDaysByClient.set(p.clientId, Math.max(shootDaysByClient.get(p.clientId) ?? 0, Number(p.shootDays ?? 0)));

  const out: UnplannedClient[] = candidates.map((c) => {
    const past = pastByClient.get(c.id) ?? [];
    const last = past[0] ?? null;

    let intervalDays = 30;
    let intervalSource: UnplannedClient["intervalSource"] = "standaard";
    const perMonth = shootDaysByClient.get(c.id) ?? 0;
    if (perMonth > 0) {
      intervalDays = Math.round(30 / perMonth);
      intervalSource = "pakket";
    } else if (past.length >= 3) {
      // Pas vanaf 3 opnamemomenten is de historie betrouwbaar genoeg; geclamped
      // op 2 weken t/m 2 maanden zodat één uitschieter het ritme niet bepaalt.
      const gaps = past.slice(0, -1).map((d, i) => daysBetween(past[i + 1]!, d)).sort((a, b) => a - b);
      const median = gaps[Math.floor(gaps.length / 2)]!;
      intervalDays = Math.min(60, Math.max(14, median));
      intervalSource = "historie";
    }

    if (!last) {
      return {
        clientId: c.id, clientName: c.name, clientSlug: c.slug, clientColor: c.color, clientLogo: c.logo,
        lastShootOn: null, intervalDays, intervalSource,
        windowFrom: null, windowTo: null, planBy: null, priority: "eerste", daysLate: 0,
      };
    }

    const due = addDaysIso(last, intervalDays);
    const windowFrom = addDaysIso(due, -WINDOW_HALF_DAYS);
    const windowTo = addDaysIso(due, WINDOW_HALF_DAYS);
    const planBy = addDaysIso(due, -SCRIPTING_LEAD_DAYS);
    const daysLate = Math.max(0, daysBetween(due, todayIso));
    const priority: UnplannedPriority = due < todayIso ? "achterstallig" : planBy <= todayIso ? "nu" : "binnenkort";

    return {
      clientId: c.id, clientName: c.name, clientSlug: c.slug, clientColor: c.color, clientLogo: c.logo,
      lastShootOn: last, intervalDays, intervalSource, windowFrom, windowTo, planBy, priority, daysLate,
    };
  });

  // Eerst de urgentste: nooit gefilmd → achterstallig (langst te laat eerst) →
  // nu inplannen → binnenkort (vroegste gewenste datum eerst).
  return out.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      b.daysLate - a.daysLate ||
      (a.windowFrom ?? "").localeCompare(b.windowFrom ?? "") ||
      a.clientName.localeCompare(b.clientName, "nl"),
  );
}
