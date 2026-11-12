import "server-only";
import { and, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { capacityParams, capacityPeople, clients, leaveRequests, productionDays, users } from "@/db/schema";
import { clientColumnStatusFilter, clientIsActive } from "@/server/client-activity";
import { editorIdsByKey } from "@/server/editing/integrity";
import { firstNameKey } from "@/lib/editors";
import { nlHolidaySet } from "@/lib/holidays";
import { addWorkingDays } from "@/lib/workdays";
import { EDITOR_LEAD_DAYS, CLIENT_LEAD_DAYS } from "@/lib/edit-deadline";

/**
 * Capaciteitsradar: haalt alles wat de rekenmotor (lib/capacity-engine) nodig
 * heeft uit bestaande tabellen. Er wordt niets opgeslagen of gewijzigd; de
 * radar is daardoor altijd zo actueel als Opnames, Editing, Klanten en Vakantie.
 *
 *  - Opnames: production_days (uit Google Agenda), met videograaf, editor,
 *    start- en eindtijd, geplande shorts en editingfase.
 *  - Editors: capacity_people (eenheid shorts per 4 weken) → video's per week.
 *  - Videografen: capacity_people (werkdagen per week, of opnames per 4 weken).
 *  - Verlof: goedgekeurde leave_requests.
 *  - Pakketten: clients.monthly_video_quota en de vaste editor (editor_name).
 */

export type CapPerson = {
  id: string;
  name: string;
  short?: string;
  role: "videograaf" | "editor";
  employment: "vast" | "freelance";
  hoursPerDay?: number;
  dayMax?: number;
  maxShootsPerDay?: number;
  shortsPerWeek?: number | null;
  pattern: number[] | null;
  leave: [string, string][];
  capacityNote?: string;
};

export type CapacityData = {
  today: string;
  holidays: string[];
  people: CapPerson[];
  clients: { id: string; name: string; quota: number; shootsPerMonth: number; editor: string | null; lastVg?: string | null; lastDate?: string | null; lastDur?: number; lastTravel?: number }[];
  shoots: { id: string; date: string; client: string; clientName: string; start: string | null; dur: number; travel: number; vg: string | null; shorts: number; editor: string | null; estimated: boolean }[];
  projects: { id: string; shootDate: string; client: string; clientName: string; editor: string | null; c: Record<string, number>; editorDue: string; clientDue: string }[];
  settings: { greenBelow: number; orangeMax: number; defaultTravel: number; defaultShootHours: number };
  generatedAt: string;
};

const PHASE_TO_KEY: Record<string, string> = {
  te_plannen: "beschikbaar",
  in_edit: "bezig",
  interne_controle: "review",
  bij_klant: "bijKlant",
  feedback_verwerken: "feedback",
};

const todayAms = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (s: string) => {
  const d = new Date(`${s}T12:00:00Z`);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDays(s, 1 - dow);
};
const hoursBetween = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  const h = (bh! * 60 + bm! - (ah! * 60 + am!)) / 60;
  return h > 0 && h < 14 ? Math.round(h * 4) / 4 : null;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

export async function loadCapacityData(): Promise<CapacityData> {
  const today = todayAms();
  const holidaysSet = nlHolidaySet();
  const from = addDays(mondayOf(today), -60); // lopende editingprojecten
  const until = addDays(today, 140); // ruim voorbij 3 maanden vooruit

  const [paramRows, capRows, pdRows, clientRows, editorByKey] = await Promise.all([
    db.select().from(capacityParams),
    db.select().from(capacityPeople),
    db
      .select({
        id: productionDays.id,
        date: productionDays.scheduledOn,
        start: productionDays.startTime,
        end: productionDays.endTime,
        clientId: productionDays.clientId,
        clientName: clients.name,
        quota: clients.monthlyVideoQuota,
        vg: productionDays.videographerId,
        editor: productionDays.editorId,
        editStatus: productionDays.editStatus,
        plannedShorts: productionDays.plannedShorts,
        editDueOn: productionDays.editDueOn,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(
        and(
          isNull(productionDays.deletedAt),
          ne(productionDays.status, "cancelled"),
          gte(productionDays.scheduledOn, from),
          lte(productionDays.scheduledOn, until),
          clientColumnStatusFilter(productionDays.clientId, "actief"),
        ),
      ),
    db
      .select({ id: clients.id, name: clients.name, quota: clients.monthlyVideoQuota, editorName: clients.editorName })
      .from(clients)
      .where(and(clientIsActive(), isNull(clients.deletedAt))),
    editorIdsByKey(),
  ]);

  const P = new Map(paramRows.map((p) => [p.key, num(p.value)]));
  const settings = {
    greenBelow: P.get("cap_green_below") ?? 80,
    orangeMax: P.get("cap_orange_max") ?? 100,
    defaultTravel: P.get("cap_reistijd_uur") ?? 1,
    defaultShootHours: P.get("cap_opnameduur_uur") ?? 3,
  };

  // ---------- opnames en lopende projecten ----------
  const shoots: CapacityData["shoots"] = [];
  const projects: CapacityData["projects"] = [];
  const lastByClient = new Map<string, { vg: string | null; date: string; dur: number; travel: number }>();
  const weekStart = mondayOf(today);

  for (const r of pdRows.sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const durRaw = hoursBetween(r.start as string | null, r.end as string | null);
    const dur = durRaw ?? settings.defaultShootHours;
    const travel = settings.defaultTravel;
    const planned = num(r.plannedShorts);
    const shorts = planned ?? (num(r.quota) || 6);
    const estimated = planned === null;
    lastByClient.set(r.clientId, { vg: r.vg, date: r.date, dur, travel });

    // Videografie: alle opnames vanaf maandag van deze week.
    if (r.date >= weekStart) {
      shoots.push({
        id: r.id, date: r.date, client: r.clientId, clientName: r.clientName,
        start: r.start ? String(r.start).slice(0, 5) : null, dur, travel, vg: r.vg, shorts, editor: r.editor, estimated,
      });
    }
    // Editing: al geschoten en nog niet afgerond → bevestigd project, één toestand per opname.
    if (r.date < today && r.editStatus !== "afgerond") {
      const key = PHASE_TO_KEY[r.editStatus] ?? "beschikbaar";
      projects.push({
        id: r.id, shootDate: r.date, client: r.clientId, clientName: r.clientName, editor: r.editor,
        c: { [key]: shorts },
        editorDue: addWorkingDays(r.date, EDITOR_LEAD_DAYS, holidaysSet),
        clientDue: r.editDueOn ?? addWorkingDays(r.date, CLIENT_LEAD_DAYS, holidaysSet),
      });
    }
  }

  // ---------- klanten (pakketverwachting) ----------
  const clientsOut: CapacityData["clients"] = clientRows.map((c) => {
    const last = lastByClient.get(c.id);
    return {
      id: c.id, name: c.name, quota: num(c.quota) ?? 0, shootsPerMonth: 1,
      editor: c.editorName ? editorByKey.get(firstNameKey(c.editorName)) ?? null : null,
      lastVg: last?.vg ?? null, lastDate: last?.date ?? null, lastDur: last?.dur, lastTravel: last?.travel,
    };
  });

  // ---------- mensen ----------
  const vgIds = new Set<string>();
  const edIds = new Set<string>();
  for (const s of shoots) if (s.vg) vgIds.add(s.vg);
  for (const s of shoots) if (s.editor) edIds.add(s.editor);
  for (const p of projects) if (p.editor) edIds.add(p.editor);
  for (const c of capRows) {
    if (!c.userId) continue;
    const role = (c.role ?? "").toLowerCase();
    if (c.unit === "shorts_4w" || role.includes("editor")) edIds.add(c.userId);
    if (c.unit === "opnames_4w" || role.includes("videograaf")) vgIds.add(c.userId);
  }
  // Actieve editors en videografen zonder werk tellen ook mee (om aan toe te wijzen).
  const roleUsers = await db
    .select({ id: users.id, role: users.primaryRole })
    .from(users)
    .where(and(isNull(users.deletedAt), inArray(users.primaryRole, ["editor", "videographer"]), eq(users.status, "active")));
  for (const u of roleUsers) (u.role === "editor" ? edIds : vgIds).add(u.id);

  const allIds = [...new Set([...vgIds, ...edIds])];
  const userRows = allIds.length
    ? await db
        .select({ id: users.id, name: users.fullName, isStaff: users.isStaff, status: users.status })
        .from(users)
        // Alleen actieve portaalaccounts; werk van niet-actieve mensen komt bij "nog geen".
        .where(and(inArray(users.id, allIds), isNull(users.deletedAt), eq(users.status, "active")))
    : [];
  const leaveRows = allIds.length
    ? await db
        .select({ userId: leaveRequests.userId, startOn: leaveRequests.startOn, endOn: leaveRequests.endOn })
        .from(leaveRequests)
        .where(and(inArray(leaveRequests.userId, allIds), eq(leaveRequests.status, "approved"), gte(leaveRequests.endOn, weekStart), lte(leaveRequests.startOn, until)))
    : [];
  const leaveBy = new Map<string, [string, string][]>();
  for (const l of leaveRows) {
    const arr = leaveBy.get(l.userId) ?? [];
    arr.push([l.startOn, l.endOn]);
    leaveBy.set(l.userId, arr);
  }
  const capBy = new Map(capRows.filter((c) => c.userId).map((c) => [c.userId!, c]));

  const people: CapPerson[] = [];
  for (const u of userRows) {
    const cap = capBy.get(u.id);
    const first = u.name.split(" ")[0] ?? u.name;
    const employment: "vast" | "freelance" = cap?.employment === "freelance" ? "freelance" : cap?.employment === "vast" ? "vast" : u.isStaff ? "vast" : "freelance";
    const leave = leaveBy.get(u.id) ?? [];

    if (vgIds.has(u.id)) {
      // Uren per week: werkdagen × 8, of (zonder werkdagen) opnames per 4 weken × 5 uur.
      const wd = num(cap?.workdaysPerWeek);
      const opn4w = cap?.unit === "opnames_4w" ? num(cap?.limitGreen) : null;
      let hoursPerWeek: number | null = null;
      let note = "";
      if (wd && wd > 0) { hoursPerWeek = wd * 8; note = `${wd} werkdagen per week`; }
      else if (opn4w && opn4w > 0) { hoursPerWeek = (opn4w / 4) * 5; note = `${opn4w} opnames per 4 weken`; }
      people.push({
        id: u.id, name: first, role: "videograaf", employment,
        hoursPerDay: hoursPerWeek ? Math.round((hoursPerWeek / 5) * 10) / 10 : 8,
        dayMax: 8, maxShootsPerDay: 2,
        pattern: hoursPerWeek ? [1, 2, 3, 4, 5] : null,
        leave, capacityNote: hoursPerWeek ? note : "Capaciteit niet vastgelegd",
      });
    }
    if (edIds.has(u.id) && !(vgIds.has(u.id) && !capRows.some((c) => c.userId === u.id && c.unit === "shorts_4w"))) {
      const green4w = cap?.unit === "shorts_4w" ? num(cap?.limitGreen) : null;
      const perWeek = green4w && green4w > 0 ? Math.round((green4w / 4) * 10) / 10 : null;
      people.push({
        id: u.id, name: first, role: "editor", employment,
        shortsPerWeek: perWeek, pattern: perWeek ? [1, 2, 3, 4, 5] : null, leave,
        capacityNote: perWeek ? `${perWeek} video's per week` : "Capaciteit niet vastgelegd",
      });
    }
  }
  // Werk dat op een niet-actief account staat, telt als "nog geen videograaf/editor".
  const vgActive = new Set(people.filter((p) => p.role === "videograaf").map((p) => p.id));
  const edActive = new Set(people.filter((p) => p.role === "editor").map((p) => p.id));
  for (const s of shoots) {
    if (s.vg && !vgActive.has(s.vg)) s.vg = null;
    if (s.editor && !edActive.has(s.editor)) s.editor = null;
  }
  for (const pj of projects) if (pj.editor && !edActive.has(pj.editor)) pj.editor = null;
  for (const c of clientsOut) {
    if (c.editor && !edActive.has(c.editor)) c.editor = null;
    if (c.lastVg && !vgActive.has(c.lastVg)) c.lastVg = null;
  }

  people.sort((a, b) => (a.employment === b.employment ? a.name.localeCompare(b.name) : a.employment === "vast" ? -1 : 1));

  return {
    today,
    holidays: [...holidaysSet],
    people,
    clients: clientsOut,
    shoots,
    projects,
    settings,
    generatedAt: new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }),
  };
}
