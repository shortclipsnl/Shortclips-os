import "server-only";
import { and, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  capacityParams,
  capacityPeople,
  clientPackages,
  clients,
  deliverables,
  leaveRequests,
  productionDays,
  users,
} from "@/db/schema";
import { nlHolidaySet } from "@/lib/holidays";
import {
  DEFAULT_RADAR_SETTINGS,
  addDays,
  mondayOf,
  videosPerShoot,
  type ProjectStatus,
  type RadarInput,
  type RadarPerson,
  type RadarProject,
  type RadarSettings,
  type RadarShoot,
} from "@/lib/capacity-radar";

/**
 * Laadt alle invoer voor de capaciteitsradar uit bestaande portaaldata.
 * Leest alleen: er wordt niets geschreven of gewijzigd.
 *
 *  - Opnames: production_days (gevuld vanuit Google Agenda), met videograaf en editor.
 *  - Editingwerk: deliverables met een lopende status (Editingpagina).
 *  - Capaciteit: capacity_people (per persoon instelbaar door de eigenaar).
 *  - Afwezigheid: goedgekeurd verlof + ingevulde beschikbaarheidsperiodes.
 *  - Feestdagen: Nederlandse feestdagen.
 */

export const RADAR_MODEL_WEEKS = 12;

const RADAR_PARAM_KEYS = {
  radar_green: "green",
  radar_red: "red",
  radar_extra_shoot: "extraPerShoot",
  radar_avg_shoot: "avgShootHours",
} as const;
const DEFAULT_SHOOT_HOURS = 3;
const DEFAULT_TRAVEL_HOURS = 1;
const HOURS_PER_DAY = 8;

const STATUS_MAP: Record<string, ProjectStatus | null> = {
  recorded: "beschikbaar",
  footage_upload: "beschikbaar",
  awaiting_editor: "beschikbaar",
  editing: "bezig",
  internal_review: "intern",
  editor_revision: "feedback",
  client_review: "klant",
  client_revision: "feedback",
};
const ACTIVE_STATUSES = Object.keys(STATUS_MAP) as (keyof typeof STATUS_MAP)[];
const PLACEHOLDER = new Set(["recorded", "footage_upload", "awaiting_editor"]);

export function amsterdamToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

function hoursBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const h = eh + em / 60 - (sh + sm / 60);
  return h > 0 && h < 14 ? Math.round(h * 4) / 4 : null;
}

const firstName = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
const num = (v: string | number | null | undefined) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function loadRadarSettings(): Promise<RadarSettings> {
  const rows = await db.select({ key: capacityParams.key, value: capacityParams.value }).from(capacityParams).where(inArray(capacityParams.key, Object.keys(RADAR_PARAM_KEYS)));
  const s: RadarSettings = { ...DEFAULT_RADAR_SETTINGS, weights: { ...DEFAULT_RADAR_SETTINGS.weights } };
  for (const r of rows) {
    const k = RADAR_PARAM_KEYS[r.key as keyof typeof RADAR_PARAM_KEYS];
    const v = num(r.value);
    if (k && v != null && v > 0) s[k] = v;
  }
  return s;
}

export type RadarData = RadarInput & {
  /** Klant-slug per opname-id, voor links naar de opname. */
  generatedAt: string;
  /** Per persoon: koppeling naar capacity_people (voor de eigenaar om in te vullen). */
  capacityRowByPerson: Record<string, { id: string; unit: string; limitMax: number | null } | null>;
};

