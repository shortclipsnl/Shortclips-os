import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { nlHolidaySet } from "@/lib/holidays";
import { controleFase, defaultControleDag, nthWorkday, parseBatchKey, batchKey } from "@/lib/maandcontrole";

/**
 * Maandcontrole van de maandrapportages:
 *  - standaard controledag (2e werkdag, feestdagen meegerekend);
 *  - fase per rapportage (de zes stappen);
 *  - één taak en één melding per controleur per maand, nooit dubbel;
 *  - hooguit één herinnering als er geen controledag is;
 *  - taak sluit zodra alles gecontroleerd is, goedkeurder krijgt één melding;
 *  - oude losse controletaken per klant worden gesloten.
 */

describe("controledag", () => {
  const h = nlHolidaySet([2026, 2027]);
  it("is de tweede werkdag van de maand na de rapportperiode", () => {
    expect(nthWorkday("2026-11", 1, h)).toBe("2026-11-02");
    expect(defaultControleDag("2026-10", "2026-11-01", h)).toBe("2026-11-03");
  });
  it("slaat weekenden en feestdagen over", () => {
    // 1 jan 2027 is een vrijdag en Nieuwjaarsdag: 1e werkdag is ma 4 jan, 2e di 5 jan.
    expect(nthWorkday("2027-01", 1, h)).toBe("2027-01-04");
    expect(defaultControleDag("2026-12", "2026-12-31", h)).toBe("2027-01-05");
  });
  it("ligt nooit in het verleden", () => {
    expect(defaultControleDag("2026-10", "2026-11-08", h)).toBe("2026-11-09");
    expect(defaultControleDag("2026-10", "2026-11-10", h)).toBe("2026-11-10");
  });
  it("sleutel heen en terug", () => {
    expect(parseBatchKey(batchKey("2026-10", "abc"))).toEqual({ period: "2026-10", userId: "abc" });
    expect(parseBatchKey("report_review:x")).toBeNull();
  });
});

describe("fase per rapportage", () => {
  const base = { beoordeeld: false, gestart: false, openChecks: 1, batch: { exists: true, planned: true } };
  it("volgt de zes stappen", () => {
    expect(controleFase({ ...base, status: "klaar_voor_controle", batch: { exists: false, planned: false } })).toBe("gegenereerd");
    expect(controleFase({ ...base, status: "klaar_voor_controle", batch: { exists: true, planned: false } })).toBe("wacht_op_controle");
    expect(controleFase({ ...base, status: "klaar_voor_controle" })).toBe("ingepland");
    expect(controleFase({ ...base, status: "klaar_voor_controle", gestart: true })).toBe("in_controle");
    expect(controleFase({ ...base, status: "aanpassing_nodig" })).toBe("in_controle");
    expect(controleFase({ ...base, status: "klaar_voor_controle", beoordeeld: true, gestart: true, openChecks: 0 })).toBe("klaar_voor_goedkeuring");
    expect(controleFase({ ...base, status: "goedgekeurd" })).toBe("goedgekeurd");
    expect(controleFase({ ...base, status: "gepubliceerd" })).toBe("beschikbaar");
  });
  it("geen fase tijdens genereren of bij een mislukte generatie", () => {
    expect(controleFase({ ...base, status: "analyse_bezig" })).toBeNull();
    expect(controleFase({ ...base, status: "mislukt" })).toBeNull();
  });
});

type Db = Awaited<ReturnType<typeof freshDatabase>>;
type Schema = typeof import("@/db/schema");
let db: Db;
let s: Schema;
const ids: Record<string, string> = {};

const ANALYSE = { verbeterpunten: [{ titel: "Sneller to the point" }], strategischeActies: [{ titel: "x" }] };
const VOLLEDIG = { positief: "a", verbeteren: "b", volgendeMaand: "c", klanttekst: "d" };

