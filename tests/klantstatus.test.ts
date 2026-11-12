import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { automationRules, clientReports, clients, deliverables, notifications, productionDays, tasks, users } from "@/db/schema";

/**
 * Centrale klantstatus, tegen een echte testdatabase (PGlite). Drie situaties:
 *  A. actieve klant: alle normale processen blijven werken;
 *  B. klant wordt niet actief: automatische taken, meldingen, rapportages en
 *     controles stoppen; lopend werk komt in één beoordelingstaak; niets wordt
 *     verwijderd;
 *  C. klant wordt weer actief: de juiste processen starten opnieuw, zonder
 *     dubbele taken of oude meldingen.
 */

type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;
let jiska: string, jarno: string, editor: string;
let actief: string, wisselt: string;
let dayActief: string, dayWisselt: string;

function inDays(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
async function makeUser(email: string, fullName: string, primaryRole = "content_creator") {
  const [u] = await db.insert(users).values({ email, fullName, status: "active", primaryRole: primaryRole as "owner" }).returning({ id: users.id });
  return u!.id;
}
async function makeClient(slug: string, name: string) {
  const [c] = await db.insert(clients).values({ slug, name, coordinatorId: jiska, status: "active" }).returning({ id: clients.id });
  return c!.id;
}
async function setStatus(clientId: string, to: "active" | "paused" | "churned") {
  const { applyClientStatusTransition } = await import("@/server/client-status-transition");
  const [c] = await db.select({ status: clients.status }).from(clients).where(eq(clients.id, clientId));
  await db.update(clients).set({ status: to }).where(eq(clients.id, clientId));
  return applyClientStatusTransition(clientId, c!.status, to);
}
async function openTasks(clientId: string) {
  return db.select().from(tasks).where(and(eq(tasks.clientId, clientId), inArray(tasks.status, ["todo", "in_progress", "blocked"])));
}
async function dailyContractSignal(clientId: string, entityId: string) {
  const { dispatch } = await import("@/server/automation");
  await dispatch({
    trigger: "schedule.daily",
    clientId,
    entityType: "contract",
    entityId,
    data: { contractEndsInDays: 60, periodKey: "2026-12-31", title: "Contract loopt af", coordinatorId: jiska },
  });
}

beforeAll(async () => {
  db = await freshDatabase();
  jiska = await makeUser("jiska@shortclips.nl", "Jiska");
  jarno = await makeUser("jarno@shortclips.nl", "Jarno Klijnsma", "owner");
  editor = await makeUser("editor@example.com", "Editor Test", "editor");
  actief = await makeClient("klant-actief", "Klant Actief");
  wisselt = await makeClient("klant-wisselt", "Klant Wisselt");

  // Een automatiseringsregel die bij het dagelijkse contractsignaal een taak maakt.
  await db.insert(automationRules).values({
    key: "test_contract_task",
    name: "Contract loopt af → taak",
    trigger: "schedule.daily",
    conditions: { contractEndsInDays: 60 },
    actions: [{ type: "create_task", title: "Verlenging bespreken" }],
  });

  // Aankomende opname met openstaand scriptingwerk bij beide klanten.
  const [d1] = await db.insert(productionDays).values({ clientId: actief, scheduledOn: inDays(30), title: "Opname", scriptingStatus: "concepting" }).returning({ id: productionDays.id });
  const [d2] = await db.insert(productionDays).values({ clientId: wisselt, scheduledOn: inDays(30), title: "Opname", scriptingStatus: "concepting" }).returning({ id: productionDays.id });
  dayActief = d1!.id;
  dayWisselt = d2!.id;

  // Lopend werk bij de klant die straks niet actief wordt.
  await db.insert(deliverables).values({ clientId: wisselt, title: "Video in edit", status: "editing", editorId: editor, dueOn: inDays(-3), shootOn: inDays(-20) });
  await db.insert(tasks).values({ clientId: wisselt, title: "Handmatige klanttaak", status: "todo", source: "manual", assigneeId: jiska, dueOn: inDays(1) });
  await db.insert(clientReports).values({ clientId: wisselt, periodType: "month", period: "2026-10", title: "Maandrapport", status: "gegevens_verzamelen" });
});
afterAll(async () => {
  await closeDatabase();
});

describe("A. actieve klant", () => {
  it("krijgt automatische taken en meldingen zoals altijd (scripting-autotaken staan uit)", async () => {
    const { syncScriptingTasks } = await import("@/server/scripting-tasks");
    const { notify } = await import("@/server/notifications");
    await syncScriptingTasks([dayActief, dayWisselt]);
    await dailyContractSignal(actief, "00000000-0000-4000-8000-000000000001");
    await dailyContractSignal(wisselt, "00000000-0000-4000-8000-000000000002");

    const a = await openTasks(actief);
    // Scripting-autotaken zijn bewust uitgezet (Scriptingpagina is de plek daarvoor).
    expect(a.filter((t) => t.dedupeKey?.startsWith("scripting:"))).toHaveLength(0);
    expect(a.filter((t) => t.title === "Verlenging bespreken")).toHaveLength(1);
    expect((await openTasks(wisselt)).filter((t) => t.source === "automation")).toHaveLength(1);

    const sent = await notify({ userIds: [jiska], clientId: actief, type: "content_gap", title: "Signaal", dedupeKey: "test:a1" });
    expect(sent).toBe(1);
  });

  it("staat op de operationele overzichten", async () => {
    const { viewerForUser } = await import("@/server/auth/context");
    const { listScripting } = await import("@/server/scripting");
    const viewer = (await viewerForUser(jarno))!;
    const { rows } = await listScripting(viewer, { trusted: true });
    const names = new Set(rows.map((r) => r.clientName));
    expect(names.has("Klant Actief")).toBe(true);
    expect(names.has("Klant Wisselt")).toBe(true);
  });
});

describe("B. klant wordt niet actief", () => {
  let result: Awaited<ReturnType<typeof setStatus>>;

  it("stopt automatische taken, sluit scripting en houdt lopend werk ter beoordeling", async () => {
    // Een ongelezen automatische melding van vóór de wissel.
    await db.insert(notifications).values({ userId: jiska, clientId: wisselt, type: "content_gap", title: "Oud signaal", dedupeKey: "test:oud" });

    result = await setStatus(wisselt, "paused");
    expect(result.direction).toBe("deactivated");
    expect(result.cancelledTasks).toBe(1); // contract-taak
    expect(result.scriptingClosed).toBe(0); // er worden geen scriptingtaken meer aangemaakt
    expect(result.mutedNotifications).toBe(1);
    expect(result.stoppedReports).toBe(1);

    const open = await openTasks(wisselt);
    // Over: de handmatige taak (lopend werk) + de beoordelingstaak.
    expect(open.map((t) => t.title).sort()).toEqual(["Handmatige klanttaak", "Klant Wisselt: niet actief, lopend werk beoordelen"]);
    const review = open.find((t) => t.dedupeKey?.startsWith("klantstatus_review:"))!;
    expect(review.assigneeId).toBe(jiska);
    expect(review.description).toContain("Video in edit");
    expect(review.description).toContain("Handmatige klanttaak");
    expect(review.description).toContain("Verlenging bespreken");

    // Niets verwijderd: geannuleerde taken en het rapport bestaan nog.
    const cancelled = await db.select().from(tasks).where(and(eq(tasks.clientId, wisselt), eq(tasks.status, "cancelled")));
    expect(cancelled.length).toBe(1); // de contract-taak (scripting-autotaken bestaan niet meer)
    expect(cancelled.every((t) => t.deletedAt === null)).toBe(true);
    const [rep] = await db.select().from(clientReports).where(eq(clientReports.clientId, wisselt));
    expect(rep!.status).toBe("mislukt");
    expect(rep!.deletedAt).toBeNull();

    // De beoordelingsmelding gaat wél naar de verantwoordelijke.
    const review_n = await db.select().from(notifications).where(and(eq(notifications.clientId, wisselt), eq(notifications.type, "client_status_review")));
    expect(review_n).toHaveLength(1);
  });

  it("veroorzaakt geen nieuwe automatische taken, meldingen of scriptingtaken meer", async () => {
    const { syncScriptingTasks } = await import("@/server/scripting-tasks");
    const { notify } = await import("@/server/notifications");
    await dailyContractSignal(wisselt, "00000000-0000-4000-8000-000000000002");
    await syncScriptingTasks([dayWisselt]);
    expect((await openTasks(wisselt)).filter((t) => t.source === "automation")).toHaveLength(0);

    expect(await notify({ userIds: [jiska], clientId: wisselt, type: "content_gap", title: "Signaal", dedupeKey: "test:b1" })).toBe(0);
    // Ook als alleen de entiteit naar de klant wijst.
    expect(await notify({ userIds: [jiska], entityType: "client", entityId: wisselt, type: "client_without_shoot", title: "Signaal", dedupeKey: "test:b2" })).toBe(0);
    // Een handeling van een mens (taak toewijzen) gaat wel door.
    expect(await notify({ userIds: [jiska], clientId: wisselt, type: "task_assigned", title: "Taak voor jou", dedupeKey: "test:b3" })).toBe(1);
    // De actieve klant merkt er niets van.
    expect(await notify({ userIds: [jiska], clientId: actief, type: "content_gap", title: "Signaal", dedupeKey: "test:b4" })).toBe(1);
  });

  it("telt niet mee in herinneringen en controles", async () => {
    const { runTaskDeadlineReminders, runEditorDeadlineReminders } = await import("@/server/jobs/maintenance");
    const { runClientNotifications } = await import("@/server/jobs/notifications");
    await db.delete(notifications);
    await runTaskDeadlineReminders();
    await runEditorDeadlineReminders();
    // Jiska heeft alleen taken bij de niet actieve klant met een deadline → geen taakherinnering.
    const jiskaN = await db.select().from(notifications).where(and(eq(notifications.userId, jiska), eq(notifications.type, "task_deadlines")));
    expect(jiskaN).toHaveLength(0);
    // De editor heeft alleen werk bij de niet actieve klant → geen deadline-herinnering.
    const edN = await db.select().from(notifications).where(eq(notifications.userId, editor));
    expect(edN).toHaveLength(0);

    // Klantportaal: video bij de klant ter controle → geen portaalmelding voor de niet actieve klant.
    await db.insert(deliverables).values({ clientId: wisselt, title: "Klaar voor klant", status: "client_review" });
    const r = await runClientNotifications();
    expect(r.created).toBe(0);
  });

  it("verdwijnt standaard van de operationele pagina's, maar blijft zichtbaar via het filter", async () => {
    const { viewerForUser } = await import("@/server/auth/context");
    const { listScripting } = await import("@/server/scripting");
    const { listVideos } = await import("@/server/videos");
    const viewer = (await viewerForUser(jarno))!;
    const def = await listScripting(viewer, { trusted: true });
    expect(def.rows.some((r) => r.clientName === "Klant Wisselt")).toBe(false);
    const inactive = await listScripting(viewer, { trusted: true, klanten: "niet_actief" });
    expect(inactive.rows.map((r) => r.clientName)).toEqual(["Klant Wisselt"]);
    const alle = await listScripting(viewer, { trusted: true, klanten: "alle" });
    expect(alle.rows).toHaveLength(2);

    const videosDefault = await listVideos(viewer);
    expect(videosDefault.some((v) => v.clientId === wisselt)).toBe(false);
    const videosInactive = await listVideos(viewer, { klanten: "niet_actief" });
    expect(videosInactive.filter((v) => v.clientId === wisselt).length).toBeGreaterThan(0);
  });

  it("telt niet mee in de maandcontrole op Vandaag", async () => {
    const { viewerForUser } = await import("@/server/auth/context");
    const { reportWorkSummary } = await import("@/server/reports/today");
    const base = (await viewerForUser(jarno))!;
    const viewer = { ...base, permissions: new Set([...base.permissions, "reports:read"]) };
    // Het gestopte rapport (mislukt) van de niet actieve klant is geen werk voor vandaag.
    expect(await reportWorkSummary(viewer as typeof base, "2026-11-09")).toBeNull();
    // Een mislukt rapport van een actieve klant wel.
    await db.insert(clientReports).values({ clientId: actief, periodType: "month", period: "2026-10", title: "Maandrapport", status: "mislukt" });
    expect((await reportWorkSummary(viewer as typeof base, "2026-11-09"))?.mislukt).toBe(1);
  });

  it("het nachtelijke vangnet is idempotent en maakt geen extra beoordelingstaak", async () => {
    const { sweepInactiveClients } = await import("@/server/client-status-transition");
    const again = await setStatus(wisselt, "churned"); // paused → churned: blijft niet actief
    expect(again.direction).toBe("none");
    const s = await sweepInactiveClients();
    expect(s.cancelledTasks).toBe(0);
    const reviews = await db.select().from(tasks).where(and(eq(tasks.clientId, wisselt), like(tasks.dedupeKey, "klantstatus_review:%")));
    expect(reviews).toHaveLength(1);
  });
});

describe("C. klant wordt weer actief", () => {
  it("start de juiste processen opnieuw, zonder dubbele taken of oude meldingen", async () => {
    const { syncScriptingTasks } = await import("@/server/scripting-tasks");
    const r = await setStatus(wisselt, "active");
    expect(r.direction).toBe("reactivated");
    expect(r.scriptingCreated).toBe(0); // scripting-autotaken staan uit

    // Beoordelingstaak vervalt.
    const open = await openTasks(wisselt);
    expect(open.some((t) => t.dedupeKey?.startsWith("klantstatus_review:"))).toBe(false);

    // Scripting: autotaken staan uit, dus ook na een sync geen scriptingtaak.
    await syncScriptingTasks([dayWisselt]);
    const scripting = (await openTasks(wisselt)).filter((t) => t.dedupeKey?.startsWith("scripting:"));
    expect(scripting).toHaveLength(0);

    // Het contractsignaal maakt weer één nieuwe taak (de geannuleerde blokkeert niet), en niet twee.
    await dailyContractSignal(wisselt, "00000000-0000-4000-8000-000000000002");
    await dailyContractSignal(wisselt, "00000000-0000-4000-8000-000000000002");
    expect((await openTasks(wisselt)).filter((t) => t.title === "Verlenging bespreken")).toHaveLength(1);

    // Meldingen werken weer; tegengehouden meldingen bestaan niet en komen dus niet alsnog.
    const { notify } = await import("@/server/notifications");
    expect(await notify({ userIds: [jiska], clientId: wisselt, type: "content_gap", title: "Signaal", dedupeKey: "test:c1" })).toBe(1);
    const old = await db.select().from(notifications).where(sql`${notifications.dedupeKey} in ('test:b1','test:b2')`);
    expect(old).toHaveLength(0);

    // Lopend werk staat er nog gewoon (niets verwijderd).
    const vids = await db.select().from(deliverables).where(eq(deliverables.clientId, wisselt));
    expect(vids.every((v) => v.deletedAt === null)).toBe(true);
  });
});
