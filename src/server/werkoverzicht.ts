import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, editProjectFiles, productionDays, scripts, shootScriptSources, tasks, users } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { getAttentionBoard, type AttentionItem } from "@/server/attention";
import { getQualityOverview } from "@/server/quality";
import { coveringForUser } from "@/server/leave-cover";
import { taskHref } from "@/lib/task-links";
import { nlHolidaySet } from "@/lib/holidays";
import { addWorkingDays, subWorkingDays } from "@/lib/workdays";

/**
 * Werkoverzicht per medewerker: één bron voor "Wat moet ik vandaag doen" en
 * "Wat moet ik deze week afronden". Bundelt
 *  - eigen taken (incl. de automatische scriptingtaken),
 *  - de aandachtspunten die op deze persoon staan (zelfde signalen als de
 *    pagina Aandachtspunten, dus geen tegenstrijdige meldingen),
 *  - opnamevoorbereiding (komende opnames met wat er nog ontbreekt),
 *  - werk na de opname (beelden overzetten, editor koppelen),
 *  - waar deze persoon op de klant wacht.
 * Alles gegroepeerd per soort werk, zodat de dagstart direct laat zien wat er
 * binnen klantcontact, scripting, opnamevoorbereiding enz. moet gebeuren.
 */

export type WorkCategory = "klantcontact" | "scripting" | "opname" | "editing" | "publicatie" | "intern";
export const WORK_CATEGORIES: { key: WorkCategory; label: string }[] = [
  { key: "klantcontact", label: "Klantcontact" },
  { key: "scripting", label: "Scripting" },
  { key: "opname", label: "Opnamevoorbereiding" },
  { key: "editing", label: "Editing & kwaliteit" },
  { key: "publicatie", label: "Publicatie & resultaten" },
  { key: "intern", label: "Intern" },
];

export type WorkState = "late" | "today" | "week" | "later";
export type WorkItem = {
  key: string;
  category: WorkCategory;
  title: string;
  detail: string | null;
  clientName: string | null;
  href: string | null;
  /** yyyy-mm-dd of null (geen datum). */
  due: string | null;
  state: WorkState;
  /** Hoeveel dagen te laat (alleen bij state "late"). */
  daysLate: number;
  /** Afvinkbaar als het een taak is. */
  taskId: string | null;
  source: "taak" | "signaal" | "opname";
  /** Korte waarschuwing, bijv. "2 punten open" bij een opname. */
  flag: string | null;
};
export type WaitingItem = { key: string; kind: "video" | "script"; clientName: string; title: string; days: number; href: string };

export type WorkOverview = {
  person: { id: string; fullName: string };
  /** Vandaag (of de eerstvolgende werkdag in het weekend). */
  refDay: string;
  isWeekend: boolean;
  weekEnd: string;
  today: WorkItem[];
  week: WorkItem[];
  undated: WorkItem[];
  waiting: WaitingItem[];
  laterCount: number;
  counts: { late: number; today: number; week: number; waiting: number };
};

const ams = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const iso = (v: string | Date | null): string | null => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);
const weekday = (s: string) => new Date(`${s}T12:00:00Z`).getUTCDay(); // 0 = zondag

