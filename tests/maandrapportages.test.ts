import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * AI Maandrapportages, end-to-end tegen een echte (PGlite) database:
 *  - klantstatus actief/inactief en behoud van historie;
 *  - historische vergelijkingen (in code, nooit verzonnen);
 *  - detectie van identieke cijfers (verkeerde Metricool-koppeling);
 *  - generatie via de wachtrij, vastgelopen analyses, feedback en versies;
 *  - geen dubbele rapporten;
 *  - leesopdrachten, teammeldingen, herinneringen en doornemen;
 *  - teamleden zien alleen goedgekeurde rapporten;
 *  - de klant-PDF bevat geen interne analyse.
 * De AI is hier vervangen door een vaste, geldige respons.
 */

let aiCalls: string[] = [];
vi.mock("@/server/ai/client", () => ({
  aiConfigured: () => true,
  runPrompt: async () => ({ ok: true, text: "Klanttekst", model: "test" }),
  runJsonPrompt: async (input: { user: string }) => {
    aiCalls.push(input.user);
    return {
      ok: true,
      model: "test",
      data: {
        topVideos: [{ titel: "Video A", waarom: "Veel weergaven", cijfers: "900 weergaven", zekerheid: "bewezen" }],
        analysis: { watWerkt: [{ punt: "Korte hooks", zekerheid: "waarschijnlijk" }], watMinder: [], ontwikkelingen: ["Groei"] },
        maandvergelijking: ["Meer weergaven dan vorige maand"],
        conclusies: ["Goede maand"],
        kansen: [{ titel: "Meer rondleidingen", toelichting: "Presteert bovengemiddeld" }],
        verbeterpunten: [{ titel: "Sneller to the point", waarom: "x", wat: "y", hoeMeten: "z", zekerheid: "hypothese" }],
        aandachtspunten: [{ type: "positief", tekst: "Groei" }],
        strategischeActies: [{ titel: "Twee rondleidingen per week", waarom: "Beste format" }],
        intern: {
          kern: "Rondleidingen werken",
          besteVideos: [{ titel: "Video A", gemeten: "900 weergaven", verklaring: "Sterke opening", zekerheid: "hypothese" }],
          hooks: [], onderwerpen: [], tegenvallers: [], videostructuur: [], formatsVaker: [], vermijdenOfAanpassen: [],
          scripts: ["Kortere intro"], opnames: [], montage: [],
          acties: [{ actie: "Script met vraag-hook", rol: "script", waarom: "Test" }],
          dataBeperkingen: ["Geen retentiedata"],
        },
      },
    };
  },
}));

type Db = Awaited<ReturnType<typeof freshDatabase>>;
type Schema = typeof import("@/db/schema");
let db: Db;
let s: Schema;

const ids: Record<string, string> = {};

async function seedRoles() {
  const perms = await db.insert(s.permissions).values([
    { key: "reports:read", resource: "reports", action: "read" },
    { key: "reports:write", resource: "reports", action: "write" },
    { key: "reports:team_read", resource: "reports", action: "team_read" },
  ]).returning({ id: s.permissions.id, key: s.permissions.key });
  const p = Object.fromEntries(perms.map((x) => [x.key, x.id]));
  const roles = await db.insert(s.roles).values([
    { key: "owner", name: "Eigenaar" },
    { key: "operational_manager", name: "OM" },
    { key: "content_creator", name: "CC" },
  ]).returning({ id: s.roles.id, key: s.roles.key });
  const r = Object.fromEntries(roles.map((x) => [x.key, x.id]));
  await db.insert(s.rolePermissions).values([
    { roleId: r.owner!, permissionId: p["reports:read"]! },
    { roleId: r.owner!, permissionId: p["reports:write"]! },
    { roleId: r.owner!, permissionId: p["reports:team_read"]! },
    { roleId: r.operational_manager!, permissionId: p["reports:read"]! },
    { roleId: r.operational_manager!, permissionId: p["reports:write"]! },
    { roleId: r.content_creator!, permissionId: p["reports:team_read"]! },
  ]);
  const users = await db.insert(s.users).values([
    { email: "jarno@test.nl", fullName: "Jarno", primaryRole: "owner", status: "active" },
    { email: "milou@test.nl", fullName: "Milou", primaryRole: "operational_manager", status: "active" },
    { email: "jiska@test.nl", fullName: "Jiska", primaryRole: "content_creator", status: "active" },
    { email: "editor@test.nl", fullName: "Editor", primaryRole: "editor", status: "active" },
  ]).returning({ id: s.users.id, email: s.users.email });
  for (const u of users) ids[u.email.split("@")[0]!] = u.id;
  await db.insert(s.userRoles).values([
    { userId: ids.jarno!, roleId: r.owner! },
    { userId: ids.milou!, roleId: r.operational_manager! },
    { userId: ids.jiska!, roleId: r.content_creator! },
  ]);
}

