import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import type { CalendarSource } from "@/server/jobs/calendar-sync";
import type { CalendarEvent } from "@/server/integrations/google-calendar";
import { classifyAppointment } from "@/server/integrations/calendar-matching";

/**
 * Editing-integriteit: één editing-project per opname en één editortoewijzing
 * die overal gelijk loopt. Elke test hier is een scenario dat in productie
 * dubbele projecten of een verkeerde editor opleverde.
 */
describe("Editing-integriteit", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let integ: typeof import("@/server/editing/integrity");
  let sync: typeof import("@/server/jobs/calendar-sync");
  let clientId = "";
  let quinn = "";
  let noah = "";

  beforeEach(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    integ = await import("@/server/editing/integrity");
    sync = await import("@/server/jobs/calendar-sync");
    const [c] = await db.insert(s.clients).values({ slug: "kkfh", name: "KKFH", editorName: "Quinn" }).returning({ id: s.clients.id });
    clientId = c!.id;
    const [q] = await db.insert(s.users).values({ email: "quinn@x.nl", fullName: "Quinn", status: "active", primaryRole: "editor" }).returning({ id: s.users.id });
    const [n] = await db.insert(s.users).values({ email: "noah@x.nl", fullName: "Noah", status: "active", primaryRole: "editor" }).returning({ id: s.users.id });
    quinn = q!.id;
    noah = n!.id;
  });
  afterAll(async () => { await closeDatabase(); });

  async function shoot(on = "2026-12-01") {
    const [pd] = await db.insert(s.productionDays).values({ clientId, title: "Opname", scheduledOn: on, status: "planned" }).returning({ id: s.productionDays.id });
    return pd!.id;
  }
  async function project(pdId: string, extra: Partial<typeof s.deliverables.$inferInsert> = {}, createdAt = new Date()) {
    const [d] = await db.insert(s.deliverables).values({ clientId, productionDayId: pdId, title: "KKFH", status: "recorded", createdAt, ...extra }).returning({ id: s.deliverables.id });
    return d!.id;
  }
  const liveProjects = async (pdId: string) =>
    db.select().from(s.deliverables).where(and(eq(s.deliverables.productionDayId, pdId), isNull(s.deliverables.deletedAt)));

  it("voegt Monday-import en agenda-project op dezelfde opname samen tot één", async () => {
    const pd = await shoot();
    await project(pd, { title: "KKFH #1", footageUrl: "https://drive/x", editorId: quinn }, new Date("2026-10-18"));
    await project(pd, { title: "9:00 - KKFH OPNAMES", plannedShorts: 6 }, new Date("2026-10-22"));

    const r = await integ.mergeDuplicateDeliverables();
    expect(r.merged).toBe(1);
    const left = await liveProjects(pd);
    expect(left.length).toBe(1);
    // Niets kwijt: downloadlink én aantal shorts staan op het overgebleven project.
    expect(left[0]!.footageUrl).toBe("https://drive/x");
    expect(left[0]!.plannedShorts).toBe(6);
    // Opnamedag volgt de editor van het project.
    const [day] = await db.select().from(s.productionDays).where(eq(s.productionDays.id, pd));
    expect(day!.editorId).toBe(quinn);
  });

  it("telt de automatische, lege QC-checklist niet als werk, een afgevinkte check wel", async () => {
    const pd = await shoot();
    const a = await project(pd, {}, new Date("2026-10-18"));
    const b = await project(pd, {}, new Date("2026-10-22"));
    await db.insert(s.qcChecks).values([{ deliverableId: a, label: "Hook" }, { deliverableId: b, label: "Hook" }]);
    expect((await integ.mergeDuplicateDeliverables()).merged).toBe(1);

    const pd2 = await shoot("2026-12-02");
    await project(pd2, {}, new Date("2026-10-18"));
    const checked = await project(pd2, {}, new Date("2026-10-22"));
    await db.insert(s.qcChecks).values({ deliverableId: checked, label: "Hook", done: true });
    await integ.mergeDuplicateDeliverables();
    const left = await liveProjects(pd2);
    expect(left.length).toBe(1);
    expect(left[0]!.id).toBe(checked);
  });

  it("verhuist een project van een geannuleerde opname naar de opnieuw ingeplande opname op dezelfde dag", async () => {
    const oldPd = await shoot("2026-12-08");
    await db.update(s.productionDays).set({ status: "cancelled" }).where(eq(s.productionDays.id, oldPd));
    await project(oldPd, { title: "SHADES #3" }, new Date("2026-10-18"));
    const newPd = await shoot("2026-12-08");
    await project(newPd, { title: "9:00 - Opnamesessie" }, new Date("2026-11-03"));
    await integ.mergeDuplicateDeliverables();
    expect((await liveProjects(oldPd)).length).toBe(0);
    expect((await liveProjects(newPd)).length).toBe(1);
  });

  it("haalt nooit een project weg waar al aan gewerkt wordt", async () => {
    const pd = await shoot();
    await project(pd, { status: "editing", currentVersion: 1 });
    await project(pd, { status: "editing" });
    const r = await integ.mergeDuplicateDeliverables();
    expect(r.merged).toBe(0);
    expect((await liveProjects(pd)).length).toBe(2);
  });

  it("editor per klant wijzigen zet opname én niet-gestarte projecten om, lopend werk blijft", async () => {
    const pdFuture = await shoot("2026-12-01");
    const open = await project(pdFuture, { editorId: quinn });
    const pdBusy = await shoot("2026-11-01");
    const busy = await project(pdBusy, { editorId: quinn, status: "editing" });
    await db.update(s.productionDays).set({ editorId: quinn });

    await integ.propagateClientEditor(clientId, noah);

    const [o] = await db.select().from(s.deliverables).where(eq(s.deliverables.id, open));
    const [b] = await db.select().from(s.deliverables).where(eq(s.deliverables.id, busy));
    const [dFuture] = await db.select().from(s.productionDays).where(eq(s.productionDays.id, pdFuture));
    const [dBusy] = await db.select().from(s.productionDays).where(eq(s.productionDays.id, pdBusy));
    expect(o!.editorId).toBe(noah);
    expect(dFuture!.editorId).toBe(noah);
    expect(b!.editorId).toBe(quinn);
    expect(dBusy!.editorId).toBe(quinn);
  });

  it("kiest bij twee accounts met dezelfde voornaam het account waarmee de editor inlogt", async () => {
    await db.insert(s.users).values({ email: "sam@x.nl", fullName: "Sem", status: "active", primaryRole: "editor" });
    const [real] = await db.insert(s.users).values({ email: "sem@x.nl", fullName: "Sem", status: "active", primaryRole: "editor", lastLoginAt: new Date() }).returning({ id: s.users.id });
    const map = await integ.editorIdsByKey();
    expect(map.get("sem")).toBe(real!.id);
  });

  const ev = (id: string, summary: string, date = "2026-12-17"): CalendarEvent => ({
    id, summary, start: { dateTime: `${date}T09:00:00+01:00` }, end: { dateTime: `${date}T16:00:00+01:00` }, status: "confirmed",
  });
  const source = (events: () => CalendarEvent[]): CalendarSource => ({
    isConfigured: true,
    configuredCalendarIds: ["team"],
    async listCalendars() { return [{ id: "team", summary: "Team Shortclips afspraken" }]; },
    async listEvents() { return events(); },
  });

  it("agenda-sync hergebruikt een bestaande opname op dezelfde klant + datum i.p.v. een tweede aan te maken", async () => {
    const pd = await shoot("2026-12-17");
    await project(pd, { title: "KKFH #2" });
    await sync.runCalendarSync({ source: source(() => [ev("e1", "9:00 - KKFH Opnamesessie")]), windowDaysForward: 400 });
    const days = await db.select().from(s.productionDays).where(and(eq(s.productionDays.clientId, clientId), isNull(s.productionDays.deletedAt)));
    expect(days.length).toBe(1);
    expect((await liveProjects(pd)).length).toBe(1);
  });

  it("verwijderen van één kopie annuleert de opname niet zolang er nog een afspraak is", async () => {
    let events = [ev("e1", "9:00 - KKFH Opnamesessie"), ev("e2", "KKFH opname")];
    const src = source(() => events);
    await sync.runCalendarSync({ source: src, windowDaysForward: 400 });
    events = [ev("e2", "KKFH opname")];
    await sync.runCalendarSync({ source: src, windowDaysForward: 400 });
    const days = await db.select().from(s.productionDays).where(and(eq(s.productionDays.clientId, clientId), isNull(s.productionDays.deletedAt)));
    expect(days.length).toBe(1);
    expect(days[0]!.status).not.toBe("cancelled");
    expect((await liveProjects(days[0]!.id)).length).toBe(1);
  });

  it("evaluatiemeeting tijdens of na een opname is geen opname", () => {
    expect(classifyAppointment("Evaluatie meeting Hegro tijdens opname", "Team Shortclips afspraken")).not.toBe("opname");
    expect(classifyAppointment("Evaluatie 2027 - Koops Chalets na opname", "Team Shortclips afspraken")).not.toBe("opname");
    expect(classifyAppointment("9:00 - HEGRO Opnamesessie", "Team Shortclips afspraken")).toBe("opname");
    expect(classifyAppointment("9:00 Koops opnamesessie ", "Team Shortclips afspraken")).toBe("opname");
  });
});
