import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { clients, productionDays, tasks, users } from "@/db/schema";
import { closeLegacyScriptTodos, syncScriptingTasks } from "@/server/scripting-tasks";

/**
 * Scriptingtaken: automatisch aanmaken staat bewust uit (commit "Takenpagina
 * rustiger: scripting-autotaken uit"). De sync maakt nooit meer taken aan en
 * sluit alleen nog bestaande, automatisch aangemaakte scriptingtaken. Handmatige
 * taken en taken van andere automatiseringen blijven staan.
 */

type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;
let milou: string, clientId: string;

function inDays(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
async function makeDay(scheduledOn: string, scriptingStatus = "concepting") {
  const [d] = await db.insert(productionDays).values({ clientId, scheduledOn, title: "Opname", scriptingStatus, scriptWriterId: milou }).returning({ id: productionDays.id });
  return d!.id;
}
async function openScripting(dayId: string) {
  return (await db.select().from(tasks).where(and(eq(tasks.entityId, dayId), like(tasks.dedupeKey, "scripting:%")))).filter((t) => ["todo", "in_progress", "blocked"].includes(t.status));
}

beforeAll(async () => {
  db = await freshDatabase();
  const [u] = await db.insert(users).values({ email: "milou@shortclips.nl", fullName: "Milou", status: "active", primaryRole: "content_creator" }).returning({ id: users.id });
  milou = u!.id;
  const [c] = await db.insert(clients).values({ slug: "klant-x", name: "Klant X", coordinatorId: milou }).returning({ id: clients.id });
  clientId = c!.id;
});
afterAll(async () => {
  await closeDatabase();
});

describe("scriptingtaken (autotaken uit)", () => {
  it("maakt geen nieuwe taak aan, ook niet bij een openstaande scriptingstatus", async () => {
    const day = await makeDay(inDays(30), "nog_aanvullen");
    const r = await syncScriptingTasks([day]);
    expect(r.created).toBe(0);
    expect(await openScripting(day)).toHaveLength(0);
  });

  it("sluit een bestaande automatische scriptingtaak van die opname", async () => {
    const day = await makeDay(inDays(20));
    await db.insert(tasks).values({ clientId, title: "Klant X | script schrijven | opname", status: "todo", source: "automation", assigneeId: milou, entityType: "production_day", entityId: day, dedupeKey: `scripting:${day}` });
    const r = await syncScriptingTasks([day]);
    expect(r.closed).toBe(1);
    expect(await openScripting(day)).toHaveLength(0);
  });

  it("laat handmatige taken en andere automatiseringen staan", async () => {
    const day = await makeDay(inDays(10));
    await db.insert(tasks).values({ clientId, title: "Handmatig", status: "todo", source: "manual", assigneeId: milou, entityType: "production_day", entityId: day });
    await db.insert(tasks).values({ clientId, title: "Maandrapportage", status: "todo", source: "automation", assigneeId: milou, dedupeKey: "maandrapportage:x" });
    await syncScriptingTasks();
    const open = (await db.select().from(tasks).where(eq(tasks.clientId, clientId))).filter((t) => t.status === "todo");
    expect(open.map((t) => t.title).sort()).toEqual(["Handmatig", "Maandrapportage"]);
  });

  it("ruimt de oude to-do's 'Script afronden' op", async () => {
    await db.insert(tasks).values({ clientId, title: "Script afronden", status: "todo", source: "automation", assigneeId: milou, dedupeKey: "script_todo:oud" });
    expect(await closeLegacyScriptTodos()).toBe(1);
  });
});
