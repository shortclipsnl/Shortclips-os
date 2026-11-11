import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { nlHolidaySet } from "@/lib/holidays";
import {
  actueleRapportMaand, cijfersDefinitief, controleFase, defaultControleDag, defaultGoedkeurDag, laatsteWerkdag,
  parseStapKey, stapKey, stapTitel,
} from "@/lib/maandcontrole";

/**
 * Maandcontrole van de maandrapportages:
 *  - controledag op de laatste werkdag van de rapportmaand;
 *  - cijfers pas definitief na de laatste dag van de maand;
 *  - per klant een eigen taak per processtap (controleren, goedkeuren, versturen);
 *  - taken sluiten en heropenen vanzelf met de status, nooit dubbel;
 *  - oude verzameltaken en losse controletaken worden gesloten.
 */

describe("controledag", () => {
  const h = nlHolidaySet([2026, 2027]);
  it("is de laatste werkdag van de maand", () => {
    // November 2026 eindigt op maandag 30 november.
    expect(laatsteWerkdag("2026-11", h)).toBe("2026-11-30");
    expect(defaultControleDag("2026-11", "2026-11-11", h)).toBe("2026-11-30");
  });
  it("schuift van zaterdag of zondag terug naar vrijdag", () => {
    expect(laatsteWerkdag("2026-10", h)).toBe("2026-10-30"); // za 31 okt → vr 30 okt
    expect(laatsteWerkdag("2027-01", h)).toBe("2027-01-29"); // zo 31 jan → vr 29 jan
    expect(laatsteWerkdag("2026-12", h)).toBe("2026-12-31"); // do 31 dec
  });
  it("ligt nooit in het verleden", () => {
    expect(defaultControleDag("2026-10", "2026-11-08", h)).toBe("2026-11-09");
    expect(defaultControleDag("2026-10", "2026-11-10", h)).toBe("2026-11-10");
  });
  it("goedkeuren vanaf de eerste werkdag na de maand", () => {
    expect(defaultGoedkeurDag("2026-11", "2026-11-30", h)).toBe("2026-12-01");
    expect(defaultGoedkeurDag("2026-12", "2026-12-31", h)).toBe("2027-01-04");
  });
  it("actuele maand wisselt op de laatste werkdag", () => {
    expect(actueleRapportMaand("2026-11-11", h)).toBe("2026-10");
    expect(actueleRapportMaand("2026-11-30", h)).toBe("2026-11");
    expect(actueleRapportMaand("2026-12-01", h)).toBe("2026-11");
  });
  it("cijfers zijn pas definitief na de laatste dag van de maand", () => {
    expect(cijfersDefinitief("2026-11", new Date("2026-11-30T15:00:00Z"))).toBe(false);
    expect(cijfersDefinitief("2026-11", new Date("2026-11-30T23:30:00Z"))).toBe(true); // 00:30 op 1 dec in Amsterdam
    expect(cijfersDefinitief("2026-11", null)).toBe(false);
  });
  it("sleutel en titel", () => {
    expect(parseStapKey(stapKey("c1", "2026-11", "goedkeuren"))).toEqual({ clientId: "c1", period: "2026-11", stap: "goedkeuren" });
    expect(parseStapKey("report_batch:2026-10:x")).toBeNull();
    expect(stapTitel("2026-11", "controleren", false)).toBe("Maandrapportage november • Interne en klantversie voorbereiden en controleren");
  });
});