export async function loadRadarData(): Promise<RadarData> {
  const today = amsterdamToday();
  const from = addDays(mondayOf(today), -42);
  const to = addDays(mondayOf(today), RADAR_MODEL_WEEKS * 7 + 14);

  const [settings, dayRows, projRows, capRows, userRows, pkgRows, leaveRows] = await Promise.all([
    loadRadarSettings(),
    db
      .select({
        id: productionDays.id,
        title: productionDays.title,
        date: productionDays.scheduledOn,
        start: productionDays.startTime,
        end: productionDays.endTime,
        vg: productionDays.videographerId,
        editor: productionDays.editorId,
        planned: productionDays.plannedShorts,
        clientId: productionDays.clientId,
        clientName: clients.name,
        clientSlug: clients.slug,
        quota: clients.monthlyVideoQuota,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(and(isNull(productionDays.deletedAt), ne(productionDays.status, "cancelled"), gte(productionDays.scheduledOn, from), lte(productionDays.scheduledOn, to))),
    db
      .select({
        id: deliverables.id,
        status: deliverables.status,
        editor: deliverables.editorId,
        planned: deliverables.plannedShorts,
        frameAsset: deliverables.frameAssetId,
        shootOn: deliverables.shootOn,
        dayId: deliverables.productionDayId,
        dayDate: productionDays.scheduledOn,
        clientName: clients.name,
        createdAt: deliverables.createdAt,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(productionDays, eq(productionDays.id, deliverables.productionDayId))
      .where(and(isNull(deliverables.deletedAt), inArray(deliverables.status, ACTIVE_STATUSES as never[]))),
    db.select().from(capacityPeople),
    db
      .select({ id: users.id, name: users.fullName, role: users.primaryRole, status: users.status, periods: users.availabilityPeriods })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.status, "active"))),
    db
      .select({ clientId: clientPackages.clientId, videos: clientPackages.videosPerMonth })
      .from(clientPackages)
      .where(eq(clientPackages.isActive, true)),
    db
      .select({ userId: leaveRequests.userId, from: leaveRequests.startOn, to: leaveRequests.endOn, kind: leaveRequests.kind })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.status, "approved"), lte(leaveRequests.startOn, to), or(gte(leaveRequests.endOn, from)))),
  ]);

  const pkg = new Map<string, number>();
  for (const p of pkgRows) if (p.videos > 0) pkg.set(p.clientId, Math.max(pkg.get(p.clientId) ?? 0, p.videos));

  // Editingprojecten per opname: voor aantal video's en ontbrekende editor.
  const projByDay = new Map<string, typeof projRows>();
  for (const p of projRows) if (p.dayId) projByDay.set(p.dayId, [...(projByDay.get(p.dayId) ?? []), p]);

  const shoots: RadarShoot[] = dayRows.map((d) => {
    const linked = projByDay.get(d.id) ?? [];
    const fromTitle = Number(d.title.match(/(\d{1,2})\s*shorts?/i)?.[1] ?? NaN);
    const planned = d.planned ?? (Number.isFinite(fromTitle) ? fromTitle : null) ?? linked.find((p) => p.planned)?.planned ?? null;
    const v = videosPerShoot(planned, pkg.get(d.clientId) ?? d.quota);
    return {
      id: d.id,
      date: String(d.date).slice(0, 10),
      start: d.start ? d.start.slice(0, 5) : null,
      durationH: hoursBetween(d.start, d.end) ?? DEFAULT_SHOOT_HOURS,
      travelH: DEFAULT_TRAVEL_HOURS,
      clientName: d.clientName,
      clientSlug: d.clientSlug,
      videographerId: d.vg,
      editorId: d.editor ?? linked.find((p) => p.editor)?.editor ?? null,
      videos: v.videos,
      videosSource: v.source,
    };
  });
  const shootById = new Map(shoots.map((s) => [s.id, s]));

  const projects: RadarProject[] = [];
  for (const p of projRows) {
    const status = STATUS_MAP[p.status];
    if (!status || !p.editor) continue;
    const shootOn = String(p.shootOn ?? p.dayDate ?? p.createdAt.toISOString()).slice(0, 10);
    // Een editingproject dat al klaarstaat voor een opname die nog moet komen, is
    // nog geen echt werk: dat wordt voorspeld vanuit de opname zelf.
    if (PLACEHOLDER.has(p.status) && shootOn >= today) continue;
    const shoot = p.dayId ? shootById.get(p.dayId) : undefined;
    const videos = p.frameAsset ? 1 : p.planned ?? shoot?.videos ?? 8;
    projects.push({ id: p.id, batchId: p.dayId ?? p.id, clientName: p.clientName, editorId: p.editor, videos, status, shootOn });
  }

  // Mensen: iedereen met werk in beeld, plus actieve editors en videografen.
  const userById = new Map(userRows.map((u) => [u.id, u]));
  const capFor = (userId: string | null, name: string) =>
    capRows.find((c) => c.userId && c.userId === userId) ??
    capRows.find((c) => !c.userId && (firstName(c.name) === firstName(name) || (c.aliases ?? "").toLowerCase().split(",").map((x) => x.trim()).includes(firstName(name))));

  const absencesFor = (userId: string) => {
    const out: RadarPerson["absences"] = leaveRows.filter((l) => l.userId === userId).map((l) => ({ from: String(l.from).slice(0, 10), to: String(l.to).slice(0, 10), label: l.kind }));
    const u = userById.get(userId);
    for (const p of u?.periods ?? []) if (p.from) out.push({ from: p.from.slice(0, 10), to: (p.to ?? p.from).slice(0, 10), label: p.label ?? "Niet beschikbaar" });
    return out;
  };

  const people: RadarPerson[] = [];
  const capacityRowByPerson: RadarData["capacityRowByPerson"] = {};
  const seen = new Set<string>();

  const makePerson = (id: string, name: string, kind: "video" | "edit", userId: string | null): RadarPerson => {
    const cap = userId ? capFor(userId, name) : capRows.find((c) => c.id === id.replace(/^cp:/, ""));
    let hoursPerWeek: number | null = null, daysPerWeek: number | null = null, videosPerWeek: number | null = null;
    if (kind === "video" && cap) {
      const days = num(cap.workdaysPerWeek);
      const max = num(cap.limitMax);
      if (days && days > 0) { daysPerWeek = days; hoursPerWeek = days * HOURS_PER_DAY; }
      else if (cap.unit === "opnames_4w" && max) hoursPerWeek = (max / 4) * settings.avgShootHours;
    }
    if (kind === "edit" && cap && cap.unit === "shorts_4w") {
      const max = num(cap.limitMax);
      if (max) videosPerWeek = Math.round((max / 4) * 10) / 10;
    }
    capacityRowByPerson[id] = cap ? { id: cap.id, unit: cap.unit, limitMax: num(cap.limitMax) } : null;
    const employment = (cap?.employment ?? (kind === "edit" ? "freelance" : "vast")) === "vast" ? "vast" : "freelance";
    // De eigenaar filmt alleen bij uitzondering: zijn uren tellen niet mee als
    // teamcapaciteit en hij wordt nooit automatisch voorgesteld. Hetzelfde geldt
    // voor freelancers zonder portaalaccount: die kun je (nog) niet inplannen.
    const founder = /founder|eigenaar/i.test(cap?.role ?? "") || userById.get(userId ?? "")?.role === "owner";
    return { id, name: name.split(" ")[0], kind, employment, group: userId ? "vast" : "pool", hoursPerWeek, daysPerWeek, videosPerWeek, absences: userId ? absencesFor(userId) : [], assignable: !!userId && !founder, inTeam: !!userId && !founder };
  };

  const addUser = (userId: string, kind: "video" | "edit") => {
    if (seen.has(userId)) return;
    const u = userById.get(userId);
    if (!u) return;
    seen.add(userId);
    people.push(makePerson(userId, u.name, kind, userId));
  };

  // 1. Wie er nu werk heeft (ook als de rol in het portaal anders staat).
  for (const s of shoots) if (s.videographerId && s.date >= today) addUser(s.videographerId, "video");
  for (const s of shoots) if (s.editorId && s.date >= today) addUser(s.editorId, "edit");
  for (const p of projects) addUser(p.editorId, "edit");
  // 2. Actieve editors en videografen zonder werk (om aan te kunnen toewijzen).
  for (const u of userRows) if (u.role === "editor") addUser(u.id, "edit");
  for (const u of userRows) if (u.role === "videographer") addUser(u.id, "video");
  // 3. Freelancers die alleen in de capaciteitslijst staan (nog geen account).
  for (const c of capRows) {
    if (c.userId || seen.has(`cp:${c.id}`)) continue;
    const kind = c.unit === "opnames_4w" ? "video" : c.unit === "shorts_4w" ? "edit" : null;
    if (!kind || !num(c.limitMax)) continue;
    if (people.some((p) => firstName(p.name) === firstName(c.name))) continue;
    seen.add(`cp:${c.id}`);
    const display = c.name.match(/\(([^)]+)\)/)?.[1]?.trim() || c.name.replace(/freelance videograaf/i, "").trim() || c.name;
    people.push(makePerson(`cp:${c.id}`, display, kind, null));
  }

  // Werk van mensen die niet (meer) in beeld zijn, wordt niet weggegooid maar
  // komt bij "nog geen videograaf" terecht (zie engine).
  const known = new Set(people.map((p) => p.id));
  for (const s of shoots) {
    if (s.videographerId && !known.has(s.videographerId)) s.videographerId = null;
    if (s.editorId && !known.has(s.editorId)) s.editorId = null;
  }

  const years = [Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1];
  return {
    today,
    weeks: RADAR_MODEL_WEEKS,
    people,
    shoots,
    projects,
    holidays: [...nlHolidaySet(years)],
    settings,
    generatedAt: new Date().toISOString(),
    capacityRowByPerson,
  };
}
