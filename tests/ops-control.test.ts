import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { clients, notifications, opsControlItems, opsControlRuns, tasks, users } from "@/db/schema";
import type { OpsDomainHealth } from "@/db/schema";
import { runOpsControl, runOpsControlScheduled } from "@/server/ops-control/run";
import { collectFindings } from "@/server/ops-control/findings";
import { amsterdamClock, domainState, dueSlot, planItems, type Finding } from "@/lib/ops-control/plan";

/**
 * Operationele controle tegen een echte testdatabase (PGlite). De bronnen
 * (signalen uit de Hub) worden per scenario vastgezet, zodat precies te zien is
 * wat de controle doet: taken aanmaken, niet dubbelen, afronden, heropenen,
 * escaleren, Jarno alleen bij uitzonderingen, en niets afsluiten als een bron
 * niet bereikbaar is.
 */

type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;
let jarno: string, milou: string, jiska: string, rutger: string, editorSam: string, kkfh: string, donker: string;

// Maandag 9 t/m vrijdag 13 november 2026 (wintertijd: Amsterdam = UTC+1).
const MA_0905 = new Date("2026-11-09T08:05:00Z");
const MA_1505 = new Date("2026-11-09T14:05:00Z");
const DI_0905 = new Date("2026-11-10T08:05:00Z");
const WO_0905 = new Date("2026-11-11T08:05:00Z");
const DO_0905 = new Date("2026-11-12T08:05:00Z");
const VR_0905 = new Date("2026-11-13T08:05:00Z");

const CHECKED: OpsDomainHealth[] = (["scripting", "editing", "klantfeedback", "klantcommunicatie", "opname", "taken"] as const)
  .map((domain) => ({ domain, check: "checked" as const }));

function finding(p: Partial<Finding> & Pick<Finding, "key" | "domain" | "category" | "action">): Finding {
  return {
    clientId: null, clientLabel: null, ownerId: null, reason: "Test", href: "/videos", priority: "hoog",
    severity: "oranje", verifiable: true, snoozeWorkdays: 0, createTask: true, ...p,
  };
}
const source = (findings: Finding[], health = CHECKED) => async () => ({ findings: structuredClone(findings), health, errors: [] });

async function makeUser(email: string, fullName: string, primaryRole: "owner" | "content_creator" | "videographer" | "editor" = "content_creator") {
  const [u] = await db.insert(users).values({ email, fullName, status: "active", primaryRole }).returning({ id: users.id });
  return u!.id;
}
async function item(key: string) {
  const [r] = await db.select().from(opsControlItems).where(eq(opsControlItems.itemKey, key));
  return r;
}
async function taskOf(key: string) {
  return db.select().from(tasks).where(like(tasks.dedupeKey, `opscontrol:%${key}%`));
}
async function notes(userId: string, type?: string) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  return type ? rows.filter((r) => r.type === type) : rows;
}

beforeAll(async () => {
  db = await freshDatabase();
  jarno = await makeUser("jarno@shortclips.nl", "Jarno Klijnsma", "owner");
  milou = await makeUser("milou@shortclips.nl", "Milou Sjoerdsma");
  jiska = await makeUser("jiska@shortclips.nl", "Jiska");
  rutger = await makeUser("rutger@shortclips.nl", "Rutger Hettema", "videographer");
  editorSam = await makeUser("sam@example.com", "Sam", "editor");
  const [a] = await db.insert(clients).values({ slug: "kkfh", name: "KKFH", coordinatorId: milou }).returning({ id: clients.id });
  const [b] = await db.insert(clients).values({ slug: "donker", name: "Donker Groep", coordinatorId: jiska }).returning({ id: clients.id });
  kkfh = a!.id; donker = b!.id;
});
afterAll(async () => {
  await closeDatabase();
});