describe("fase per rapportage", () => {
  const base = { beoordeeld: false, gestart: false, openChecks: 1, batch: { exists: true, planned: true } };
  it("volgt de zes stappen", () => {
    expect(controleFase({ ...base, status: "klaar_voor_controle", batch: { exists: false, planned: false } })).toBe("gegenereerd");
    expect(controleFase({ ...base, status: "klaar_voor_controle", batch: { exists: true, planned: false } })).toBe("wacht_op_controle");
    expect(controleFase({ ...base, status: "klaar_voor_controle" })).toBe("ingepland");
    expect(controleFase({ ...base, status: "klaar_voor_controle", gestart: true })).toBe("in_controle");
    expect(controleFase({ ...base, status: "klaar_voor_controle", beoordeeld: true, gestart: true, openChecks: 0 })).toBe("klaar_voor_goedkeuring");
    expect(controleFase({ ...base, status: "goedgekeurd" })).toBe("goedgekeurd");
    expect(controleFase({ ...base, status: "gepubliceerd" })).toBe("beschikbaar");
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
      analysis: ANALYSE, metrics: { views: 100, posts: 3 }, generatedAt: slug === "b" ? null : new Date("2026-11-01T09:00:00Z"),
    }).returning({ id: s.clientReports.id });
    ids[`r_${slug}`] = rep!.id;
  }
  // Oude losse controletaak per klant en oude verzameltaak per medewerker.
  await db.insert(s.tasks).values({ title: "Maandrapport controleren - Alfa", assigneeId: ids.jiska, source: "automation", entityType: "client_report", entityId: ids.r_a, dedupeKey: `report_review:${ids.r_a}` });
  await db.insert(s.tasks).values({ title: "Maandrapportages controleren en afronden (oktober 2026)", assigneeId: ids.jiska, source: "automation", entityType: "report_batch", dedupeKey: `report_batch:2026-10:${ids.jiska}` });
}, 180000);

afterAll(async () => { await closeDatabase(); });

async function stapTaken(clientSlug?: string) {
  const rows = await db.select().from(s.tasks).where(like(s.tasks.dedupeKey, "maandrapport:%"));
  return clientSlug ? rows.filter((t) => t.clientId === ids[clientSlug]) : rows;
}
const open = (t: { status: string }) => ["todo", "in_progress", "blocked"].includes(String(t.status));
async function notes(type: string, userId?: string) {
  return db.select().from(s.notifications).where(and(eq(s.notifications.type, type), userId ? eq(s.notifications.userId, userId) : undefined));
}

