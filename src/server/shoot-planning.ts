import "server-only";
import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { calendarEvents, clients, leaveRequests, productionDays, syncJobs, users } from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";
import { getDefaultVideographer, unplannedClients, type UnplannedClient } from "@/server/productions";
import { nlHolidaySet } from "@/lib/holidays";
import { SHOOT_EVIDENCE_VIDEO_STATUSES, todayAmsterdam } from "@/lib/shoot-status";
import {
  blockFromCalendarTitle,
  computeAvailability,
  type AvailabilityDay,
  type BusyItem,
  type VgRef,
} from "@/lib/shoot-availability";

/**
 * Centrale gegevens voor de Opnameplanning: afgeronde opnames, beschikbaarheid
 * per videograaf, de actualiteit van de Google Agenda-koppeling en de klanten
 * die nog ingepland moeten worden. Alles leest uit dezelfde tabellen als de
 * kalender (production_days, gevoed door de Google Agenda-sync), zodat cijfers
 * en kalender nooit uit elkaar lopen. Er is geen aparte planning.
 */

/* ------------------------------------------------------------------ *
 * 1. Afgeronde opnames
 * ------------------------------------------------------------------ */

/**
 * Zet opnames op Afgerond waarvoor bewijs is dat er gefilmd is (minstens één
 * video van die opname is verder dan "opgenomen"). Alleen opnames op of vóór
 * vandaag; geannuleerde opnames blijven geannuleerd. Idempotent: draait bij
 * elke paginaweergave en na elke agenda-sync, dus de teller loopt vanzelf mee
 * zodra een opname in montage gaat.
 */
export async function reconcileShootCompletion(): Promise<number> {
  const today = todayAmsterdam();
  const evidence = sql.join(SHOOT_EVIDENCE_VIDEO_STATUSES.map((s) => sql`${s}`), sql`, `);
  const res = await db.execute(sql`
    update production_days pd
       set status = 'completed', updated_at = now()
     where pd.deleted_at is null
       and pd.status in ('concept', 'planned', 'confirmed', 'in_progress')
       and pd.scheduled_on <= ${today}
       and exists (
         select 1 from deliverables d
          where d.production_day_id = pd.id
            and d.deleted_at is null
            and d.status::text in (${evidence})
       )
  `);
  return Number((res as unknown as { rowCount?: number }).rowCount ?? 0);
}

/** Opnames uit het verleden die nog op Gepland staan en waar (nog) geen bewijs
 *  voor is. Het team bevestigt die met één klik: Afgerond of Geannuleerd. */