beforeAll(async () => {
  db = await freshDatabase();
  s = await import("@/db/schema");
  const [perm] = await db.insert(s.permissions).values({ key: "reports:read", resource: "reports", action: "read" }).returning({ id: s.permissions.id });
  const roles = await db.insert(s.roles).values([{ key: "owner", name: "Eigenaar" }, { key: "operational_manager", name: "OM" }, { key: "project_coordinator", name: "PC" }])
    .returning({ id: s.roles.id, key: s.roles.key });
  for (const r of roles) await db.insert(s.rolePermissions).values({ roleId: r.id, permissionId: perm!.id });
  const users = await db.insert(s.users).values([
    { email: "jarno@test.nl", fullName: "Jarno", primaryRole: "owner", status: "active" },
    { email: "milou@test.nl", fullName: "Milou", primaryRole: "operational_manager", status: "active" },
    { email: "jiska@test.nl", fullName: "Jiska", primaryRole: "project_coordinator", status: "active" },
  ]).returning({ id: s.users.id, email: s.users.email });
  for (const u of users) ids[u.email.split("@")[0]!] = u.id;
  const r = Object.fromEntries(roles.map((x) => [x.key, x.id]));
  await db.insert(s.userRoles).values([
    { userId: ids.jarno!, roleId: r.owner! },
    { userId: ids.milou!, roleId: r.operational_manager! },
    { userId: ids.jiska!, roleId: r.project_coordinator! },
  ]);
  const clients = await db.insert(s.clients).values([
    { slug: "a", name: "Alfa", status: "active", coordinatorId: ids.jiska },
    { slug: "b", name: "Bravo", status: "active", coordinatorId: ids.jiska },
    { slug: "c", name: "Charlie", status: "active" }, // geen PM: naar de operationeel manager
    { slug: "d", name: "Delta", status: "active", coordinatorId: ids.jarno },
  ]).returning({ id: s.clients.id, slug: s.clients.slug });
  for (const c of clients) ids[c.slug] = c.id;
  for (const slug of ["a", "b", "c", "d"]) {
    const [rep] = await db.insert(s.clientReports).values({
      clientId: ids[slug]!, periodType: "month", period: "2026-10", title: "Maandrapport oktober 2026",
      status: slug === "b" ? "analyse_bezig" : "klaar_voor_controle", startedAt: slug === "b" ? new Date() : null,
      analysis: ANALYSE, metrics: { views: 100, posts: 3 },
    }).returning({ id: s.clientReports.id });
    ids[`r_${slug}`] = rep!.id;
  }
  // Oude losse controletaak per klant (van vóór de maandtaak).
  await db.insert(s.tasks).values({ title: "Maandrapport controleren - Alfa", assigneeId: ids.jiska, source: "automation", entityType: "client_report", entityId: ids.r_a, dedupeKey: `report_review:${ids.r_a}` });
}, 180000);

afterAll(async () => { await closeDatabase(); });

async function batchTasks() {
  return db.select().from(s.tasks).where(like(s.tasks.dedupeKey, "report_batch:%"));
}
async function notes(type: string, userId?: string) {
  return db.select().from(s.notifications).where(and(eq(s.notifications.type, type), userId ? eq(s.notifications.userId, userId) : undefined));
}

