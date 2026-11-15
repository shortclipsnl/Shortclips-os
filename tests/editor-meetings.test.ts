import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import type { Viewer } from "@/server/auth/context";
import {
  addPeriods,
  amsterdamToDate,
  daysUntilMonthEnd,
  displayStatus,
  draftAgenda,
  isOverdue,
  lastDayOfPeriod,
  monthLabel,
  parsePlanTaskKey,
  planTaskKey,
  planningPeriods,
  recurringThemes,
  reminderStage,
  sharedShortclipsThemes,
} from "@/lib/editor-meetings";
import { editorMayOpenPath } from "@/lib/editor-routes";
import { taskHref } from "@/lib/task-links";

describe("editor meetings: maanden en maandwisselingen", () => {
  it("rekent over jaargrenzen en schrikkeljaren heen", () => {
    expect(addPeriods("2026-12", 1)).toBe("2027-01");
    expect(addPeriods("2027-01", -1)).toBe("2026-12");
    expect(lastDayOfPeriod("2026-11")).toBe("2026-11-30");
    expect(lastDayOfPeriod("2027-02")).toBe("2027-02-28");
    expect(lastDayOfPeriod("2028-02")).toBe("2028-02-29");
    expect(daysUntilMonthEnd("2026-11-23")).toBe(7);
    expect(daysUntilMonthEnd("2026-12-31")).toBe(0);
    expect(monthLabel("2027-01")).toBe("januari 2027");
  });

  it("start de plantaak precies zeven dagen voor het einde van de maand", () => {
    expect(planningPeriods("2026-11-22")).toEqual({ create: null, maintain: ["2026-11"] });
    expect(planningPeriods("2026-11-23")).toEqual({ create: "2026-12", maintain: ["2026-11", "2026-12"] });
    expect(planningPeriods("2026-12-24").create).toBe("2027-01");
    expect(planningPeriods("2027-02-20").create).toBeNull();
    expect(planningPeriods("2027-02-21").create).toBe("2027-03");
    expect(planningPeriods("2028-02-22").create).toBe("2028-03"); // schrikkeljaar: 29 dagen
    expect(planningPeriods("2028-02-21").create).toBeNull();
    // In de nieuwe maand ontstaat geen nieuwe taak; de bestaande wordt bijgehouden.
    expect(planningPeriods("2026-12-01")).toEqual({ create: null, maintain: ["2026-12"] });
  });

  it("geeft elk herinneringsmoment één keer", () => {
    expect(reminderStage("2026-11-22", "2026-12")).toBeNull();
    expect(reminderStage("2026-11-23", "2026-12")).toBe("start");
    expect(reminderStage("2026-11-27", "2026-12")).toBe("start");
    expect(reminderStage("2026-11-28", "2026-12")).toBe("laatste-dagen");
    expect(reminderStage("2026-12-01", "2026-12")).toBe("maand-gestart");
    expect(reminderStage("2026-12-08", "2026-12")).toBe("eerste-week-voorbij");
    expect(reminderStage("2026-12-31", "2027-01")).toBe("laatste-dagen");
  });

  it("herkent de sleutel van een plantaak en linkt taken naar de juiste plek", () => {
    const key = planTaskKey("2026-12", "abc");
    expect(parsePlanTaskKey(key)).toEqual({ period: "2026-12", ownerId: "abc" });
    expect(parsePlanTaskKey("klantmoment:x")).toBeNull();
    expect(taskHref({ entityType: "editor_meeting_plan", entityId: null, dedupeKey: key })).toBe("/editor-meetings?maand=2026-12");
    expect(taskHref({ entityType: "editor_meeting", entityId: "m1", dedupeKey: "editormeeting:actie:a1" })).toBe("/editor-meetings/m1");
  });

  it("zet Nederlandse tijd goed om, ook rond zomer- en wintertijd", () => {
    expect(amsterdamToDate("2026-12-02", "10:00")!.toISOString()).toBe("2026-12-02T09:00:00.000Z");
    expect(amsterdamToDate("2026-07-01", "10:00")!.toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(amsterdamToDate("2026-13-02", "10:00")).toBeNull();
    expect(amsterdamToDate("2026-12-02", "25u")).toBeNull();
  });
});

describe("editor meetings: status", () => {
  const now = new Date("2026-12-10T12:00:00+01:00");
  const today = "2026-12-10";
  const m = (o: Partial<{ status: string; scheduledAt: string | null; reportStatus: string }>) => ({ status: "gepland", scheduledAt: "2026-12-02T10:00:00+01:00", reportStatus: "geen", ...o });

  it("bepaalt de status per maand", () => {
    expect(displayStatus(null, "2026-12", now, today)).toBe("te_plannen");
    expect(displayStatus(null, "2026-11", now, today)).toBe("niet_gehouden");
    expect(displayStatus(null, "2027-01", now, today)).toBe("te_plannen");
    expect(displayStatus(m({ status: "geannuleerd" }), "2026-12", now, today)).toBe("opnieuw_plannen");
    expect(displayStatus(m({ scheduledAt: "2026-12-15T10:00:00+01:00" }), "2026-12", now, today)).toBe("gepland");
    expect(displayStatus(m({}), "2026-12", now, today)).toBe("verslag_nodig");
    expect(displayStatus(m({ reportStatus: "concept" }), "2026-12", now, today)).toBe("verslag_concept");
    expect(displayStatus(m({ reportStatus: "gepubliceerd" }), "2026-12", now, today)).toBe("afgerond");
  });

  it("markeert alleen echte achterstand als over tijd", () => {
    expect(isOverdue(null, "2026-12", now, today)).toBe(true); // eerste week voorbij, niets gepland
    expect(isOverdue(null, "2026-12", new Date("2026-12-05T12:00:00+01:00"), "2026-12-05")).toBe(false);
    expect(isOverdue(null, "2027-01", now, today)).toBe(false);
    // Maanden van voor de start van dit onderdeel zijn nooit achterstand.
    expect(isOverdue(null, "2026-11", now, today)).toBe(false);
    expect(isOverdue(null, "2027-01", new Date("2027-02-10T12:00:00+01:00"), "2027-02-10")).toBe(true);
    expect(isOverdue(m({}), "2026-12", now, today)).toBe(true); // 8 dagen geleden, geen verslag
    expect(isOverdue(m({ scheduledAt: "2026-12-09T10:00:00+01:00" }), "2026-12", now, today)).toBe(false);
    expect(isOverdue(m({ reportStatus: "gepubliceerd" }), "2026-12", now, today)).toBe(false);
    expect(isOverdue(m({ scheduledAt: "2026-12-15T10:00:00+01:00" }), "2026-12", now, today)).toBe(false);
  });
});

describe("editor meetings: terugkerende feedback en conceptagenda", () => {
  it("herkent een thema dat in meerdere maanden terugkomt", () => {
    const hits = [
      { theme: "ondertiteling", period: "2026-11" },
      { theme: "ondertiteling", period: "2026-12" },
      { theme: "kleur", period: "2026-12" },
      { theme: "overig", period: "2026-11" },
      { theme: "overig", period: "2026-12" },
    ];
    expect(recurringThemes(hits)).toEqual([{ theme: "ondertiteling", months: 2, periods: ["2026-11", "2026-12"] }]);
    // Twee keer in dezelfde maand is geen herhaling.
    expect(recurringThemes([{ theme: "kleur", period: "2026-12" }, { theme: "kleur", period: "2026-12" }])).toEqual([]);
    // Buiten het venster van vier maanden telt niet meer mee.
    expect(recurringThemes([{ theme: "kleur", period: "2026-06" }, { theme: "kleur", period: "2026-12" }])).toEqual([]);
  });

  it("maakt van feedback van meerdere editors een intern verbeterpunt", () => {
    const shared = sharedShortclipsThemes([
      { theme: "briefings", period: "2026-12", editorId: "a" },
      { theme: "briefings", period: "2026-12", editorId: "b" },
      { theme: "planning", period: "2026-12", editorId: "a" },
      { theme: "planning", period: "2026-11", editorId: "a" },
    ]);
    expect(shared).toEqual([{ theme: "briefings", editors: 2, editorIds: ["a", "b"] }]);
  });

  it("zet alleen feiten in de conceptagenda", () => {
    const empty = draftAgenda({ reviewPeriod: "2026-11", delivered: 0, missedDeadlines: 0, openFeedback: 0, openActions: [], openPoints: [], recurring: [] });
    expect(empty).toEqual(["Terugblik november 2026", "Samenwerking: wat kan de editor beter, wat kan Shortclips beter", "Vooruitblik december 2026: klanten, planning en verbeterdoelen"]);
    const full = draftAgenda({
      reviewPeriod: "2026-11",
      delivered: 4,
      missedDeadlines: 1,
      openFeedback: 2,
      openActions: ["Spelling controleren"],
      openPoints: [{ theme: "kleur", body: "Kleurcorrectie consistenter" }, { theme: "ondertiteling", body: "Spelling" }],
      recurring: [{ theme: "ondertiteling", months: 2, periods: ["2026-10", "2026-11"] }],
    });
    expect(full).toContain("Terugblik november 2026: 4 opgeleverde projecten doorlopen");
    expect(full).toContain("Deadlines: 1 gemiste deadline bespreken");
    expect(full).toContain("Terugkerend punt (2 maanden): Ondertiteling en tekst");
    expect(full).toContain("Verbeterpunt vorige keer: Kleurcorrectie consistenter");
    expect(full).not.toContain("Verbeterpunt vorige keer: Spelling"); // staat al als terugkerend punt
    expect(full).toContain("Openstaande actiepunten (1) nalopen");
  });
});

describe("editor meetings: editorportaal", () => {
  it("laat editors alleen de eigen pagina's openen", () => {
    expect(editorMayOpenPath("/editor-meetings")).toBe(true);
    expect(editorMayOpenPath("/editor-meetings/123")).toBe(true);
    expect(editorMayOpenPath("/meetings")).toBe(false);
    expect(editorMayOpenPath("/tasks")).toBe(false);
    expect(editorMayOpenPath("/scripting")).toBe(false);
    expect(editorMayOpenPath("/clients")).toBe(false);
  });
});

/**
 * De tien opleversituaties, van begin tot eind op een echte (test)database.
 * De klok loopt mee van 20 november 2026 tot in januari 2027.
 */
describe("editor meetings: volledige maandcyclus", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let svc: typeof import("@/server/editor-meetings");
  const id: Record<string, string> = {};
  const at = (iso: string) => vi.setSystemTime(new Date(iso));

  const viewer = (key: string, email: string, fullName: string, role: string): Viewer =>
    ({ id: id[key]!, email, fullName, primaryRole: role, clientId: null, avatarUrl: null, status: "active", permissions: new Set<string>(), clientScope: role === "editor" ? [] : null, isPortalUser: false, isEditorOnly: role === "editor" }) as Viewer;
  const jarno = () => viewer("jarno", "jarno@shortclips.nl", "Jarno Klijnsma", "owner");
  const milou = () => viewer("milou", "milou@shortclips.nl", "Milou Sjoerdsma", "operational_manager");
  const jiska = () => viewer("jiska", "jiska@shortclips.nl", "Jiska", "project_coordinator");
  const rutger = () => viewer("rutger", "rutger@shortclips.nl", "Rutger", "videographer");
  const quinn = () => viewer("quinn", "quinn@x.nl", "Quinn Borghart", "editor");
  const noah = () => viewer("noah", "noah@x.nl", "Noah", "editor");

  const planTasks = () => db.select().from(s.tasks).where(like(s.tasks.dedupeKey, "editormeetings:plan:%"));
  const planTask = async (period: string, who: string) => (await planTasks()).find((t) => t.dedupeKey === planTaskKey(period, id[who]!));
  const notes = (who: string) => db.select().from(s.notifications).where(eq(s.notifications.userId, id[who]!));
  const meetings = () => db.select().from(s.editorMeetings);

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-11-20T09:00:00+01:00");
    db = await freshDatabase();
    s = await import("@/db/schema");
    svc = await import("@/server/editor-meetings");
    const add = async (key: string, email: string, fullName: string, role: string, status = "active") => {
      const [u] = await db.insert(s.users).values({ email, fullName, status: status as "active", primaryRole: role as "editor" }).returning({ id: s.users.id });
      id[key] = u!.id;
    };
    await add("jarno", "jarno@shortclips.nl", "Jarno Klijnsma", "owner");
    await add("milou", "milou@shortclips.nl", "Milou Sjoerdsma", "operational_manager");
    await add("jiska", "jiska@shortclips.nl", "Jiska", "project_coordinator");
    await add("rutger", "rutger@shortclips.nl", "Rutger", "videographer");
    await add("quinn", "quinn@x.nl", "Quinn Borghart", "editor");
    await add("noah", "noah@x.nl", "Noah", "editor");
    await add("sem", "sem@x.nl", "Sem van Tilburg", "editor");
    await add("alex", "alex@x.nl", "Alex", "editor", "suspended"); // niet actief: doet niet mee
    const [a] = await db.insert(s.clients).values({ slug: "kkfh", name: "KKFH", coordinatorId: id.milou }).returning({ id: s.clients.id });
    const [b] = await db.insert(s.clients).values({ slug: "nahv", name: "NAHV", coordinatorId: id.jiska }).returning({ id: s.clients.id });
    id.clientA = a!.id;
    id.clientB = b!.id;
    // Quinn werkt voor een klant van Milou, Noah voor een klant van Jiska, Sem nog nergens voor.
    await db.insert(s.deliverables).values([
      { clientId: a!.id, title: "KKFH november 1", status: "approved", editorId: id.quinn, plannedShorts: 6, feedbackRounds: 1, shootOn: "2026-11-02", approvedAt: new Date("2026-11-12T10:00:00+01:00") },
      { clientId: a!.id, title: "KKFH november 2", status: "client_revision", editorId: id.quinn, plannedShorts: 8 },
      { clientId: b!.id, title: "NAHV november", status: "approved", editorId: id.noah, plannedShorts: 6, approvedAt: new Date("2026-11-10T10:00:00+01:00") },
    ]);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await closeDatabase();
  });

  it("leidt de verantwoordelijke af en laat alleen het juiste team erbij", async () => {
    const owners = await svc.getOwnerMap([id.quinn!, id.noah!, id.sem!]);
    expect(owners.get(id.quinn!)).toEqual({ ownerId: id.milou, source: "voorstel" });
    expect(owners.get(id.noah!)).toEqual({ ownerId: id.jiska, source: "voorstel" });
    expect(owners.get(id.sem!)).toEqual({ ownerId: null, source: null });
    expect((await svc.listActiveEditors()).map((e) => e.fullName)).toEqual(["Noah", "Quinn Borghart", "Sem van Tilburg"]);

    expect(svc.canUseTeamView(jarno())).toBe(true);
    expect(svc.canUseTeamView(milou())).toBe(true);
    expect(svc.canUseTeamView(rutger())).toBe(false);
    expect(svc.canUseTeamView(quinn())).toBe(false);
    expect(svc.canUseEditorMeetings(quinn())).toBe(true);
    await expect(svc.getOverview(quinn(), "2026-12")).rejects.toThrow();
    await expect(svc.getOverview(rutger(), "2026-12")).rejects.toThrow();

    // Het management legt de verdeling vast; een editor of content creator kan die niet omgooien.
    await svc.setEditorOwner(jarno(), id.quinn!, id.milou!);
    await svc.setEditorOwner(jarno(), id.noah!, id.jiska!);
    await expect(svc.setEditorOwner(jiska(), id.quinn!, id.jiska!)).rejects.toThrow(/management/);
    await expect(svc.setEditorOwner(quinn(), id.quinn!, id.jiska!)).rejects.toThrow();
  });

  it("1 en 2: Milou en Jiska krijgen zeven dagen voor het maandeinde hun melding, nooit dubbel", async () => {
    at("2026-11-22T09:00:00+01:00");
    expect((await svc.syncPlanTasks()).created).toBe(0);
    expect(await planTasks()).toHaveLength(0);

    at("2026-11-23T07:30:00+01:00");
    const first = await svc.syncPlanTasks();
    expect(first.created).toBe(2);
    const m = await planTask("2026-12", "milou");
    const j = await planTask("2026-12", "jiska");
    expect(m!.title).toBe("Plan de editor meetings voor december 2026");
    expect(m!.assigneeId).toBe(id.milou);
    expect(m!.status).toBe("todo");
    expect(m!.description).toContain("Jouw editors: Quinn, Sem (nog geen verantwoordelijke)");
    expect(m!.description).toContain("Ingepland: nog geen");
    expect(m!.description).toContain("Nog te plannen: Quinn, Sem (nog geen verantwoordelijke)");
    expect(j!.description).toContain("Jouw editors: Noah, Sem (nog geen verantwoordelijke)");
    expect(j!.description).not.toContain("Quinn");

    const mNotes = (await notes("milou")).filter((n) => n.type === "editor_meeting.plan");
    expect(mNotes).toHaveLength(1);
    expect(mNotes[0]!.title).toBe("Plan de editor meetings voor december 2026.");
    expect(mNotes[0]!.href).toBe("/editor-meetings?maand=2026-12");
    expect((await notes("jiska")).filter((n) => n.type === "editor_meeting.plan")).toHaveLength(1);
    // Jarno, Rutger en de editors krijgen deze taak niet.
    expect((await planTasks()).map((t) => t.assigneeId).sort()).toEqual([id.jiska, id.milou].sort());
    expect(await notes("jarno")).toHaveLength(0);

    // Opnieuw uitvoeren (job draait dagelijks, pagina's draaien het vangnet): niets dubbel.
    await svc.syncPlanTasks();
    await svc.syncPlanTasks();
    expect(await planTasks()).toHaveLength(2);
    expect((await notes("milou")).filter((n) => n.type === "editor_meeting.plan")).toHaveLength(1);

    // Laatste dagen van de maand: één herinnering erbij, de taak blijft dezelfde.
    at("2026-11-28T07:30:00+01:00");
    await svc.syncPlanTasks();
    await svc.syncPlanTasks();
    expect(await planTasks()).toHaveLength(2);
    const reminders = (await notes("milou")).filter((n) => n.type === "editor_meeting.plan");
    expect(reminders).toHaveLength(2);
    expect(reminders.some((n) => n.title.startsWith("Herinnering:"))).toBe(true);
  });

  it("4: een nieuwe meeting staat direct in de juiste portalen", async () => {
    at("2026-11-24T10:00:00+01:00");
    // Milou kan niet plannen voor een editor van Jiska.
    await expect(svc.planMeeting(milou(), { editorId: id.noah!, date: "2026-12-02", time: "10:00" })).rejects.toThrow(/verantwoordelijkheid/);
    // Een editor kan helemaal niet plannen, en een datum in een voorbije maand kan niet.
    await expect(svc.planMeeting(quinn(), { editorId: id.quinn!, date: "2026-12-02", time: "10:00" })).rejects.toThrow();
    await expect(svc.planMeeting(milou(), { editorId: id.quinn!, date: "2026-10-02", time: "10:00" })).rejects.toThrow(/deze of een volgende maand/);

    const res = await svc.planMeeting(milou(), { editorId: id.quinn!, date: "2026-12-02", time: "10:00", meetingUrl: "meet.google.com/abc", topics: ["Terugblik november", " "] });
    id.dec = res.id;

    // 1. Portaal van de editor.
    const page = await svc.getEditorPage(quinn());
    expect(page.next?.id).toBe(id.dec);
    expect(page.next?.scheduledAt?.toISOString()).toBe("2026-12-02T09:00:00.000Z");
    expect(page.next?.topics).toEqual(["Terugblik november"]);
    expect(page.next?.meetingUrl).toBe("https://meet.google.com/abc");
    expect(page.owner?.id).toBe(id.milou);
    expect(page.history.find((h) => h.period === "2026-12")?.status).toBe("gepland");
    // 2. Portaal van Milou (overzicht en Agenda deze week zodra het die week is).
    const mine = (await svc.getOverview(milou(), "2026-12")).rows.find((r) => r.editor.id === id.quinn)!;
    expect(mine.status).toBe("gepland");
    expect(mine.canManage).toBe(true);
    expect(mine.meetingId).toBe(id.dec);
    at("2026-11-30T09:00:00+01:00");
    expect((await svc.upcomingMeetingsForOwner(milou(), 7)).map((x) => x.href)).toEqual([`/editor-meetings/${id.dec}`]);
    expect(await svc.upcomingMeetingsForOwner(jiska(), 7)).toEqual([]);
    at("2026-11-24T10:05:00+01:00");
    // 3. Centraal overzicht: management ziet en beheert alles, Jiska ziet alleen de planning.
    expect((await svc.getOverview(jarno(), "2026-12")).rows.find((r) => r.editor.id === id.quinn)!.canManage).toBe(true);
    const other = (await svc.getOverview(jiska(), "2026-12")).rows.find((r) => r.editor.id === id.quinn)!;
    expect(other.status).toBe("gepland");
    expect(other.canManage).toBe(false);
    await expect(svc.getMeetingDetail(jiska(), id.dec!)).rejects.toThrow(/verantwoordelijkheid/);
    // 4. Agenda-feed van de editor.
    expect((await svc.upcomingMeetingsForEditor(id.quinn!)).map((x) => x.id)).toEqual([id.dec]);
    expect(await svc.upcomingMeetingsForEditor(id.noah!)).toEqual([]);

    // De editor krijgt één melding.
    const n = (await notes("quinn")).filter((x) => x.type === "editor_meeting.planned");
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toBe("Editor meeting gepland: woensdag 2 december 2026 om 10:00");
    expect(n[0]!.href).toBe("/editor-meetings");

    // De plantaak van Milou werkt zichzelf bij.
    expect((await planTask("2026-12", "milou"))!.description).toContain("Ingepland: Quinn (2 dec 10:00)");
  });

  it("8: een verplaatste meeting wordt overal bijgewerkt, zonder dubbele meeting", async () => {
    const moved = await svc.planMeeting(milou(), { meetingId: id.dec, editorId: id.quinn!, date: "2026-12-03", time: "14:30" });
    expect(moved.id).toBe(id.dec);
    // Nogmaals plannen in dezelfde maand zonder meeting-id werkt dezelfde meeting bij.
    const again = await svc.planMeeting(milou(), { editorId: id.quinn!, date: "2026-12-03", time: "14:30" });
    expect(again.id).toBe(id.dec);
    expect((await meetings()).filter((m) => m.editorId === id.quinn)).toHaveLength(1);

    const iso = "2026-12-03T13:30:00.000Z";
    expect((await svc.getEditorPage(quinn())).next?.scheduledAt?.toISOString()).toBe(iso);
    expect((await svc.getOverview(milou(), "2026-12")).rows.find((r) => r.editor.id === id.quinn)!.scheduledAt?.toISOString()).toBe(iso);
    expect((await svc.getOverview(jarno(), "2026-12")).rows.find((r) => r.editor.id === id.quinn)!.scheduledAt?.toISOString()).toBe(iso);
    expect(new Date((await svc.upcomingMeetingsForEditor(id.quinn!))[0]!.scheduledAt!).toISOString()).toBe(iso);
    expect((await svc.getMeetingDetail(quinn(), id.dec!))!.meeting.topics).toEqual(["Terugblik november"]); // bespreekpunten blijven staan
    expect((await planTask("2026-12", "milou"))!.description).toContain("Ingepland: Quinn (3 dec 14:30)");

    // De oude melding is weg, de editor heeft alleen de actuele.
    const n = (await notes("quinn")).filter((x) => x.type === "editor_meeting.planned");
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toBe("Je editor meeting is verplaatst naar donderdag 3 december 2026 om 14:30");
  });

  it("9: een nieuwe editor doet automatisch mee", async () => {
    at("2026-11-25T09:00:00+01:00");
    const [u] = await db.insert(s.users).values({ email: "senna@x.nl", fullName: "Senna", status: "active", primaryRole: "editor" }).returning({ id: s.users.id });
    id.senna = u!.id;
    await svc.syncPlanTasks();
    expect((await planTask("2026-12", "milou"))!.description).toContain("Senna (nog geen verantwoordelijke)");
    expect((await planTask("2026-12", "jiska"))!.description).toContain("Senna (nog geen verantwoordelijke)");
    expect(await planTasks()).toHaveLength(2);
    const rows = (await svc.getOverview(jarno(), "2026-12")).rows;
    expect(rows.map((r) => r.editor.fullName)).toContain("Senna");
    expect(rows.find((r) => r.editor.id === id.senna)!.status).toBe("te_plannen");

    // Jiska pakt Senna op door te plannen; Milou kan Senna daarna niet meer inzien.
    const res = await svc.planMeeting(jiska(), { editorId: id.senna!, date: "2026-12-04", time: "09:00" });
    id.sennaDec = res.id;
    expect((await svc.getOwnerMap([id.senna!])).get(id.senna!)).toEqual({ ownerId: id.jiska, source: "vast" });
    await expect(svc.getMeetingDetail(milou(), id.sennaDec!)).rejects.toThrow();
    expect((await planTask("2026-12", "milou"))!.description).not.toContain("Senna");
    // De nieuwe editor ziet de meeting direct in het eigen portaal.
    const senna = viewer("senna", "senna@x.nl", "Senna", "editor");
    expect((await svc.getEditorPage(senna)).next?.id).toBe(id.sennaDec);
  });

  it("rondt de plantaak automatisch af zodra alles is ingepland, en heropent bij annuleren", async () => {
    await svc.setEditorOwner(jarno(), id.sem!, id.milou!);
    expect((await planTask("2026-12", "milou"))!.status).toBe("todo");
    const sem = await svc.planMeeting(milou(), { editorId: id.sem!, date: "2026-12-01", time: "11:00" });
    const task = await planTask("2026-12", "milou");
    expect(task!.status).toBe("done");
    expect(task!.completedAt).not.toBeNull();
    // De melding verdwijnt mee.
    expect((await notes("milou")).filter((n) => n.type === "editor_meeting.plan")).toHaveLength(0);
    // Jiska mist Noah nog: haar taak blijft staan.
    expect((await planTask("2026-12", "jiska"))!.status).toBe("todo");
    expect((await planTask("2026-12", "jiska"))!.description).toContain("Nog te plannen: Noah");

    await svc.cancelMeeting(milou(), sem.id);
    const reopened = await planTask("2026-12", "milou");
    expect(reopened!.status).toBe("todo");
    expect(reopened!.description).toContain("Opnieuw plannen: Sem");
    expect((await svc.getOverview(milou(), "2026-12")).rows.find((r) => r.editor.id === id.sem)!.status).toBe("opnieuw_plannen");
    expect(await planTasks()).toHaveLength(2);

    await svc.planMeeting(milou(), { meetingId: sem.id, editorId: id.sem!, date: "2026-12-01", time: "11:00" });
    expect((await planTask("2026-12", "milou"))!.status).toBe("done");
    expect((await meetings()).filter((m) => m.editorId === id.sem)).toHaveLength(1);
  });

  it("3: een editor ziet uitsluitend de eigen meetings, en nooit een concept of interne notities", async () => {
    at("2026-11-26T09:00:00+01:00");
    const noahMeeting = await svc.planMeeting(jiska(), { editorId: id.noah!, date: "2026-12-02", time: "15:00" });
    id.noahDec = noahMeeting.id;
    await expect(svc.getMeetingDetail(quinn(), id.noahDec!)).rejects.toThrow(/niet jouw meeting/);
    await expect(svc.getMeetingDetail(noah(), id.dec!)).rejects.toThrow(/niet jouw meeting/);
    expect((await svc.getEditorPage(noah())).next?.id).toBe(id.noahDec);
    expect((await svc.getEditorPage(noah())).history.every((h) => h.meetingId === null || h.meetingId === id.noahDec)).toBe(true);

    // Na de meeting: Milou bewaart een concept met interne notities.
    at("2026-12-03T16:00:00+01:00");
    await svc.saveReport(
      milou(),
      id.dec!,
      {
        insights: "Sterke maand, hooks zijn duidelijk beter.",
        focusNext: "Let bij KKFH op de nieuwe huisstijl.",
        internalNotes: "Intern: twijfel over tarief, bespreken met Jarno.",
        points: [
          { kind: "sterk", theme: "hook", body: "Hooks pakken direct" },
          { kind: "verbeterpunt", theme: "ondertiteling", body: "Spelling in ondertiteling controleren", example: "KKFH video 3" },
          { kind: "shortclips", theme: "briefings", body: "Briefings missen soms de gewenste lengte" },
        ],
        actions: [
          { body: "Betere controle op spelling in ondertiteling", ownerType: "editor", dueOn: "2026-12-20" },
          { body: "Editing briefings concreter maken", ownerType: "content_creator", dueOn: "2026-12-15" },
          { body: "Nieuwe voorbeeldvideo's toevoegen aan de editing guide", ownerType: "shortclips", assigneeId: id.jarno, dueOn: "2026-12-31" },
        ],
      },
      false,
    );
    const concept = (await svc.getMeetingDetail(quinn(), id.dec!))!;
    expect(concept.mode).toBe("editor");
    expect(concept.meeting.reportStatus).toBe("geen");
    expect(concept.meeting.report).toEqual({});
    expect(concept.meeting.internalNotes).toBeNull();
    expect(concept.points).toEqual([]);
    expect(concept.actions).toEqual([]);
    expect(concept.preparation).toBeNull();
    const page = await svc.getEditorPage(quinn());
    expect(page.openPoints).toEqual([]);
    expect(page.openActions).toEqual([]);
    expect(page.history.find((h) => h.period === "2026-12")).toMatchObject({ hasReport: false, status: "verslag_concept" });
    // Een concept levert nog geen taken en geen melding op.
    expect(await db.select().from(s.tasks).where(like(s.tasks.dedupeKey, "editormeeting:actie:%"))).toHaveLength(0);
    expect((await notes("quinn")).filter((n) => n.type === "editor_meeting.report")).toHaveLength(0);
    // Milou ziet haar concept en de notities wel; een editor kan geen verslag opslaan.
    const team = (await svc.getMeetingDetail(milou(), id.dec!))!;
    expect(team.meeting.reportStatus).toBe("concept");
    expect(team.meeting.internalNotes).toContain("tarief");
    expect(team.points).toHaveLength(3);
    await expect(svc.saveReport(quinn(), id.dec!, { insights: "", focusNext: "", internalNotes: "", points: [], actions: [] }, true)).rejects.toThrow();
    await expect(svc.saveReport(jiska(), id.dec!, { insights: "", focusNext: "", internalNotes: "", points: [], actions: [] }, true)).rejects.toThrow();
  });

  it("5: een gepubliceerd verslag is direct zichtbaar voor de editor", async () => {
    const team = (await svc.getMeetingDetail(milou(), id.dec!))!;
    const res = await svc.saveReport(
      milou(),
      id.dec!,
      {
        insights: team.meeting.report.insights ?? "",
        focusNext: team.meeting.report.focusNext ?? "",
        internalNotes: team.meeting.internalNotes ?? "",
        points: team.points.map((p) => ({ id: p.id, kind: p.kind, theme: p.theme, body: p.body, example: p.example })),
        actions: team.actions.map((a) => ({ id: a.id, body: a.body, ownerType: a.ownerType, assigneeId: a.assigneeId, dueOn: a.dueOn })),
        next: { date: "2027-01-06", time: "10:00", topics: ["Terugblik december"] },
      },
      true,
    );
    expect(res.published).toBe(true);
    id.jan = res.nextId!;

    const d = (await svc.getMeetingDetail(quinn(), id.dec!))!;
    expect(d.meeting.reportStatus).toBe("gepubliceerd");
    expect(d.meeting.report.insights).toBe("Sterke maand, hooks zijn duidelijk beter.");
    expect(d.meeting.internalNotes).toBeNull(); // interne notities blijven intern, ook na publiceren
    expect(d.points.map((p) => p.kind).sort()).toEqual(["shortclips", "sterk", "verbeterpunt"]);
    expect(d.points).toHaveLength(3); // opnieuw opslaan maakt geen dubbele punten
    expect(d.actions).toHaveLength(3);
    const page = await svc.getEditorPage(quinn());
    expect(page.openPoints.map((p) => p.body)).toEqual(["Spelling in ondertiteling controleren"]);
    expect(page.openActions.map((a) => a.body)).toEqual(["Betere controle op spelling in ondertiteling"]);
    expect(page.history.find((h) => h.period === "2026-12")).toMatchObject({ hasReport: true, status: "afgerond" });
    expect(page.development.strengths.map((p) => p.body)).toEqual(["Hooks pakken direct"]);
    // De volgende meeting staat er meteen.
    expect(page.next?.id).toBe(id.jan);
    expect(page.history.find((h) => h.period === "2027-01")?.status).toBe("gepland");

    const n = (await notes("quinn")).filter((x) => x.type === "editor_meeting.report");
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toBe("Het verslag van je editor meeting van december 2026 staat klaar");
    expect(n[0]!.href).toBe(`/editor-meetings/${id.dec}`);
    // Een afgeronde meeting kan niet meer verplaatst of geannuleerd worden.
    await expect(svc.planMeeting(milou(), { meetingId: id.dec, editorId: id.quinn!, date: "2026-12-10", time: "10:00" })).rejects.toThrow(/afgerond/);
    await expect(svc.cancelMeeting(milou(), id.dec!)).rejects.toThrow(/afgerond/);
    // Noah ziet hier niets van.
    await expect(svc.getMeetingDetail(noah(), id.dec!)).rejects.toThrow();
  });

  it("6: actiepunten staan als taak bij de juiste persoon en lopen overal gelijk", async () => {
    const tasks = await db.select().from(s.tasks).where(like(s.tasks.dedupeKey, "editormeeting:actie:%"));
    expect(tasks).toHaveLength(3);
    const byAssignee = new Map(tasks.map((t) => [t.assigneeId, t]));
    expect(byAssignee.get(id.quinn!)!.title).toBe("Editor meeting | Betere controle op spelling in ondertiteling");
    expect(byAssignee.get(id.milou!)!.title).toBe("Editor meeting Quinn | Editing briefings concreter maken");
    expect(byAssignee.get(id.jarno!)!.title).toBe("Editor meeting Quinn | Nieuwe voorbeeldvideo's toevoegen aan de editing guide");
    expect(byAssignee.get(id.quinn!)!.dueOn).toBe("2026-12-20");
    expect(tasks.every((t) => t.entityType === "editor_meeting" && t.entityId === id.dec && t.status === "todo")).toBe(true);
    expect(taskHref(byAssignee.get(id.milou!)!)).toBe(`/editor-meetings/${id.dec}`);
    // Jarno krijgt zijn taak gemeld; Milou wees zichzelf toe en krijgt geen melding.
    expect((await notes("jarno")).filter((n) => n.type === "task_assigned")).toHaveLength(1);
    expect((await notes("milou")).filter((n) => n.type === "task_assigned")).toHaveLength(0);

    // Nogmaals opslaan maakt geen tweede set taken.
    const team = (await svc.getMeetingDetail(milou(), id.dec!))!;
    await svc.saveReport(
      milou(),
      id.dec!,
      {
        insights: team.meeting.report.insights ?? "",
        focusNext: team.meeting.report.focusNext ?? "",
        internalNotes: team.meeting.internalNotes ?? "",
        points: team.points.map((p) => ({ id: p.id, kind: p.kind, theme: p.theme, body: p.body, example: p.example })),
        actions: team.actions.map((a) => ({ id: a.id, body: a.body, ownerType: a.ownerType, assigneeId: a.assigneeId, dueOn: a.dueOn })),
      },
      false,
    );
    expect(await db.select().from(s.tasks).where(like(s.tasks.dedupeKey, "editormeeting:actie:%"))).toHaveLength(3);
    expect((await svc.getMeetingDetail(quinn(), id.dec!))!.meeting.reportStatus).toBe("gepubliceerd");
    expect((await notes("quinn")).filter((x) => x.type === "editor_meeting.report")).toHaveLength(1);

    // De editor vinkt het eigen actiepunt af in het editorportaal: de taak is klaar.
    const own = (await svc.getMeetingDetail(quinn(), id.dec!))!.actions;
    const mineAction = own.find((a) => a.assigneeId === id.quinn)!;
    const milouAction = own.find((a) => a.assigneeId === id.milou)!;
    expect(mineAction.canToggle).toBe(true);
    expect(milouAction.canToggle).toBe(false);
    await expect(svc.setActionDone(quinn(), milouAction.id, true)).rejects.toThrow(/niet van jou/);
    await expect(svc.setActionDone(noah(), mineAction.id, true)).rejects.toThrow();
    await svc.setActionDone(quinn(), mineAction.id, true);
    const [done] = await db.select().from(s.tasks).where(eq(s.tasks.id, byAssignee.get(id.quinn!)!.id));
    expect(done!.status).toBe("done");
    expect(done!.completedAt).not.toBeNull();
    expect((await svc.getMeetingDetail(milou(), id.dec!))!.actions.find((a) => a.id === mineAction.id)!.state).toBe("afgerond");
    expect((await svc.getEditorPage(quinn())).openActions).toEqual([]);
    expect((await svc.getEditorPage(quinn())).development).toMatchObject({ actionsDone: 1, actionsTotal: 1 });

    // Milou rondt haar taak af op de takenpagina: de meeting en het editorportaal volgen.
    await db.update(s.tasks).set({ status: "done", completedAt: new Date() }).where(eq(s.tasks.id, byAssignee.get(id.milou!)!.id));
    expect((await svc.getMeetingDetail(quinn(), id.dec!))!.actions.find((a) => a.id === milouAction.id)!.state).toBe("afgerond");
    expect((await svc.getOverview(jarno(), "2026-12")).rows.find((r) => r.editor.id === id.quinn)!.openActions).toBe(1);
    // En terug openzetten kan ook, door de content creator.
    await svc.setActionDone(milou(), milouAction.id, false);
    expect((await svc.getOverview(jarno(), "2026-12")).rows.find((r) => r.editor.id === id.quinn)!.openActions).toBe(2);
  });

  it("7: afspraken en open actiepunten van de vorige meeting staan klaar bij de volgende", async () => {
    at("2027-01-05T09:00:00+01:00");
    const d = (await svc.getMeetingDetail(milou(), id.jan!))!;
    expect(d.mode).toBe("team");
    expect(d.previous?.id).toBe(id.dec);
    expect(d.previous?.report.insights).toBe("Sterke maand, hooks zijn duidelijk beter.");
    expect(d.previous?.report.focusNext).toBe("Let bij KKFH op de nieuwe huisstijl.");
    expect(d.earlierActions.map((a) => a.body).sort()).toEqual(["Editing briefings concreter maken", "Nieuwe voorbeeldvideo's toevoegen aan de editing guide"]);
    expect(d.earlierPoints.map((p) => p.body)).toEqual(["Spelling in ondertiteling controleren"]);
    expect(d.agendaDraft).toContain("Openstaande actiepunten (2) nalopen");
    expect(d.agendaDraft).toContain("Verbeterpunt vorige keer: Spelling in ondertiteling controleren");
    expect(d.meeting.topics).toEqual(["Terugblik december"]);
    // Voorbereiding over december komt uit de bestaande gegevens; wat er niet is, blijft leeg.
    expect(d.preparation!.reviewPeriod).toBe("2026-12");
    expect(d.preparation!.delivered.projects).toBe(0);
    expect(d.preparation!.avgFeedbackRounds).toBeNull();
    expect(d.preparation!.avgLeadDays).toBeNull();
    expect(d.preparation!.openFeedback.map((x) => x.title)).toEqual(["KKFH november 2"]);
    // De voorbereiding van de decembermeeting (over november) telde het afgeronde project wel.
    const dec = (await svc.getPreparation(id.quinn!, "2026-11"));
    expect(dec.delivered).toEqual({ projects: 1, shorts: 6, byClient: [{ name: "KKFH", projects: 1, shorts: 6 }] });
    expect(dec.avgLeadDays).toBe(10);
    expect(dec.avgFeedbackRounds).toBe(1);

    // Een verbeterpunt dat behaald is verdwijnt bij de editor uit de open lijst en telt als ontwikkeling.
    await svc.setPointStatus(milou(), d.earlierPoints[0]!.id, "behaald");
    await expect(svc.setPointStatus(jiska(), d.earlierPoints[0]!.id, "open")).rejects.toThrow();
    const page = await svc.getEditorPage(quinn());
    expect(page.openPoints).toEqual([]);
    expect(page.development.achieved.map((p) => p.body)).toEqual(["Spelling in ondertiteling controleren"]);
  });

  it("herkent terugkerende feedback en feedback van meerdere editors", async () => {
    at("2027-01-06T12:00:00+01:00");
    await svc.saveReport(
      milou(),
      id.jan!,
      { insights: "", focusNext: "", internalNotes: "", points: [{ kind: "verbeterpunt", theme: "ondertiteling", body: "Weer spelfouten in de ondertiteling" }], actions: [] },
      true,
    );
    at("2026-12-03T10:00:00+01:00"); // verslag van Noah's decembermeeting, door Jiska
    await svc.saveReport(jiska(), id.noahDec!, { insights: "", focusNext: "", internalNotes: "", points: [{ kind: "shortclips", theme: "briefings", body: "Briefing kwam te laat" }], actions: [] }, true);
    at("2027-01-07T09:00:00+01:00");

    const mine = await svc.getInsights(milou());
    expect(mine.recurring).toHaveLength(1);
    expect(mine.recurring[0]!.editor.id).toBe(id.quinn);
    expect(mine.recurring[0]!.themes[0]).toMatchObject({ theme: "ondertiteling", months: 2, label: "Ondertiteling en tekst" });
    expect(mine.shared).toHaveLength(1);
    expect(mine.shared[0]).toMatchObject({ theme: "briefings", editors: 2, names: ["Quinn"] }); // Noah's naam en tekst ziet Milou niet
    expect(mine.shared[0]!.examples).toEqual(["Briefings missen soms de gewenste lengte"]);
    const all = await svc.getInsights(jarno());
    expect(all.shared[0]!.names.sort()).toEqual(["Noah", "Quinn"]);
    expect((await svc.getInsights(jiska())).recurring).toEqual([]);
    expect((await svc.getEditorPage(quinn())).development.recurring.map((r) => r.theme)).toEqual(["ondertiteling"]);
  });

  it("10: blijft correct werken rond de maand- en jaarwisseling", async () => {
    // 24 december: taken voor januari 2027. Quinn staat al gepland (via het verslag).
    at("2026-12-24T07:30:00+01:00");
    const r = await svc.syncPlanTasks();
    expect(r.created).toBe(2);
    const jan = await planTask("2027-01", "milou");
    expect(jan!.title).toBe("Plan de editor meetings voor januari 2027");
    expect(jan!.dueOn).toBe("2026-12-31");
    expect(jan!.description).toContain("Ingepland: Quinn (6 jan 10:00)");
    expect(jan!.description).toContain("Nog te plannen: Sem");
    // De decembertaak van Milou was al afgerond en blijft dat.
    expect((await planTask("2026-12", "milou"))!.status).toBe("done");

    // Oudejaarsdag en nieuwjaarsdag: nog steeds één taak per persoon per maand.
    at("2026-12-31T23:30:00+01:00");
    await svc.syncPlanTasks();
    at("2027-01-01T00:30:00+01:00");
    const jan1 = await svc.syncPlanTasks();
    expect(jan1.created).toBe(0);
    expect((await planTasks()).filter((t) => t.dedupeKey!.includes(":2027-01:"))).toHaveLength(2);
    expect((await planTasks()).filter((t) => t.dedupeKey!.includes(":2027-02:"))).toHaveLength(0);
    // Jiska's decembertaak (Noah bleef ongepland tot 26 nov, daarna gepland) is afgerond, niet vervallen.
    expect((await planTask("2026-12", "jiska"))!.status).toBe("done");
    // De januaritaak blijft zichtbaar zolang er meetings ontbreken, met een herinnering in de nieuwe maand.
    expect((await planTask("2027-01", "milou"))!.status).toBe("todo");
    const reminders = (await notes("milou")).filter((n) => n.type === "editor_meeting.plan" && n.dedupeKey!.includes("2027-01"));
    expect(reminders.map((n) => n.dedupeKey!.split(":").pop()).sort()).toEqual(["laatste-dagen", "maand-gestart", "start"]);

    // Eerste week voorbij en Sem nog niet gepland: over tijd in het overzicht.
    at("2027-01-09T09:00:00+01:00");
    const rows = (await svc.getOverview(jarno(), "2027-01")).rows;
    expect(rows.find((x) => x.editor.id === id.sem)).toMatchObject({ status: "te_plannen", overdue: true });
    expect(rows.find((x) => x.editor.id === id.quinn)).toMatchObject({ status: "afgerond", overdue: false, reportPublished: true });
    // December terugkijken: Sem's meeting is gehouden maar het verslag ontbreekt.
    expect((await svc.getOverview(jarno(), "2026-12")).rows.find((x) => x.editor.id === id.sem)).toMatchObject({ status: "verslag_nodig", overdue: true });
    // November had nog geen meetings: geen taak met terugwerkende kracht, wel zichtbaar als niet gehouden.
    expect((await svc.getOverview(jarno(), "2026-11")).rows.every((x) => x.status === "niet_gehouden" && !x.overdue)).toBe(true);
    expect((await planTasks()).filter((t) => t.dedupeKey!.includes(":2026-11:"))).toHaveLength(0);

    // Februari: de openstaande januaritaken (Milou mist Sem, Jiska mist Noah en Senna)
    // vervallen, er komt er geen tweede voor in de plaats.
    at("2027-02-01T07:30:00+01:00");
    const feb = await svc.syncPlanTasks();
    expect(feb.expired).toBe(2);
    expect((await planTask("2027-01", "milou"))!.status).toBe("cancelled");
    expect((await planTasks()).filter((t) => t.dedupeKey!.includes(":2027-02:"))).toHaveLength(0);
    at("2027-02-21T07:30:00+01:00");
    expect((await svc.syncPlanTasks()).created).toBe(2);
    expect((await planTask("2027-03", "jiska"))!.title).toBe("Plan de editor meetings voor maart 2027");
    const keys = (await planTasks()).map((t) => t.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length); // nergens een dubbele taak
  });

  it("herinnert de content creator één keer aan een ontbrekend verslag", async () => {
    at("2026-12-08T07:30:00+01:00"); // Sem's meeting was 1 dec, verslag ontbreekt
    const before = (await notes("milou")).filter((n) => n.type === "editor_meeting.report_missing").length;
    await svc.syncPlanTasks();
    await svc.syncPlanTasks();
    const after = (await notes("milou")).filter((n) => n.type === "editor_meeting.report_missing");
    expect(after.length - before).toBeLessThanOrEqual(1);
    expect(after.some((n) => n.title === "Verslag editor meeting Sem ontbreekt nog")).toBe(true);
    expect(after.filter((n) => n.title === "Verslag editor meeting Sem ontbreekt nog")).toHaveLength(1);
  });
});