describe("planning van de controlemomenten", () => {
  it("draait om 09:00 en 15:00 Amsterdam, ook rond zomer- en wintertijd", () => {
    const times = { ochtend: "09:00", middag: "15:00" };
    const winter = amsterdamClock(new Date("2026-11-09T08:00:00Z"));
    expect(winter.minutes).toBe(9 * 60);
    expect(dueSlot(winter, times, new Set())).toBe("ochtend");
    const zomer = amsterdamClock(new Date("2026-06-08T07:00:00Z"));
    expect(dueSlot(zomer, times, new Set())).toBe("ochtend");
    expect(dueSlot(amsterdamClock(new Date("2026-11-09T14:15:00Z")), times, new Set())).toBe("middag");
    expect(dueSlot(amsterdamClock(new Date("2026-11-09T07:45:00Z")), times, new Set())).toBeNull(); // 08:45
  });
  it("draait niet in het weekend, niet op feestdagen en niet twee keer", () => {
    const times = { ochtend: "09:00", middag: "15:00" };
    expect(dueSlot(amsterdamClock(new Date("2026-11-07T08:05:00Z")), times, new Set())).toBeNull(); // zaterdag
    expect(dueSlot(amsterdamClock(new Date("2026-12-25T08:05:00Z")), times, new Set(), new Set(["2026-12-25"]))).toBeNull();
    expect(dueSlot(amsterdamClock(MA_0905), times, new Set(["ochtend"]))).toBeNull();
  });
  it("gebruikt aangepaste tijden uit de instellingen", () => {
    expect(dueSlot(amsterdamClock(new Date("2026-11-09T07:35:00Z")), { ochtend: "08:30", middag: "14:00" }, new Set())).toBe("ochtend");
  });
});