/** Vrijdag van de werkweek waarin `refDay` valt. */
function fridayOf(refDay: string): string {
  const wd = weekday(refDay);
  const add = wd === 0 ? 5 : wd === 6 ? 6 : 5 - wd;
  const d = new Date(`${refDay}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

function attentionCategory(a: AttentionItem): WorkCategory {
  switch (a.area) {
    case "script": return "scripting";
    case "opname": return "opname";
    case "editing": return "editing";
    case "resultaat": return "publicatie";
    case "klant": return /verstu|publice|inplan/i.test(a.action) ? "publicatie" : "klantcontact";
    default: return /verleng|gesprek|klant|contract|bellen/i.test(a.action) ? "klantcontact" : "intern";
  }
}

export async function getWorkOverview(person: Viewer, opts: { trusted?: boolean } = {}): Promise<WorkOverview> {
  const holidays = nlHolidaySet();
  const today = ams(new Date());
  const isWeekend = weekday(today) === 0 || weekday(today) === 6;
  // Peildag: vandaag, of in het weekend/op een feestdag de eerstvolgende werkdag.
  let refDay = today;
  while (weekday(refDay) === 0 || weekday(refDay) === 6 || holidays.has(refDay)) {
    const d = new Date(`${refDay}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    refDay = d.toISOString().slice(0, 10);
  }
  const weekEnd = fridayOf(refDay);
  const horizon = addWorkingDays(refDay, 6, holidays); // opnames ruim een week vooruit

  const covering = await coveringForUser(person.id);
  const assignees = [person.id, ...covering.map((c) => c.absentId)];

  const [taskRows, board, myClients, shootRows] = await Promise.all([
    db
      .select({
        id: tasks.id, title: tasks.title, dueOn: tasks.dueOn, priority: tasks.priority, category: tasks.category,
        status: tasks.status, clientName: clients.name, entityType: tasks.entityType, entityId: tasks.entityId, dedupeKey: tasks.dedupeKey,
        description: tasks.description,
      })
      .from(tasks)
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .where(and(
        inArray(tasks.assigneeId, assignees),
        isNull(tasks.deletedAt),
        isNull(tasks.archivedAt),
        inArray(tasks.status, ["todo", "in_progress", "blocked"]),
        sql`not (${tasks.source} = 'automation' and ${tasks.entityType} = 'ai_insight')`,
      ))
      .orderBy(sql`${tasks.dueOn} asc nulls last`)
      .limit(200),
    // Lukt het bijwerken van de aandachtspunten niet (bijv. alleen-lezen), val
    // dan terug op de ruwe signalen, zodat de dagstart nooit leeg blijft.
    getAttentionBoard(person, { trusted: opts.trusted }).catch(async () => ({
      items: (await getQualityOverview(person, { trusted: true })).items.map((s) => ({
        key: s.id, clientName: s.clientName ?? null, clientLogoUrl: null, clientColor: null, action: s.action, reason: s.reason,
        why: s.detail, priority: s.priority, area: s.area, ownerId: s.ownerId ?? null, status: "open" as const,
        since: new Date().toISOString(), doneAt: null, notes: [], href: s.href, kids: [], manual: false, dueOn: s.dueOn ?? null,
      })) as AttentionItem[],
    })),
    db.select({ id: clients.id, name: clients.name }).from(clients)
      .where(and(eq(clients.coordinatorId, person.id), isNull(clients.deletedAt))),
    db
      .select({
        id: productionDays.id, clientId: productionDays.clientId, clientName: clients.name, coordinatorId: clients.coordinatorId,
        scheduledOn: productionDays.scheduledOn, startTime: productionDays.startTime, locationName: productionDays.locationName,
        scriptingStatus: productionDays.scriptingStatus, scriptUrl: productionDays.scriptUrl, videographerId: productionDays.videographerId,
        scriptWriterId: productionDays.scriptWriterId, editorId: productionDays.editorId, status: productionDays.status,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(and(
        isNull(productionDays.deletedAt),
        sql`${productionDays.status} <> 'cancelled'`,
        gte(productionDays.scheduledOn, subWorkingDays(refDay, 5, holidays)),
        lte(productionDays.scheduledOn, horizon),
        or(
          eq(productionDays.videographerId, person.id),
          eq(productionDays.scriptWriterId, person.id),
          eq(clients.coordinatorId, person.id),
        ),
      ))
      .orderBy(asc(productionDays.scheduledOn)),
  ]);

  const items: WorkItem[] = [];
  const stateOf = (due: string | null, fallback: WorkState): { state: WorkState; daysLate: number } => {
    if (!due) return { state: fallback, daysLate: 0 };
    if (due < today) return { state: "late", daysLate: dayDiff(today, due) };
    if (due <= refDay) return { state: "today", daysLate: 0 };
    if (due <= weekEnd) return { state: "week", daysLate: 0 };
    return { state: "later", daysLate: 0 };
  };

  // 1) Taken (handmatig + automatisch). Scriptingtaken zijn al per opname
  //    ontdubbeld (dedupeKey), dus geen aparte scriptinglijst nodig.
  for (const t of taskRows) {
    const due = iso(t.dueOn);
    const cat: WorkCategory = t.category === "klantcontact" ? "klantcontact" : t.category === "scripting" || (t.dedupeKey ?? "").startsWith("scripting:") ? "scripting" : "intern";
    const urgent = t.priority === "urgent" || t.priority === "high";
    const { state, daysLate } = stateOf(due, urgent ? "today" : "week");
    items.push({
      key: `task-${t.id}`, category: cat, title: t.title.replace(/^[^|]+\|\s*/, "").trim() || t.title,
      detail: t.status === "blocked" ? "Geblokkeerd" : null,
      clientName: t.clientName, href: taskHref({ entityType: t.entityType, entityId: t.entityId, dedupeKey: t.dedupeKey }) ?? "/tasks",
      due, state, daysLate, taskId: t.id, source: "taak", flag: null,
    });
  }

  // 2) Aandachtspunten die op deze persoon staan (hoog = vandaag, normaal = deze week).
  for (const a of board.items) {
    if (a.ownerId !== person.id || a.status === "klaar") continue;
    const state: WorkState = a.priority === "hoog" ? "today" : a.priority === "normaal" ? "week" : "later";
    items.push({
      key: `att-${a.key}`, category: attentionCategory(a), title: a.action, detail: a.reason,
      clientName: a.clientName, href: a.href ?? "/kwaliteit", due: null, state, daysLate: 0,
      taskId: null, source: "signaal", flag: a.status === "bezig" ? "bezig" : null,
    });
  }

  // 3) Opnames: voorbereiding (komend) en werk na de opname (geweest).
  const dayIds = shootRows.map((s) => s.id);
  const [pdfLinks, pdfFiles, dels] = dayIds.length
    ? await Promise.all([
        db.select({ id: shootScriptSources.productionDayId }).from(shootScriptSources)
          .where(and(inArray(shootScriptSources.productionDayId, dayIds), eq(shootScriptSources.status, "gekoppeld"))),
        db.select({ id: editProjectFiles.productionDayId }).from(editProjectFiles)
          .where(and(inArray(editProjectFiles.productionDayId, dayIds), eq(editProjectFiles.kind, "script"))),
        db.select({ dayId: deliverables.productionDayId, footageUrl: deliverables.footageUrl, editorId: deliverables.editorId, status: deliverables.status })
          .from(deliverables).where(and(inArray(deliverables.productionDayId, dayIds), isNull(deliverables.deletedAt))),
      ])
    : [[], [], []];
  const hasPdf = new Set([...pdfLinks.map((r) => r.id), ...pdfFiles.map((r) => r.id)]);
  const delsByDay = new Map<string, typeof dels>();
  for (const d of dels) if (d.dayId) delsByDay.set(d.dayId, [...(delsByDay.get(d.dayId) ?? []), d]);

  const dayLabel = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  for (const s of shootRows) {
    const on = iso(s.scheduledOn)!;
    const isVideographer = s.videographerId === person.id;
    const isCoordinator = s.coordinatorId === person.id || s.scriptWriterId === person.id;
    const time = s.startTime ? String(s.startTime).slice(0, 5) : null;

    if (on >= today) {
      const missing: string[] = [];
      if (s.scriptingStatus !== "final") missing.push("scripts niet final");
      if (!hasPdf.has(s.id) && !s.scriptUrl) missing.push("geen script-PDF gekoppeld");
      if (!s.videographerId) missing.push("geen videograaf");
      if (!s.editorId) missing.push("geen editor");
      // Voorbereiding moet 2 werkdagen vóór de opname rond zijn.
      const prepDue = subWorkingDays(on, 2, holidays);
      if (isCoordinator && missing.length) {
        const { state, daysLate } = stateOf(prepDue, "week");
        items.push({
          key: `prep-${s.id}`, category: "opname", title: `Opname ${dayLabel(on)} voorbereiden`,
          detail: missing.join(" · "), clientName: s.clientName, href: `/productions/${s.id}`,
          due: prepDue, state, daysLate, taskId: null, source: "opname", flag: `${missing.length} open`,
        });
      }
      if (isVideographer) {
        const { state } = stateOf(on, "week");
        items.push({
          key: `shoot-${s.id}`, category: "opname", title: `Opname${time ? ` ${time}` : ""}${s.locationName ? ` · ${s.locationName}` : ""}`,
          detail: missing.length ? `Nog open: ${missing.join(" · ")}` : "Scripts final en gekoppeld · klaar voor opname",
          clientName: s.clientName, href: `/productions/${s.id}`, due: on, state, daysLate: 0,
          taskId: null, source: "opname", flag: missing.length ? `${missing.length} open` : "klaar",
        });
      }
    } else if (isVideographer) {
      // Na de opname: beelden overzetten (dag +1) en een editor koppelen.
      const ds = delsByDay.get(s.id) ?? [];
      const noFootage = ds.length > 0 && ds.every((d) => !d.footageUrl);
      const noEditor = ds.length > 0 && ds.every((d) => !d.editorId) && !s.editorId;
      if (noFootage || noEditor) {
        const due = addWorkingDays(on, 1, holidays);
        const { state, daysLate } = stateOf(due, "today");
        const todo = [noFootage ? "beelden overzetten en downloadlink zetten" : null, noEditor ? "editor koppelen" : null].filter(Boolean).join(" · ");
        items.push({
          key: `post-${s.id}`, category: "opname", title: `Na opname ${dayLabel(on)}: ${todo}`,
          detail: "Zonder beelden en editor start de editingklok niet.", clientName: s.clientName, href: `/videos`,
          due, state, daysLate, taskId: null, source: "opname", flag: null,
        });
      }
    }
  }

  // 4) Waar wacht deze persoon op de klant? (video's en scripts bij de klant)
  const clientIds = myClients.map((c) => c.id);
  const [waitVideos, waitScripts] = clientIds.length
    ? await Promise.all([
        db.select({ id: deliverables.id, title: deliverables.title, since: deliverables.statusChangedAt, clientName: clients.name })
          .from(deliverables).innerJoin(clients, eq(clients.id, deliverables.clientId))
          .where(and(isNull(deliverables.deletedAt), inArray(deliverables.status, ["client_review"]), inArray(deliverables.clientId, clientIds))),
        db.select({ id: scripts.id, title: scripts.title, since: scripts.updatedAt, clientName: clients.name })
          .from(scripts).innerJoin(clients, eq(clients.id, scripts.clientId))
          .where(and(isNull(scripts.deletedAt), eq(scripts.status, "client_review"), inArray(scripts.clientId, clientIds))),
      ])
    : [[], []];
  const waiting: WaitingItem[] = [
    ...waitVideos.map((v) => ({ key: `v-${v.id}`, kind: "video" as const, clientName: v.clientName, title: v.title, days: Math.max(0, dayDiff(today, iso(v.since) ?? today)), href: `/videos/${v.id}` })),
    ...waitScripts.map((s) => ({ key: `s-${s.id}`, kind: "script" as const, clientName: s.clientName, title: s.title, days: Math.max(0, dayDiff(today, iso(s.since) ?? today)), href: `/scripts/${s.id}` })),
  ].sort((a, b) => b.days - a.days);

  // Indelen.
  const order = (a: WorkItem, b: WorkItem) =>
    (a.state === "late" ? 0 : 1) - (b.state === "late" ? 0 : 1) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title);
  const todayList = items.filter((i) => i.state === "late" || i.state === "today").sort(order);
  const weekList = items.filter((i) => i.state === "week" && i.due).sort(order);
  const undated = items.filter((i) => i.state === "week" && !i.due).sort(order);
  const laterCount = items.filter((i) => i.state === "later").length;

  const [u] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, person.id)).limit(1);

  return {
    person: { id: person.id, fullName: u?.fullName ?? person.fullName },
    refDay, isWeekend, weekEnd,
    today: todayList, week: weekList, undated, waiting, laterCount,
    counts: {
      late: todayList.filter((i) => i.state === "late").length,
      today: todayList.length,
      week: weekList.length + undated.length,
      waiting: waiting.length,
    },
  };
}