describe("taken per klant en processtap", () => {
  it("maakt per klant een eigen controletaak bij de juiste medewerker", async () => {
    const { syncReportBatches } = await import("@/server/reports/batch");
    await syncReportBatches(new Date("2026-11-02T08:00:00Z"));
    const t = await stapTaken();
    // Alfa (Jiska), Charlie (Milou, fallback), Delta (Jarno); Bravo wordt nog gegenereerd.
    expect(t).toHaveLength(3);
    const alfa = (await stapTaken("a"))[0]!;
    expect(alfa.assigneeId).toBe(ids.jiska);
    expect(alfa.title).toBe("Maandrapportage oktober • Interne en klantversie voorbereiden en controleren");
    expect(alfa.entityId).toBe(ids.r_a);
    expect(alfa.description).toContain("Wacht op controle");
    const delta = (await stapTaken("d"))[0]!;
    expect(delta.assigneeId).toBe(ids.jarno);
    expect(delta.title).toContain("controleren en goedkeuren");
    // Oude verzameltaak en losse taak zijn gesloten: geen dubbele taken.
    const legacy = await db.select().from(s.tasks).where(like(s.tasks.dedupeKey, "report_%"));
    expect(legacy.every((x) => x.status === "cancelled")).toBe(true);
  });

  it("maakt nooit dubbele taken en één melding per medewerker", async () => {
    const { syncReportBatches } = await import("@/server/reports/batch");
    await db.update(s.clientReports).set({ status: "klaar_voor_controle", startedAt: null, generatedAt: new Date("2026-11-02T09:00:00Z") }).where(eq(s.clientReports.id, ids.r_b!));
    await syncReportBatches(new Date("2026-11-02T09:00:00Z"));
    await syncReportBatches(new Date("2026-11-02T10:00:00Z"));
    expect(await stapTaken()).toHaveLength(4);
    expect((await stapTaken("b"))).toHaveLength(1);
    expect(await notes("report_batch_ready", ids.jiska)).toHaveLength(1);
  });

  it("na controle door de PM: PM-taak af, Jarno krijgt een eigen goedkeurtaak; andere klanten blijven open", async () => {
    const { syncReportBatches } = await import("@/server/reports/batch");
    await db.update(s.clientReports).set({ beoordeling: VOLLEDIG }).where(eq(s.clientReports.id, ids.r_a!));
    await syncReportBatches(new Date("2026-11-03T12:00:00Z"));
    const alfa = await stapTaken("a");
    expect(alfa.find((t) => t.dedupeKey!.endsWith(":controleren"))!.status).toBe("done");
    const goed = alfa.find((t) => t.dedupeKey!.endsWith(":goedkeuren"))!;
    expect(goed.assigneeId).toBe(ids.jarno);
    expect(open(goed)).toBe(true);
    expect(goed.description).toBe("Wacht op goedkeuring");
    expect(open((await stapTaken("b"))[0]!)).toBe(true);
  });

  it("voorlopige cijfers: goedkeurtaak wacht op de definitieve cijfers", async () => {
    const { syncReportBatches } = await import("@/server/reports/batch");
    await db.update(s.clientReports).set({ beoordeling: VOLLEDIG, generatedAt: new Date("2026-10-30T09:00:00Z") }).where(eq(s.clientReports.id, ids.r_b!));
    // generatedAt in oktober voor periode oktober = voorlopig
    await syncReportBatches(new Date("2026-11-03T13:00:00Z"));
    const goed = (await stapTaken("b")).find((t) => t.dedupeKey!.endsWith(":goedkeuren"))!;
    expect(goed.description).toBe("Wacht op definitieve cijfers");
  });

  it("aanpassing gevraagd: controletaak weer open, goedkeurtaak vervalt", async () => {
    const { syncReportBatches } = await import("@/server/reports/batch");
    await db.update(s.clientReports).set({ status: "aanpassing_nodig", beoordeling: {} }).where(eq(s.clientReports.id, ids.r_a!));
    await syncReportBatches(new Date("2026-11-04T09:00:00Z"));
    const alfa = await stapTaken("a");
    expect(alfa).toHaveLength(2);
    expect(open(alfa.find((t) => t.dedupeKey!.endsWith(":controleren"))!)).toBe(true);
    expect(alfa.find((t) => t.dedupeKey!.endsWith(":goedkeuren"))!.status).toBe("cancelled");
  });

  it("goedgekeurd: Jarno-taak af, PM krijgt verstuurtaak; na versturen alles af", async () => {
    const { syncReportBatches } = await import("@/server/reports/batch");
    await db.update(s.clientReports).set({ status: "goedgekeurd", beoordeling: VOLLEDIG }).where(eq(s.clientReports.id, ids.r_a!));
    await syncReportBatches(new Date("2026-11-05T09:00:00Z"));
    let alfa = await stapTaken("a");
    expect(alfa.find((t) => t.dedupeKey!.endsWith(":goedkeuren"))!.status).toBe("done");
    const versturen = alfa.find((t) => t.dedupeKey!.endsWith(":versturen"))!;
    expect(versturen.assigneeId).toBe(ids.jiska);
    expect(open(versturen)).toBe(true);
    await db.update(s.clientReports).set({ status: "gepubliceerd" }).where(eq(s.clientReports.id, ids.r_a!));
    await syncReportBatches(new Date("2026-11-05T10:00:00Z"));
    alfa = await stapTaken("a");
    expect(alfa.every((t) => !open(t))).toBe(true);
    expect(alfa).toHaveLength(3);
  });

  it("publiceert nooit automatisch naar de klant", async () => {
    const rows = await db.select({ id: s.clientReports.id, isPublished: s.clientReports.isPublished }).from(s.clientReports);
    expect(rows.filter((r) => r.isPublished)).toHaveLength(0);
  });
});