describe("scenario's", () => {
  it("1. script dat nog niet af is: geen tweede taak naast de scriptingtaak, wel in het ochtendoverzicht", async () => {
    const [st] = await db.insert(tasks).values({
      title: "KKFH | Scripts aanvullen | Sessie 4", status: "todo", assigneeId: milou, clientId: kkfh,
      dueOn: "2026-11-09", dedupeKey: "scripting:00000000-0000-0000-0000-000000000001:nog_aanvullen", source: "automation", category: "scripting",
    }).returning({ id: tasks.id });
    const f = finding({
      key: "scripting:sessie:1", domain: "scripting", category: "Scripts op tijd klaar", action: "Scripts aanvullen",
      clientId: kkfh, clientLabel: "KKFH", ownerId: milou, createTask: false, linkedTaskId: st!.id, dueOn: "2026-11-09",
    });
    const r = await runOpsControl({ slot: "ochtend", now: MA_0905, collect: source([f]) });
    expect(r.ok).toBe(true);
    const it1 = await item("scripting:sessie:1");
    expect(it1!.status).toBe("open");
    expect(it1!.taskId).toBe(st!.id);
    expect(await taskOf("scripting:sessie:1")).toHaveLength(0); // geen eigen controletaak
    const morning = await notes(milou, "ops_control");
    expect(morning).toHaveLength(1);
    expect(morning[0]!.title).toBe("Goedemorgen Milou. Je hebt vandaag 1 aandachtspunt bij 1 klant.");
    expect(morning[0]!.body).toContain("KKFH: Scripts aanvullen");
  });

  it("draait hetzelfde moment niet twee keer en maakt bij een extra run geen dubbele taken", async () => {
    const again = await runOpsControl({ slot: "ochtend", now: MA_0905, collect: source([]) });
    expect(again.skipped).toMatch(/al uitgevoerd/);
    const f = finding({ key: "editing:dubbel:kkfh", domain: "editing", category: "Video wacht op controle", action: "Video intern controleren", clientId: kkfh, clientLabel: "KKFH", ownerId: milou });
    await runOpsControl({ slot: "handmatig", now: MA_0905, collect: source([f]) });
    await runOpsControl({ slot: "handmatig", now: MA_0905, collect: source([f]) });
    const open = (await taskOf("editing:dubbel:kkfh")).filter((t) => t.status !== "done");
    expect(open).toHaveLength(1);
    expect(open[0]!.title).toBe("KKFH | Video intern controleren");
    expect(open[0]!.description).toContain("Deadline: Vandaag om 16:00 uur");
    expect(open[0]!.assigneeId).toBe(milou);
    expect(open[0]!.entityType).toBe("ops_control_item");
  });

  it("2. editor mist deadline: taak bij Rutger, volgende dag escalatie naar de operationeel verantwoordelijke, niet naar Jarno", async () => {
    const f = finding({
      key: "editing:eerste-versie-verwacht:kkfh", domain: "editing", category: "Eerste versie verwacht",
      action: "Eerste versie opleveren", clientId: kkfh, clientLabel: "KKFH", ownerId: rutger, severity: "rood",
    });
    await runOpsControl({ slot: "middag", now: MA_1505, collect: source([f]) });
    const [t] = await taskOf("editing:eerste-versie-verwacht:kkfh");
    expect(t!.assigneeId).toBe(rutger);
    expect((await item("editing:eerste-versie-verwacht:kkfh"))!.escalationLevel).toBe(0);

    await runOpsControl({ slot: "ochtend", now: DI_0905, collect: source([f]) });
    const it2 = await item("editing:eerste-versie-verwacht:kkfh");
    expect(it2!.escalationLevel).toBe(1);
    expect(it2!.escalatedToId).toBe(milou);
    expect((await notes(rutger, "ops_control_escalation"))[0]!.title).toBe("Een belangrijke taak is niet tijdig afgerond en staat nu bij de operationeel verantwoordelijke.");
    expect(await notes(milou, "ops_control_escalation")).toHaveLength(1);
    expect(await notes(jarno, "ops_control_jarno")).toHaveLength(0);
    expect(await notes(editorSam)).toHaveLength(0); // editors krijgen hier niets
  });

  it("3. klant moet nog feedback geven: afvinken telt (herinnering verstuurd), daarna twee werkdagen stilte", async () => {
    const f = finding({
      key: "klantfeedback:feedback-ontbreekt:donker", domain: "klantfeedback", category: "Feedback ontbreekt",
      action: "Klant herinneren aan feedback", clientId: donker, clientLabel: "Donker Groep", ownerId: jiska,
      priority: "normaal", verifiable: false, snoozeWorkdays: 2,
    });
    await runOpsControl({ slot: "handmatig", now: DI_0905, collect: source([f]) });
    const [t] = await taskOf("klantfeedback:feedback-ontbreekt:donker");
    expect(t!.category).toBe("klantcontact");
    expect(t!.description).toContain("Dit kan de Hub niet zelf controleren");
    await db.update(tasks).set({ status: "done", completedAt: new Date() }).where(eq(tasks.id, t!.id));

    await runOpsControl({ slot: "handmatig", now: WO_0905, collect: source([f]) });
    const it3 = await item("klantfeedback:feedback-ontbreekt:donker");
    expect(it3!.status).toBe("resolved");
    expect(it3!.resolution).toBe("manual");
    expect(it3!.snoozedUntil).toBe("2026-11-13");
    await runOpsControl({ slot: "handmatig", now: DO_0905, collect: source([f]) });
    expect((await taskOf("klantfeedback:feedback-ontbreekt:donker")).filter((x) => x.status !== "done")).toHaveLength(0);

    // Na de rustperiode en nog steeds geen feedback: nieuwe taak.
    await runOpsControl({ slot: "handmatig", now: VR_0905, collect: source([f]) });
    expect((await taskOf("klantfeedback:feedback-ontbreekt:donker")).filter((x) => x.status === "todo")).toHaveLength(1);
    expect((await item("klantfeedback:feedback-ontbreekt:donker"))!.status).toBe("open");
  });

  it("4. medewerker vinkt af zonder de status bij te werken: taak komt terug met uitleg", async () => {
    const f = finding({
      key: "editing:video-wacht-op-controle:donker", domain: "editing", category: "Video wacht op controle",
      action: "Video intern controleren", clientId: donker, clientLabel: "Donker Groep", ownerId: jiska, priority: "normaal",
    });
    await runOpsControl({ slot: "handmatig", now: DI_0905, collect: source([f]) });
    const [t] = await taskOf("editing:video-wacht-op-controle:donker");
    await db.update(tasks).set({ status: "done", completedAt: new Date() }).where(eq(tasks.id, t!.id));

    await runOpsControl({ slot: "handmatig", now: DI_0905, collect: source([f]) });
    const [after] = await db.select().from(tasks).where(eq(tasks.id, t!.id));
    expect(after!.status).toBe("todo");
    expect(after!.description).toMatch(/^Heropend door de controle/);
    expect((await item("editing:video-wacht-op-controle:donker"))!.manualDoneCount).toBe(1);
    expect((await taskOf("editing:video-wacht-op-controle:donker"))).toHaveLength(1);
  });

  it("5. opname zonder voorbereiding: taak voor de videograaf met directe link", async () => {
    const f = finding({
      key: "opname:opname-voorbereiden:kkfh", domain: "opname", category: "Opname voorbereiden", action: "Opname voorbereiden",
      clientId: kkfh, clientLabel: "KKFH", ownerId: rutger, href: "/productions/abc",
    });
    await runOpsControl({ slot: "handmatig", now: DI_0905, collect: source([f]) });
    const it5 = await item("opname:opname-voorbereiden:kkfh");
    expect(it5!.href).toBe("/productions/abc");
    const [t] = await taskOf("opname:opname-voorbereiden:kkfh");
    expect(t!.assigneeId).toBe(rutger);
    expect(t!.entityId).toBe(it5!.id); // /controle/<id> stuurt door naar /productions/abc
  });

  it("6. kritieke klantklacht: direct naar Jarno, één keer", async () => {
    const f = finding({
      key: "klantcommunicatie:klant-vraagt-aandacht:kkfh", domain: "klantcommunicatie", category: "Klant vraagt aandacht",
      action: "Contact opnemen met klant", clientId: kkfh, clientLabel: "KKFH", ownerId: milou, severity: "rood",
      verifiable: false, snoozeWorkdays: 5, jarnoReason: "Klant met hoog risico: overweegt te stoppen",
    });
    await runOpsControl({ slot: "handmatig", now: DI_0905, collect: source([f]) });
    await runOpsControl({ slot: "handmatig", now: DI_0905, collect: source([f]) });
    const j = await notes(jarno, "ops_control_jarno");
    expect(j).toHaveLength(1);
    expect(j[0]!.title).toBe("Klant met hoog risico: overweegt te stoppen");
    expect(j[0]!.level).toBe("critical");
    expect((await item("klantcommunicatie:klant-vraagt-aandacht:kkfh"))!.escalationLevel).toBe(2);
  });

  it("7. probleem opgelost in de Hub: punt en taak ronden automatisch af", async () => {
    // Het punt uit scenario 5 is weg uit de bron.
    await runOpsControl({ slot: "handmatig", now: WO_0905, collect: source([]) });
    const it7 = await item("opname:opname-voorbereiden:kkfh");
    expect(it7!.status).toBe("resolved");
    expect(it7!.resolution).toBe("auto");
    const [t] = await taskOf("opname:opname-voorbereiden:kkfh");
    expect(t!.status).toBe("done");
    expect(t!.description).toContain("Automatisch afgerond door de operationele controle");
  });

  it("8. koppeling tijdelijk niet beschikbaar: niets wordt afgesloten en het onderdeel is nooit groen", async () => {
    const f = finding({ key: "editing:video-over-deadline:donker", domain: "editing", category: "Video over deadline", action: "Video afmaken", clientId: donker, clientLabel: "Donker Groep", ownerId: rutger });
    await runOpsControl({ slot: "handmatig", now: WO_0905, collect: source([f]) });
    const down: OpsDomainHealth[] = CHECKED.map((h) => (h.domain === "editing" ? { domain: "editing", check: "unavailable" } : h));
    await runOpsControl({ slot: "handmatig", now: WO_0905, collect: source([], down) });
    expect((await item("editing:video-over-deadline:donker"))!.status).toBe("open");
    expect(domainState("editing", [], { today: "2026-11-11", checkedToday: true, check: "unavailable" })).toBe("grijs");
    expect(domainState("editing", [], { today: "2026-11-11", checkedToday: true, check: "checked" })).toBe("groen");
    expect(domainState("editing", [], { today: "2026-11-11", checkedToday: false, check: "checked" })).toBe("grijs");
    expect(domainState("editing", [{ domain: "editing", severity: "oranje", dueOn: "2026-11-10", escalationLevel: 0 }], { today: "2026-11-11", checkedToday: true, check: "checked" })).toBe("rood");
  });

  it("escaleert naar de vervanger als het punt bij de operationeel verantwoordelijke zelf ligt", async () => {
    const f = finding({ key: "klantcommunicatie:video-klaar:kkfh", domain: "klantcommunicatie", category: "Video klaar maar niet verstuurd", action: "Video versturen of inplannen", clientId: kkfh, clientLabel: "KKFH", ownerId: milou });
    await runOpsControl({ slot: "handmatig", now: WO_0905, collect: source([f]) });
    await runOpsControl({ slot: "handmatig", now: DO_0905, collect: source([f]) });
    expect((await item("klantcommunicatie:video-klaar:kkfh"))!.escalatedToId).toBe(rutger);
  });

  it("middagcontrole stuurt alleen wat vandaag nog open staat", async () => {
    await db.delete(notifications);
    const vandaag = finding({ key: "editing:middag-vandaag:donker", domain: "editing", category: "Video wacht op controle", action: "Video intern controleren", clientId: donker, clientLabel: "Donker Groep", ownerId: jiska });
    await runOpsControl({ slot: "middag", now: new Date("2026-11-11T14:05:00Z"), collect: source([vandaag]) });
    const m = await notes(jiska, "ops_control");
    expect(m).toHaveLength(1);
    expect(m[0]!.title).toMatch(/^Er (staat|staan) nog \d+ werkzaamhe/);
    expect(m[0]!.body).toContain("Rond deze af of werk de status bij.");
    const d = await notes(jiska, "ops_control_deadline");
    expect(d.length).toBeGreaterThan(0);
    expect(d[0]!.title).toBe("Video intern controleren voor Donker Groep moet vandaag gebeuren.");
  });
});