function viewer(key: "jarno" | "milou" | "jiska", perms: string[]) {
  return {
    id: ids[key]!, email: `${key}@test.nl`, fullName: key, primaryRole: key === "jarno" ? "owner" : key === "milou" ? "operational_manager" : "content_creator",
    clientId: null, avatarUrl: null, status: "active",
    permissions: new Set(perms), clientScope: null, isPortalUser: false, isEditorOnly: false,
  } as unknown as import("@/server/auth/context").Viewer;
}

async function seedMonth(clientId: string, period: string, viewsPerDay: number, opts: { days?: number } = {}) {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const days = opts.days ?? last;
  const rows = Array.from({ length: days }, (_, i) => ({
    clientId, platform: "instagram" as const, measuredOn: `${period}-${String(i + 1).padStart(2, "0")}`,
    views: viewsPerDay, reach: Math.round(viewsPerDay * 0.7), engagements: 10, followerDelta: 1, likes: 6, comments: 2, shares: 1, saves: 1, source: "metricool",
  }));
  await db.insert(s.dailyMetrics).values(rows);
}

beforeAll(async () => {
  db = await freshDatabase();
  s = await import("@/db/schema");
  await seedRoles();
  const clients = await db.insert(s.clients).values([
    { slug: "actief", name: "Actief BV", status: "active", coordinatorId: ids.milou },
    { slug: "gepauzeerd", name: "Gepauzeerd BV", status: "paused", coordinatorId: ids.milou },
    { slug: "kopie", name: "Kopie BV", status: "paused" },
  ]).returning({ id: s.clients.id, slug: s.clients.slug });
  for (const c of clients) ids[c.slug] = c.id;

  // Actief BV: zes maanden historie + oktober, plus publicaties met cijfers.
  for (const [p, v] of [["2026-04", 100], ["2026-05", 100], ["2026-06", 100], ["2026-07", 200], ["2026-08", 200], ["2026-09", 200], ["2026-10", 300]] as const) {
    await seedMonth(ids.actief!, p, v);
  }
  for (let i = 0; i < 5; i++) {
    const [pub] = await db.insert(s.publications).values({ clientId: ids.actief!, platform: "instagram", status: "published", publishedAt: new Date(`2026-10-${10 + i}T12:00:00Z`), caption: `Video ${i}` }).returning({ id: s.publications.id });
    await db.insert(s.socialMetrics).values({ publicationId: pub!.id, clientId: ids.actief!, platform: "instagram", measuredOn: "2026-11-01", views: 1000 - i * 100, likes: 10, comments: 2, shares: 1, saves: 1 });
  }
  // Gepauzeerd BV: alleen oktober. Kopie BV: exact dezelfde cijfers als Gepauzeerd BV.
  await seedMonth(ids.gepauzeerd!, "2026-10", 50);
  await seedMonth(ids.kopie!, "2026-10", 50);
  // Metricool-koppeling: alleen Gepauzeerd BV actief gekoppeld.
  await db.insert(s.clientIntegrations).values([
    { clientId: ids.gepauzeerd!, provider: "metricool", externalId: "1", isActive: true },
    { clientId: ids.kopie!, provider: "metricool", externalId: "2", isActive: false },
  ]);
}, 180000);

afterAll(async () => { await closeDatabase(); });