export async function pastShootsToConfirm(viewer: Viewer) {
  const today = todayAmsterdam();
  const from = new Date(Date.now() - 60 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  return db
    .select({
      id: productionDays.id,
      scheduledOn: productionDays.scheduledOn,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .where(
      and(
        isNull(productionDays.deletedAt),
        notInArray(productionDays.status, ["completed", "cancelled"]),
        lt(productionDays.scheduledOn, today),
        gte(productionDays.scheduledOn, from),
        scopeToClients(viewer, productionDays.clientId),
      ),
    )
    .orderBy(productionDays.scheduledOn);
}

/** Aantallen voor de huidige kalenderweek (ma-zo) en kalendermaand. */
export async function shootCounts(viewer: Viewer) {
  const today = todayAmsterdam();
  const d = new Date(`${today}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dow);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const weekStart = monday.toISOString().slice(0, 10);
  const weekEnd = sunday.toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);

  const [row] = await db
    .select({
      week: sql<number>`count(*) filter (where ${productionDays.scheduledOn} between ${weekStart} and ${weekEnd} and ${productionDays.status} <> 'cancelled')`,
      weekLeft: sql<number>`count(*) filter (where ${productionDays.scheduledOn} between ${today} and ${weekEnd} and ${productionDays.status} not in ('cancelled','completed'))`,
      completed: sql<number>`count(*) filter (where ${productionDays.scheduledOn} between ${monthStart} and ${monthEnd} and ${productionDays.status} = 'completed')`,
      cancelled: sql<number>`count(*) filter (where ${productionDays.scheduledOn} between ${monthStart} and ${monthEnd} and ${productionDays.status} = 'cancelled')`,
      plannedMonth: sql<number>`count(*) filter (where ${productionDays.scheduledOn} between ${today} and ${monthEnd} and ${productionDays.status} not in ('cancelled','completed'))`,
    })
    .from(productionDays)
    .where(and(isNull(productionDays.deletedAt), scopeToClients(viewer, productionDays.clientId)));

  return {
    weekStart,
    weekEnd,
    monthEnd,
    week: Number(row?.week ?? 0),
    weekLeft: Number(row?.weekLeft ?? 0),
    completed: Number(row?.completed ?? 0),
    cancelled: Number(row?.cancelled ?? 0),
    plannedMonth: Number(row?.plannedMonth ?? 0),
  };
}

/* ------------------------------------------------------------------ *
 * 2. Actualiteit van de Google Agenda-koppeling
 * ------------------------------------------------------------------ */

export type CalendarFreshness = {
  lastSuccessAt: string | null;
  lastAttemptFailed: boolean;
  lastError: string | null;
  /** True = beschikbaarheid is niet bevestigd door een recente, geslaagde sync. */
  stale: boolean;
};

const STALE_AFTER_MS = 3 * 60 * 60_000;

export async function getCalendarFreshness(): Promise<CalendarFreshness> {
  const [success] = await db
    .select({ at: syncJobs.finishedAt })
    .from(syncJobs)
    .where(and(eq(syncJobs.provider, "google_calendar"), eq(syncJobs.jobType, "calendar.sync"), eq(syncJobs.status, "success")))
    .orderBy(desc(syncJobs.startedAt))
    .limit(1);
  const [latest] = await db
    .select({ status: syncJobs.status, error: syncJobs.error })
    .from(syncJobs)
    .where(and(eq(syncJobs.provider, "google_calendar"), eq(syncJobs.jobType, "calendar.sync"), or(eq(syncJobs.status, "success"), eq(syncJobs.status, "error"))))
    .orderBy(desc(syncJobs.startedAt))
    .limit(1);
  const lastSuccessAt = success?.at ? new Date(success.at).toISOString() : null;
  const lastAttemptFailed = latest?.status === "error";
  const stale = !lastSuccessAt || Date.now() - Date.parse(lastSuccessAt) > STALE_AFTER_MS || lastAttemptFailed;
  let lastError: string | null = null;
  if (lastAttemptFailed && latest?.error) {
    lastError = /invalid_grant|toestemming/i.test(latest.error)
      ? "Google vraagt opnieuw toestemming voor de agenda-koppeling."
      : latest.error.replace(/^Error:\s*/, "").slice(0, 160);
  }
  return { lastSuccessAt, lastAttemptFailed, lastError, stale };
}

/* ------------------------------------------------------------------ *
 * 3. Beschikbaarheid per videograaf
 * ------------------------------------------------------------------ */

/** Videografen: Rutger (standaard), Jarno en eventuele freelance videografen. */
export async function listVideographers(): Promise<VgRef[]> {
  const rows = await db
    .select({ id: users.id, name: users.fullName, email: users.email, role: users.primaryRole })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        eq(users.status, "active"),
        or(eq(users.primaryRole, "videographer"), inArray(users.email, ["rutger@shortclips.nl", "jarno@shortclips.nl"])),
      ),
    );
  const rank = (e: string) => (e === "rutger@shortclips.nl" ? 0 : e === "jarno@shortclips.nl" ? 1 : 2);
  return rows
    .sort((a, b) => rank(a.email.toLowerCase()) - rank(b.email.toLowerCase()) || a.name.localeCompare(b.name, "nl"))
    // Jarno draait opnames incidenteel en heeft geen eigen agenda met zijn
    // bezetting in de koppeling: hij telt niet mee als vaste capaciteit.
    .map((r) => ({ id: r.id, name: r.name.split(" ")[0]!, countsForCapacity: r.email.toLowerCase() !== "jarno@shortclips.nl" }));
}

export type ShootAvailability = {
  videographers: VgRef[];
  days: AvailabilityDay[];
  weekEnd: string;
  monthEnd: string;
};

/**
 * Beschikbaarheid van vandaag t/m het einde van de maand (en minstens t/m
 * vrijdag van deze week). Bronnen: opnames (met tijden uit Google Agenda),
 * goedgekeurd verlof, afwezigheid of sluiting in de agenda en feestdagen.
 * Geannuleerde opnames tellen niet mee.
 */
export async function getShootAvailability(): Promise<ShootAvailability> {
  const today = todayAmsterdam();
  const t = new Date(`${today}T12:00:00Z`);
  const friday = new Date(t);
  friday.setUTCDate(t.getUTCDate() + ((5 - t.getUTCDay() + 7) % 7));
  const weekEnd = friday.toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const to = weekEnd > monthEnd ? weekEnd : monthEnd;

  const [videographers, defaultVg] = await Promise.all([listVideographers(), getDefaultVideographer()]);
  const vgIds = new Set(videographers.map((v) => v.id));

  const shootRows = await db.execute(sql`
    select pd.scheduled_on::text as date,
           coalesce(pd.videographer_id, ${defaultVg?.id ?? null}::uuid)::text as vg,
           to_char(pd.start_time, 'HH24:MI') as start,
           coalesce(
             to_char(pd.end_time, 'HH24:MI'),
             (select to_char(max(ce.ends_at) at time zone 'Europe/Amsterdam', 'HH24:MI')
                from calendar_mappings m
                join calendar_events ce on ce.id::text = m.item_id
               where m.entity_type = 'calendar_shoot' and m.entity_id = pd.id
                 and ce.status is distinct from 'cancelled'
                 and (ce.ends_at at time zone 'Europe/Amsterdam')::date = pd.scheduled_on)
           ) as "end",
           c.name as client
      from production_days pd
      join clients c on c.id = pd.client_id
     where pd.deleted_at is null
       and pd.status <> 'cancelled'
       and pd.scheduled_on between ${today} and ${to}
  `);
  type ShootRow = { date: string; vg: string | null; start: string | null; end: string | null; client: string };
  const shoots = ((shootRows as unknown as { rows?: ShootRow[] }).rows ?? []) as ShootRow[];

  const busy: BusyItem[] = [];
  for (const s of shoots) {
    if (!s.vg || !vgIds.has(s.vg)) continue;
    busy.push({ videographerId: s.vg, date: s.date.slice(0, 10), start: s.start, end: s.end && s.start && s.end > s.start ? s.end : null, label: s.client, kind: "opname" });
  }

  // Goedgekeurd verlof.
  const leaves = vgIds.size === 0 ? [] : await db
    .select({ userId: leaveRequests.userId, startOn: leaveRequests.startOn, endOn: leaveRequests.endOn })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.status, "approved"), lte(leaveRequests.startOn, to), gte(leaveRequests.endOn, today), inArray(leaveRequests.userId, [...vgIds])));
  for (const l of leaves) {
    for (let d = String(l.startOn).slice(0, 10); d <= String(l.endOn).slice(0, 10); ) {
      if (d >= today && d <= to) busy.push({ videographerId: l.userId, date: d, start: null, end: null, label: "Verlof", kind: "blokkade" });
      const n = new Date(`${d}T12:00:00Z`);
      n.setUTCDate(n.getUTCDate() + 1);
      d = n.toISOString().slice(0, 10);
    }
  }

  // Afwezigheid of sluiting in Google Agenda ("Rutger vrij", "Kantoor gesloten").
  // Het team zet dit vaak als korte markering om 07:00, daarom geldt het voor de hele dag.
  const evs = await db
    .select({ title: calendarEvents.title, startsAt: calendarEvents.startsAt })
    .from(calendarEvents)
    .where(
      and(
        sql`${calendarEvents.status} is distinct from 'cancelled'`,
        isNull(calendarEvents.dismissedAt),
        ne(calendarEvents.kind, "opname"),
        gte(calendarEvents.startsAt, new Date(`${today}T00:00:00Z`)),
        lte(calendarEvents.startsAt, new Date(`${to}T23:59:59Z`)),
      ),
    );
  for (const e of evs) {
    const block = blockFromCalendarTitle(e.title, videographers);
    if (!block) continue;
    const date = e.startsAt.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
    busy.push({ videographerId: block.videographerId, date, start: null, end: null, label: block.label, kind: "blokkade" });
  }

  const nowParts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Amsterdam" });
  const [hh, mm] = nowParts.split(":").map(Number);
  const days = computeAvailability({
    from: today,
    to,
    today,
    nowMinutes: (hh ?? 0) * 60 + (mm ?? 0),
    videographers,
    busy,
    holidays: nlHolidaySet(),
  });
  return { videographers, days, weekEnd, monthEnd };
}

/* ------------------------------------------------------------------ *
 * 4. Nog in te plannen opnames
 * ------------------------------------------------------------------ */

export type PlanningCandidate = UnplannedClient & {
  coordinatorName: string | null;
  videographerName: string | null;
  /** Eerste beschikbare dag binnen (of na) de gewenste periode, als die er is. */
  suggestedDate: string | null;
};

/** Klanten zonder volgende opname, aangevuld met contentcreator, videograaf en
 *  een voorstel voor de eerste beschikbare dag. Bouwt op unplannedClients
 *  (dezelfde regels als voorheen: ritme uit pakket, historie of maandelijks). */
export async function planningCandidates(viewer: Viewer, availability: ShootAvailability): Promise<PlanningCandidate[]> {
  const list = await unplannedClients(viewer);
  if (list.length === 0) return [];
  const [defaultVg, people] = await Promise.all([
    getDefaultVideographer(),
    db.execute(sql`
      select c.id, co.full_name as coordinator, vg.full_name as vg
        from clients c
        left join users co on co.id = c.coordinator_id
        left join users vg on vg.id = c.videographer_id
       where c.id in (${sql.join(list.map((l) => sql`${l.clientId}::uuid`), sql`, `)})
    `).then((r) => ((r as unknown as { rows?: { id: string; coordinator: string | null; vg: string | null }[] }).rows ?? [])),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const today = todayAmsterdam();
  return list.map((c) => {
    const p = byId.get(c.clientId);
    const vgName = p?.vg ?? defaultVg?.fullName ?? null;
    const vgFirst = vgName?.split(" ")[0] ?? null;
    const earliest = c.windowFrom && c.windowFrom > today ? c.windowFrom : today;
    // Voorkeur: een vrije dag van de vaste videograaf van de klant. Is die geen
    // vaste capaciteit (bijv. Jarno), dan de eerste dag waarop iemand vrij is.
    const ownCounts = availability.videographers.some((v) => v.name === vgFirst && v.countsForCapacity !== false);
    const free = availability.days.find(
      (d) => d.date >= earliest && d.perVg.some((v) => v.state === "beschikbaar" && (!vgFirst || !ownCounts || v.name === vgFirst)),
    );
    return {
      ...c,
      coordinatorName: p?.coordinator ?? null,
      videographerName: vgName,
      suggestedDate: free?.date ?? null,
    };
  });
}