describe("cron-ingang", () => {
  it("draait zelfstandig het juiste moment en slaat buiten de tijden over", async () => {
    const out = await runOpsControlScheduled(new Date("2026-11-09T10:00:00Z")); // 11:00, niets aan de beurt
    expect(out.skipped).toMatch(/Geen controlemoment/);
    const ran = await runOpsControlScheduled(new Date("2026-11-16T08:00:00Z")); // ma 09:00
    expect(ran.runId).toBeTruthy();
    const [row] = await db.select().from(opsControlRuns).where(and(eq(opsControlRuns.runDate, "2026-11-16"), eq(opsControlRuns.slot, "ochtend")));
    expect(row!.status).toBe("success");
    const twice = await runOpsControlScheduled(new Date("2026-11-16T08:15:00Z"));
    expect(twice.skipped).toMatch(/Geen controlemoment/);
  });
});

describe("bronnen", () => {
  it("leest scriptingtaken en te late taken uit de echte tabellen", async () => {
    await db.insert(tasks).values({ title: "Offerte nabellen", status: "todo", assigneeId: jiska, dueOn: "2026-01-02", priority: "high", source: "manual" });
    await db.insert(tasks).values({ title: "Taak van een editor", status: "todo", assigneeId: editorSam, dueOn: "2026-01-02", source: "manual" });
    const { findings } = await collectFindings("2026-11-09");
    const taken = findings.filter((f) => f.domain === "taken");
    expect(taken.some((f) => f.action === "Offerte nabellen" && f.ownerId === jiska && f.severity === "rood")).toBe(true);
    expect(taken.some((f) => f.action === "Taak van een editor")).toBe(false);
    expect(findings.some((f) => f.domain === "scripting" && f.clientLabel === "KKFH")).toBe(true);
  });

  it("plan: hetzelfde punt twee keer gevonden levert één beslissing op", () => {
    const f = finding({ key: "x", domain: "editing", category: "c", action: "a" });
    expect(planItems([f, f], [], { today: "2026-11-09", jarnoAfterWorkdays: 3 })).toHaveLength(1);
  });
});