describe("historie en vergelijkingen", () => {
  it("berekent vorige maand, 3 en 6 maanden in code en telt video's uit publicaties", async () => {
    const { monthSeries, buildVergelijking } = await import("@/server/reports/metrics");
    const series = await monthSeries(ids.actief!, "2026-10", 6);
    expect(series.map((x) => x.maand)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(series.at(-1)!.videos).toBe(5);
    const v = buildVergelijking(series);
    // okt 300/dag*31 vs sep 200/dag*30
    expect(v.vsVorigeMaand.views).toBeCloseTo(((9300 - 6000) / 6000) * 100, 0);
    expect(v.vsGem3.views).not.toBeNull();
    expect(v.vsGem6.views).not.toBeNull();
    expect(v.maandenHistorie).toBe(6);
  });

  it("geeft null (niet geschat) als er te weinig historie is", async () => {
    const { monthSeries, buildVergelijking } = await import("@/server/reports/metrics");
    const v = buildVergelijking(await monthSeries(ids.gepauzeerd!, "2026-10", 6));
    expect(v.vsVorigeMaand.views).toBeNull();
    expect(v.vsGem3.views).toBeNull();
    expect(v.vsGem6.views).toBeNull();
    expect(v.maandenHistorie).toBe(0);
  });
});

describe("identieke cijfers (verkeerde koppeling)", () => {
  it("blokkeert de klant zonder actieve koppeling en waarschuwt bij de echte", async () => {
    const { findDuplicateMetricClients, duplicateIssue } = await import("@/server/reports/metrics");
    const kopie = duplicateIssue(await findDuplicateMetricClients(ids.kopie!, "2026-10"));
    expect(kopie?.severity).toBe("blok");
    expect(kopie?.label).toContain("Gepauzeerd BV");
    const echt = duplicateIssue(await findDuplicateMetricClients(ids.gepauzeerd!, "2026-10"));
    expect(echt?.severity).toBe("let_op");
    expect(duplicateIssue(await findDuplicateMetricClients(ids.actief!, "2026-10"))).toBeNull();
  });
});

describe("generatie, wachtrij, feedback en versies", () => {
  it("verwerkt de wachtrij en vastgelopen analyses, zonder dubbele rapporten", async () => {
    // In de wachtrij (Actief BV) en vastgelopen (Gepauzeerd BV, al 2 uur 'bezig').
    await db.insert(s.clientReports).values([
      { clientId: ids.actief!, period: "2026-10", title: "Maandrapport oktober 2026", status: "gegevens_verzamelen" },
      { clientId: ids.gepauzeerd!, period: "2026-10", title: "Maandrapport oktober 2026", status: "analyse_bezig", startedAt: new Date(Date.now() - 2 * 3600 * 1000) },
    ]);
    const { runReportQueue } = await import("@/server/jobs/report-monthly");
    const res = await runReportQueue();
    expect(res.processed).toBe(2);
    expect(res.ok).toBe(2);
    const rows = await db.select().from(s.clientReports);
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.status).toBe("klaar_voor_controle");
    const actief = rows.find((r) => r.clientId === ids.actief)!;
    const m = actief.metrics as { posts: number; videoBron: string; historie: unknown[]; vergelijking: unknown };
    expect(m.posts).toBe(5);
    expect(m.videoBron).toBe("publicaties");
    expect(m.historie.length).toBe(7);
    expect(m.vergelijking).toBeTruthy();
    expect((actief.analysis as { intern?: { acties: unknown[] } }).intern?.acties.length).toBe(1);

    // Nogmaals draaien: niets meer te doen, geen duplicaten.
    const again = await runReportQueue();
    expect(again.processed).toBe(0);
    expect((await db.select().from(s.clientReports)).length).toBe(2);
    ids.reportActief = actief.id;
  });

  it("stopt na herhaaldelijk vastlopen en meldt eerlijk 'mislukt'", async () => {
    const { eq } = await import("drizzle-orm");
    const [r] = await db.insert(s.clientReports).values({ clientId: ids.kopie!, period: "2026-09", title: "x", status: "analyse_bezig", startedAt: new Date(Date.now() - 3600 * 1000), kwaliteit: { vastgelopen: 2 } }).returning({ id: s.clientReports.id });
    const { runReportQueue } = await import("@/server/jobs/report-monthly");
    await runReportQueue();
    const [after] = await db.select().from(s.clientReports).where(eq(s.clientReports.id, r!.id));
    expect(after!.status).toBe("mislukt");
    expect(after!.errorMessage).toContain("vast");
    await db.delete(s.clientReports).where(eq(s.clientReports.id, r!.id));
  });

  it("neemt feedback mee in de volgende generatie en bewaart versies", async () => {
    const { ensureMonthlyReport } = await import("@/server/reports/run");
    await db.insert(s.monthlyReportFeedback).values({ reportId: ids.reportActief!, authorId: ids.jarno, body: "Meer nadruk op rondleidingen", versionNumber: 1 });
    aiCalls = [];
    const res = await ensureMonthlyReport(ids.actief!, "2026-10", { force: true, triggeredById: ids.jarno! });
    expect(res.ok).toBe(true);
    expect(aiCalls[0]).toContain("Meer nadruk op rondleidingen");
    const fb = await db.select().from(s.monthlyReportFeedback);
    expect(fb[0]!.resolvedInVersion).toBe(2);
    const versions = await db.select().from(s.monthlyReportVersions);
    expect(versions.filter((v) => v.reportId === ids.reportActief).map((v) => v.versionNumber).sort()).toEqual([1, 2]);
    expect(versions.every((v) => v.kind === "generatie")).toBe(true);
  });

  it("blokkeert goedkeuren zolang de beoordeling ontbreekt of de cijfers een kopie zijn", async () => {
    const { checkReportQuality, canApprove } = await import("@/server/reports/quality");
    const base = { clientName: "x", analysis: { verbeterpunten: [{ titel: "a" }] } as never, metrics: { views: 1, posts: 1 }, ontbrekendeGegevens: [] };
    expect(canApprove(checkReportQuality({ ...base, beoordeling: {} }))).toBe(false);
    const full = { positief: "a", verbeteren: "b", volgendeMaand: "c" };
    expect(canApprove(checkReportQuality({ ...base, beoordeling: full }))).toBe(true);
    expect(canApprove(checkReportQuality({ ...base, beoordeling: full, dubbel: { severity: "blok", label: "kopie" } }))).toBe(false);
  });
});

