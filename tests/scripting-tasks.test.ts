import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { clients, productionDays, tasks, users } from "@/db/schema";
import { closeLegacyScriptTodos, syncScriptingTasks } from "@/server/scripting-tasks";
import { taskHref } from "@/lib/task-links";

/**
 * Scriptingstatus → takenpagina, tegen een echte testdatabase (PGlite).
 * Bewijst: aanmaken, bijwerken bij statuswijziging (geen dubbele), afronden,
 * heropenen, verantwoordelijke wisselen, deadline, handmatig afvinken
 * respecteren, vervallen opnames afsluiten en de oude to-do's opruimen.
 */

type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;
let milou: string, jiska: string, jarno: string, clientId: string;

function inDays(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function makeUser(email: string, fullName: string) {
  const [u] = await db.insert(users).values({ email, fullName, status: "active", primaryRole: "content_creator" }).returning({ id: users.id });
  return u!.id;
}
async function makeDay(scheduledOn: string, scriptingStatus = "concepting", scriptWriterId: string | null = null) {
  const [d] = await db.insert(productionDays).values({ clientId, scheduledOn, title: "Opname", scriptingStatus, scriptWriterId }).returning({ id: productionDays.id });
  return d!.id;
}
async function tasksFor(dayId: string) {
  return db.select().from(tasks).where(and(eq(tasks.entityId, dayId), like(tasks.dedupeKey, "scripting:%")));
}
async function openTasksFor(dayId: string) {
  return (await tasksFor(dayId)).filter((t) => ["todo", "in_progress", "blocked"].includes(t.status) && !t.deletedAt);
}
async function setStatus(dayId: string, scriptingStatus: string) {
  await db.update(productionDays).set({ scriptingStatus }).where(eq(productionDays.id, dayId));
  await syncScriptingTasks([dayId]);
}

beforeAll(async () => {
  db = await freshDatabase();
  milou = await makeUser("milou@shortclips.nl", "Milou Sjoerdsma");
  jiska = await makeUser("jiska@shortclips.nl", "Jiska");
  jarno = await makeUser("jarno@shortclips.nl", "Jarno Klijnsma");
  const [c] = await db.insert(clients).values({ slug: "klant-x", name: "Klant X", coordinatorId: jiska }).returning({ id: clients.id });
  clientId = c!.id;
});
afterAll(async () => {
  await closeDatabase();
});

describe("scriptingtaken", () => {
  it("maakt een taak voor de verantwoordelijke met titel, deadline en link naar de sessie", async () => {
    const day = await makeDay(inDays(30), "nog_aanvullen", milou);
    await syncScriptingTasks([day]);
    const open = await openTasksFor(day);
    expect(open).toHaveLength(1);
    const t = open[0]!;
    expect(t.title).toMatch(/^Klant X \| Scripts aanvullen \| Opname \d+ \w+$/);
    expect(t.assigneeId).toBe(milou);
    expect(t.category).toBe("scripting");
    expect(t.source).toBe("automation");
    expect(t.dueOn! < inDays(30)).toBe(true); // scriptdeadline ligt vóór de opname
    expect(taskHref(t)).toBe(`/scripting?sessie=${day}`);
  });

  it("valt terug op de coördinator van de klant als er geen scriptschrijver is", async () => {
    const day = await makeDay(inDays(31), "concepting", null);
    await syncScriptingTasks([day]);
    const [t] = await openTasksFor(day);
    expect(t!.assigneeId).toBe(jiska);
    expect(t!.title).toContain("Scripts opstellen");
  });

  it("werkt dezelfde taak bij bij een statuswijziging en maakt geen dubbele", async () => {
    const day = await makeDay(inDays(32), "concepting", milou);
    await syncScriptingTasks([day]);
    const [first] = await openTasksFor(day);
    await setStatus(day, "feedback_jarno");
    await syncScriptingTasks([day]);
    await syncScriptingTasks(); // ook een volledige run mag niets verdubbelen
    const all = await tasksFor(day);
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(first!.id);
    expect(all[0]!.title).toContain("Scripts aanpassen");
  });

  it("zet de taak bij Controle Jarno op Jarno", async () => {
    const day = await makeDay(inDays(33), "concepting", milou);
    await setStatus(day, "controle_jarno");
    const [t] = await openTasksFor(day);
    expect(t!.assigneeId).toBe(jarno);
    expect(t!.title).toContain("Scripts controleren");
  });

  it("rondt de taak af bij Final en bij wachten op de klant, en heropent dezelfde taak als er weer werk is", async () => {
    const day = await makeDay(inDays(34), "concepting", milou);
    await syncScriptingTasks([day]);
    const [first] = await openTasksFor(day);

    await setStatus(day, "scripts_bij_klant");
    expect(await openTasksFor(day)).toHaveLength(0);
    expect((await tasksFor(day))[0]!.status).toBe("done");

    await setStatus(day, "feedback_jarno");
    const reopened = await openTasksFor(day);
    expect(reopened).toHaveLength(1);
    expect(reopened[0]!.id).toBe(first!.id);

    await setStatus(day, "final");
    const all = await tasksFor(day);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("done");
    expect(all[0]!.completedAt).not.toBeNull();
  });

  it("verplaatst de taak mee als de verantwoordelijke verandert", async () => {
    const day = await makeDay(inDays(35), "concepting", milou);
    await syncScriptingTasks([day]);
    await db.update(productionDays).set({ scriptWriterId: jiska }).where(eq(productionDays.id, day));
    await syncScriptingTasks([day]);
    const all = await tasksFor(day);
    expect(all).toHaveLength(1);
    expect(all[0]!.assigneeId).toBe(jiska);
  });

  it("past de deadline aan als de opname verschuift", async () => {
    const day = await makeDay(inDays(36), "concepting", milou);
    await syncScriptingTasks([day]);
    const before = (await openTasksFor(day))[0]!.dueOn;
    await db.update(productionDays).set({ scheduledOn: inDays(50) }).where(eq(productionDays.id, day));
    await syncScriptingTasks([day]);
    const after = (await openTasksFor(day))[0]!;
    expect(after.dueOn! > before!).toBe(true);
  });

  it("respecteert handmatig afvinken tot de status verandert", async () => {
    const day = await makeDay(inDays(37), "nog_aanvullen", milou);
    await syncScriptingTasks([day]);
    const [t] = await openTasksFor(day);
    await db.update(tasks).set({ status: "done", completedAt: new Date() }).where(eq(tasks.id, t!.id));
    await syncScriptingTasks([day]);
    expect(await openTasksFor(day)).toHaveLength(0); // niet teruggezet

    // Status wisselt via wachten bij de klant en komt terug op aanvullen: nieuwe ronde, weer een taak.
    await setStatus(day, "afwachting_klant");
    await setStatus(day, "nog_aanvullen");
    const open = await openTasksFor(day);
    expect(open).toHaveLength(1);
    expect(open[0]!.id).toBe(t!.id);
    expect(await tasksFor(day)).toHaveLength(1);
  });

  it("sluit de taak als de opname vervalt", async () => {
    const day = await makeDay(inDays(38), "concepting", milou);
    await syncScriptingTasks([day]);
    await db.update(productionDays).set({ status: "cancelled" }).where(eq(productionDays.id, day));
    await syncScriptingTasks(); // volledige run vindt de open taak via de taak zelf
    const all = await tasksFor(day);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("cancelled");
  });

  it("neemt bij een volledige run alle bestaande open sessies mee, en geen sessies die al final zijn", async () => {
    const a = await makeDay(inDays(40), "scriptmeeting", milou);
    const b = await makeDay(inDays(41), "final", milou);
    const c = await makeDay(inDays(42), "scripts_bij_klant", milou);
    await syncScriptingTasks();
    expect(await openTasksFor(a)).toHaveLength(1);
    expect(await openTasksFor(b)).toHaveLength(0);
    expect(await openTasksFor(c)).toHaveLength(0);
    // Tweede volledige run: niets nieuws.
    const second = await syncScriptingTasks();
    expect(second.created).toBe(0);
  });

  it("sluit de oude 'Script afronden/afstemmen'-to-do's", async () => {
    const day = await makeDay(inDays(43), "concepting", milou);
    await db.insert(tasks).values({ clientId, title: "Script afronden/afstemmen — Klant X", status: "todo", entityType: "production_day", entityId: day, source: "automation", dedupeKey: `script_todo:${day}` });
    const n = await closeLegacyScriptTodos();
    expect(n).toBe(1);
    const [legacy] = await db.select().from(tasks).where(eq(tasks.dedupeKey, `script_todo:${day}`));
    expect(legacy!.status).toBe("cancelled");
  });
});