describe("maandtaak en meldingen", () => {
  it("maakt één taak per controleur, met controledag op de 2e werkdag", async () => {
    const { syncReportBatches } = await import("@/server/reports/batch");
    await syncReportBatches(new Date("2026-11-02T08:00:00Z"));
    const t = await batchTasks();
    const byUser = Object.fromEntries(t.map((x) => [x.assigneeId!, x]));
    expect(t).toHaveLength(3); // Jiska (Alfa), Milou (Charlie, fallback), Jarno (Delta)
    expect(String(byUser[ids.jiska!]!.dueOn).slice(0, 10)).toBe("2026-11-03");
    expect(byUser[ids.jiska!]!.title).toBe("Maandrapportages controleren en afronden (oktober 2026)");
    expect(byUser[ids.jiska!]!.description).toContain("1 worden nog gegenereerd");
    // Oude losse taak is gesloten: geen dubbele taken.
    const [legacy] = await db.select().from(s.tasks).where(eq(s.tasks.dedupeKey, `report_review:${ids.r_a}`));
    expect(legacy!.status).toBe("cancelled");
  });

  it("meldt 'staan klaar' pas als alles voor die persoon gegenereerd is, en maar één keer", async () => {
    const { syncReportBatches } = await import("@/server/reports/batch");
    expect(await notes("report_batch_ready", ids.jiska)).toHaveLength(0); // Bravo nog bezig
    expect(await notes("report_batch_ready", ids.milou)).toHaveLength(1);
    await db.update(s.clientReports).set({ status: "klaar_voor_controle", startedAt: null }).where(eq(s.clientReports.id, ids.r_b!));
    await syncReportBatches(new Date("2026-11-02T09:00:00Z"));
    await syncReportBatches(new Date("2026-11-02T10:00:00Z"));
    const ready = await notes("report_batch_ready", ids.jiska);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.title).toContain("2 klanten, 2 te controleren");
    expect(ready[0]!.body).toContain("Alfa, Bravo");
    expect(await batchTasks()).toHaveLength(3);
  });

  it("herinnert één keer als de controledag is leeggemaakt", async () => {
    const { syncReportBatches } = await import("@/server/reports/batch");
    const [t] = (await batchTasks()).filter((x) => x.assigneeId === ids.milou);
    await db.update(s.tasks).set({ dueOn: null, createdAt: new Date("2026-11-02T08:00:00Z") }).where(eq(s.tasks.id, t!.id));
    await syncReportBatches(new Date("2026-11-02T15:00:00Z"));
    expect(await notes("report_batch_unplanned", ids.milou)).toHaveLength(0); // nog dezelfde werkdag
    await syncReportBatches(new Date("2026-11-04T08:00:00Z"));
    await syncReportBatches(new Date("2026-11-05T08:00:00Z"));
    expect(await notes("report_batch_unplanned", ids.milou)).toHaveLength(1);
    expect(await notes("report_batch_unplanned", ids.jiska)).toHaveLength(0);
  });

  it("sluit de taak als alles gecontroleerd is en meldt de goedkeurder één keer", async () => {
    const { syncReportBatches } = await import("@/server/reports/batch");
    await db.update(s.clientReports).set({ beoordeling: VOLLEDIG }).where(eq(s.clientReports.id, ids.r_a!));
    await syncReportBatches(new Date("2026-11-03T12:00:00Z"));
    let [t] = (await batchTasks()).filter((x) => x.assigneeId === ids.jiska);
    expect(t!.status).not.toBe("done");
    expect(t!.description).toContain("1 van 2 gecontroleerd");
    expect(await notes("report_batch_approve")).toHaveLength(0);

    await db.update(s.clientReports).set({ beoordeling: VOLLEDIG }).where(eq(s.clientReports.id, ids.r_b!));
    await syncReportBatches(new Date("2026-11-03T13:00:00Z"));
    await syncReportBatches(new Date("2026-11-03T14:00:00Z"));
    [t] = (await batchTasks()).filter((x) => x.assigneeId === ids.jiska);
    expect(t!.status).toBe("done");
    const approve = await notes("report_batch_approve", ids.jarno);
    expect(approve).toHaveLength(1);
    expect(approve[0]!.body).toContain("Jiska");
  });

  it("zet de taak weer open als er een aanpassing wordt gevraagd", async () => {
    const { syncReportBatches } = await import("@/server/reports/batch");
    await db.update(s.clientReports).set({ status: "aanpassing_nodig" }).where(eq(s.clientReports.id, ids.r_a!));
    await syncReportBatches(new Date("2026-11-04T09:00:00Z"));
    const [t] = (await batchTasks()).filter((x) => x.assigneeId === ids.jiska);
    expect(t!.status).toBe("todo");
    expect(await batchTasks()).toHaveLength(3);
  });

  it("publiceert nooit automatisch naar de klant", async () => {
    const rows = await db.select({ status: s.clientReports.status, isPublished: s.clientReports.isPublished }).from(s.clientReports);
    expect(rows.every((r) => r.status !== "gepubliceerd" && !r.isPublished)).toBe(true);
  });
});