describe("klantstatus, rechten en teamworkflow", () => {
  it("toont actief/inactief vanuit klantbeheer en houdt rapporten bij inactief worden", async () => {
    const { listMonthlyReports } = await import("@/server/reports/service");
    let o = await listMonthlyReports(viewer("milou", ["reports:read", "reports:write"]));
    expect(o.reports.find((r) => r.clientId === ids.actief)!.clientActive).toBe(true);
    expect(o.reports.find((r) => r.clientId === ids.gepauzeerd)!.clientActive).toBe(false);
    // Klant wordt inactief: rapport blijft, status volgt automatisch.
    await db.update(s.clients).set({ status: "churned" }).where((await import("drizzle-orm")).eq(s.clients.id, ids.actief!));
    o = await listMonthlyReports(viewer("milou", ["reports:read", "reports:write"]));
    const r = o.reports.find((x) => x.clientId === ids.actief)!;
    expect(r).toBeTruthy();
    expect(r.clientActive).toBe(false);
    expect(o.clients.find((c) => c.id === ids.actief)!.active).toBe(false);
    await db.update(s.clients).set({ status: "active" }).where((await import("drizzle-orm")).eq(s.clients.id, ids.actief!));
  });

  it("teamleden zien alleen goedgekeurde rapporten", async () => {
    const { listMonthlyReports, getMonthlyReport } = await import("@/server/reports/service");
    const jiska = viewer("jiska", ["reports:team_read"]);
    expect((await listMonthlyReports(jiska)).reports.length).toBe(0);
    expect(await getMonthlyReport(jiska, ids.reportActief!)).toBeNull();
  });

  it("wijst lezers toe bij goedkeuring, meldt één keer, herinnert en registreert doornemen", async () => {
    const { eq } = await import("drizzle-orm");
    const { assignReportReaders, markRead, runReportTeamNotifications } = await import("@/server/reports/team");
    const { listMonthlyReports, getMonthlyReport } = await import("@/server/reports/service");
    // Jiska schreef deze maand een script voor de klant → scriptschrijver.
    await db.insert(s.scripts).values({ clientId: ids.actief!, title: "Script okt", creatorId: ids.jiska, status: "approved" });
    await db.update(s.clientReports).set({ status: "goedgekeurd", approvedById: ids.jarno, approvedAt: new Date() }).where(eq(s.clientReports.id, ids.reportActief!));
    const n = await assignReportReaders(ids.reportActief!, ids.jarno!);
    expect(n).toBe(2); // Milou (PM) + Jiska (scriptschrijver)
    expect(await assignReportReaders(ids.reportActief!, ids.jarno!)).toBe(0); // idempotent

    const r1 = await runReportTeamNotifications(new Date());
    expect(r1.notified).toBe(2);
    expect(r1.reminded).toBe(0);
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.type, "report_team_ready"));
    expect(notes.length).toBe(2);
    expect(notes[0]!.title).toContain("oktober");

    // Nog een run dezelfde dag: geen nieuwe melding.
    const r2 = await runReportTeamNotifications(new Date());
    expect(r2.notified).toBe(0);

    // Jiska leest het; Milou niet. Na 4 dagen: alleen Milou krijgt een herinnering.
    await markRead(ids.reportActief!, ids.jiska!);
    const later = new Date(Date.now() + 4 * 86400000);
    const r3 = await runReportTeamNotifications(later);
    expect(r3.reminded).toBe(1);
    const rem = await db.select().from(s.notifications).where(eq(s.notifications.type, "report_team_reminder"));
    expect(rem.map((x) => x.userId)).toEqual([ids.milou]);
    // Direct daarna niet opnieuw herinneren.
    expect((await runReportTeamNotifications(later)).reminded).toBe(0);

    // Teamlid ziet het goedgekeurde rapport nu wel, met eigen leesstatus.
    const jiska = viewer("jiska", ["reports:team_read"]);
    const list = await listMonthlyReports(jiska);
    expect(list.reports.map((x) => x.id)).toEqual([ids.reportActief]);
    expect(list.reports[0]!.readByMe).toBe(true);
    expect(list.team["2026-10"]!.find((t) => t.name === "Milou")!.read).toBe(0);
    const detail = await getMonthlyReport(jiska, ids.reportActief!);
    expect(detail!.reads.length).toBe(2);
  });
});

describe("PDF's", () => {
  it("klantversie bevat geen interne analyse; interne versie scheidt feit en verklaring", async () => {
    const { loadReportPdfData } = await import("@/server/reports/service");
    const { renderMonthlyReportHtml } = await import("@/server/reports/pdf-html");
    const { renderInternReportHtml } = await import("@/server/reports/pdf-intern-html");
    // Eén publicatie met een opgeslagen miniatuur.
    const { eq } = await import("drizzle-orm");
    const [pub] = await db.select({ id: s.publications.id }).from(s.publications).where(eq(s.publications.caption, "Video 0"));
    await db.update(s.publications).set({ thumbnailData: "data:image/jpeg;base64,AAAA" }).where(eq(s.publications.id, pub!.id));
    const d = (await loadReportPdfData(ids.reportActief!))!;
    expect(d.videos.length).toBe(5);
    expect(d.videos[0]!.views).toBe(1000);
    expect(d.videos[0]!.thumb).toBe("data:image/jpeg;base64,AAAA");
    const klant = renderMonthlyReportHtml({ clientName: d.clientName, logoUrl: null, periodLabel: d.periodLabel, totals: d.totals as never, analysis: d.analysis, klanttekst: "Mooie maand", videos: d.videos });
    expect(klant).toContain("Al jullie video's van oktober");
    expect(klant).toContain("data:image/jpeg;base64,AAAA");
    expect(klant).toContain("Actief BV");
    expect(klant).toContain("Twee rondleidingen per week");
    expect(klant).not.toContain("Rondleidingen werken"); // interne kern
    expect(klant).not.toContain("Mogelijke verklaring");
    expect(klant).not.toContain("Sterke opening");
    const intern = renderInternReportHtml({ clientName: d.clientName, periodLabel: d.periodLabel, pmName: d.pmName, statusLabel: "Goedgekeurd", approvedAt: d.approvedAt, totals: d.totals as never, analysis: d.analysis, beoordeling: d.beoordeling, ontbrekend: d.ontbrekend });
    expect(intern).toContain("Gemeten (feit)");
    expect(intern).toContain("Mogelijke verklaring");
    expect(intern).toContain("Sterke opening");
    expect(intern).toContain("niet delen met de klant");
    expect(intern).toContain("Geen retentiedata");
  });
});
