import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";
import {
  addMonthsClamped, approveBlocker, calendarQuarterOf, contractQuarter, contractQuarterOf, gewensteKwartaalTaken, isAchterstallig, parseQuarterTaskKey,
  previousQuarter, quarterFromKey, quarterHealth, quarterOf, quarterPhase, quarterSchedule, quarterTaskKey, vergelijkbaarheid,
} from "@/lib/kwartaal";
import { normalizeKlant, quarterChecks, unverifiedNumbers, EMPTY_INTERN } from "@/lib/kwartaal-inhoud";

/**
 * Kwartaalrapportages, end-to-end tegen een echte (PGlite) database. Dekt de
 * twaalf afgesproken situaties: organisch, advertentie, combinatie, start
 * halverwege, onvolledige data, contractkwartalen, pakketwijziging, afkeuren,
 * opnieuw genereren, publicatie, afscherming van interne informatie en een
 * kwartaal zonder vergelijking. De AI is vervangen door een vaste respons.
 */

let aiCalls: Array<{ system: string; user: string }> = [];
const KLANT_AI = {
  directie: { bereikt: "Meer bereik", opgeleverd: "Video's en inzichten", geleerd: "Rondleidingen werken", volgend: "Meer rondleidingen" },
  samenvatting: { kern: "Een sterk kwartaal met groei in weergaven.", resultaten: ["Groei in weergaven"], positief: "Meer bereik", inzichten: ["Korte hooks werken"], tegenvallers: [{ wat: "Minder saves in augustus", oorzaak: "Vakantieperiode", zekerheid: "hypothese" }], verbeterd: [], kans: "Meer rondleidingen", advies: "Blijf rondleidingen maken" },
  opgeleverd: { tekst: "Shortclips verzorgde concept tot publicatie.", diensten: ["script", "opnames"] },
  trends: [{ titel: "Stijgende weergaven", beschrijving: "Elke maand meer", verklaring: "Sterkere hooks", zekerheid: "hypothese" }],
  topVideos: [{ key: "v1", waarom: "Sterke opening", meenemen: "Vaker zo openen", zekerheid: "hypothese" }, { key: "v99", waarom: "bestaat niet", meenemen: "", zekerheid: "bewezen" }],
  geleerd: { onderwerpen: [{ punt: "Rondleidingen", onderbouwing: "Meeste weergaven", zekerheid: "bewezen" }], hooks: [], formats: [], lengtes: [], presentatoren: [], doelgroep: [], vaker: ["Rondleidingen"], minder: ["Lange intro's"] },
  impact: { direct: ["Veel leads binnengekomen"], indirect: ["Meer volgers"], kwalitatief: [], nietMeetbaar: "" },
  verbeterpunten: [{ constatering: "Hooks zijn te lang", belang: "Kijkers haken af", actie: "Hooks inkorten", verwachtResultaat: "Hogere kijktijd", verantwoordelijke: "scriptschrijver" }],
  plan: { binnenPakket: [{ titel: "Drie rondleidingen", toelichting: "Bewezen format" }], aanvullend: [{ titel: "Advertentietest", toelichting: "Buiten pakket" }] },
  conclusie: { kern: "De samenwerking levert groei op.", bereikt: "Meer bereik", kansen: "Rondleidingen", verbeteringen: "Hooks", prioriteiten: ["Rondleidingen"] },
};
const INTERN_AI = { kern: "INTERN-GEHEIM: klant twijfelt", risicos: [{ titel: "Churnrisico", toelichting: "INTERN-GEHEIM" }], kritisch: ["Wij leveren te laat"], gesprek: ["Benoem de daling"], commercieel: [{ kans: "Upsell ads", onderbouwing: "INTERN-GEHEIM" }], acties: [{ actie: "Hooks inkorten", rol: "script", waarom: "Kijktijd" }], opvolging: "" };

vi.mock("@/server/ai/client", () => ({
  aiConfigured: () => true,
  runPrompt: async () => ({ ok: true, text: "tekst", model: "test" }),
  runJsonPrompt: async (input: { system: string; user: string }) => {
    aiCalls.push(input);
    return { ok: true, model: "test", data: input.system.includes("INTERNE versie") ? INTERN_AI : KLANT_AI };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
const pending: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => { pending.push(Promise.resolve().then(fn)); } }));
const settle = async () => { while (pending.length) await pending.shift(); };

type V = import("@/server/auth/context").Viewer;
let current: V | null = null;
vi.mock("@/server/auth/context", async (orig) => {
  const actual = await orig<typeof import("@/server/auth/context")>();
  const need = () => { if (!current) throw new Error("geen viewer"); return current; };
  return {
    ...actual,
    requireViewer: async () => need(),
    requireInternal: async () => need(),
    requirePermission: async (p: string) => { const v = need(); if (!v.permissions.has(p)) throw new actual.ForbiddenError(`Recht ${p} nodig`); return v; },
  };
});

type Db = Awaited<ReturnType<typeof freshDatabase>>;
type Schema = typeof import("@/db/schema");
let db: Db;
let s: Schema;
const ids: Record<string, string> = {};

const at = (day: string) => vi.setSystemTime(new Date(`${day}T09:00:00Z`));

function viewer(key: string, perms: string[], opts: { portalClient?: string } = {}): V {
  return {
    id: ids[key]!, email: `${key}@test.nl`, fullName: key, primaryRole: key === "jarno" ? "owner" : opts.portalClient ? "client" : key === "milou" ? "operational_manager" : "content_creator",
    clientId: opts.portalClient ?? null, avatarUrl: null, status: "active",
    permissions: new Set(perms), clientScope: opts.portalClient ? [opts.portalClient] : null, isPortalUser: Boolean(opts.portalClient), isEditorOnly: false,
  } as unknown as V;
}
const jarno = () => viewer("jarno", ["reports:read", "reports:write", "reports:team_read", "reports:approve", "tasks:write"]);
const milou = () => viewer("milou", ["reports:read", "reports:write", "tasks:write"]);
const jiska = () => viewer("jiska", ["reports:team_read"]);

async function seedDays(clientId: string, from: string, to: string, views: number, platforms: Array<"instagram" | "tiktok"> = ["instagram", "tiktok"]) {
  const rows: Array<Record<string, unknown>> = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    for (const platform of platforms) rows.push({ clientId, platform, measuredOn: d.toISOString().slice(0, 10), views, reach: Math.round(views * 0.7), engagements: 10, followerDelta: 1, likes: 6, comments: 2, shares: 1, saves: 1, source: "metricool" });
  }
  for (let i = 0; i < rows.length; i += 200) await db.insert(s.dailyMetrics).values(rows.slice(i, i + 200) as never);
}

async function seedVideos(clientId: string, days: string[], baseViews = 1000) {
  for (const [i, day] of days.entries()) {
    for (const platform of ["instagram", "tiktok"] as const) {
      const [pub] = await db.insert(s.publications).values({ clientId, platform, status: "published", publishedAt: new Date(`${day}T12:00:00Z`), caption: `Rondleiding door het magazijn deel ${i + 1} met een hele duidelijke uitleg`, durationSeconds: 30 }).returning({ id: s.publications.id });
      await db.insert(s.socialMetrics).values({ publicationId: pub!.id, clientId, platform, measuredOn: "2026-10-01", views: baseViews - i * 100, likes: 20, comments: 4, shares: 2, saves: 3, avgWatchSeconds: "12.5", completionRate: "0.4100" });
    }
  }
}

async function report(clientKey: string, periodKey?: string) {
  const { and, eq } = await import("drizzle-orm");
  const rows = await db.select().from(s.quarterlyReports).where(periodKey ? and(eq(s.quarterlyReports.clientId, ids[clientKey]!), eq(s.quarterlyReports.periodKey, periodKey)) : eq(s.quarterlyReports.clientId, ids[clientKey]!));
  return rows.sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)))[0]!;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-08-03");
  db = await freshDatabase();
  s = await import("@/db/schema");

  const perms = await db.insert(s.permissions).values(["reports:read", "reports:write", "reports:team_read", "reports:approve"].map((key) => ({ key, resource: "reports", action: key.split(":")[1]! }))).returning({ id: s.permissions.id, key: s.permissions.key });
  const p = Object.fromEntries(perms.map((x) => [x.key, x.id]));
  const roles = await db.insert(s.roles).values([{ key: "owner", name: "Eigenaar" }, { key: "operational_manager", name: "OM" }, { key: "content_creator", name: "CC" }, { key: "client", name: "Klant" }]).returning({ id: s.roles.id, key: s.roles.key });
  const r = Object.fromEntries(roles.map((x) => [x.key, x.id]));
  await db.insert(s.rolePermissions).values([
    ...["reports:read", "reports:write", "reports:team_read", "reports:approve"].map((k) => ({ roleId: r.owner!, permissionId: p[k]! })),
    { roleId: r.operational_manager!, permissionId: p["reports:read"]! }, { roleId: r.operational_manager!, permissionId: p["reports:write"]! },
    { roleId: r.content_creator!, permissionId: p["reports:team_read"]! },
  ]);
  const users = await db.insert(s.users).values([
    { email: "jarno@test.nl", fullName: "Jarno", primaryRole: "owner", status: "active" },
    { email: "milou@test.nl", fullName: "Milou", primaryRole: "operational_manager", status: "active" },
    { email: "jiska@test.nl", fullName: "Jiska", primaryRole: "content_creator", status: "active" },
  ]).returning({ id: s.users.id, email: s.users.email });
  for (const u of users) ids[u.email.split("@")[0]!] = u.id;
  await db.insert(s.userRoles).values([{ userId: ids.jarno!, roleId: r.owner! }, { userId: ids.milou!, roleId: r.operational_manager! }, { userId: ids.jiska!, roleId: r.content_creator! }]);

  const clients = await db.insert(s.clients).values([
    { slug: "organisch", name: "Organisch BV", status: "active", coordinatorId: ids.milou, contentFocus: "organisch", monthlyVideoQuota: 6, startedOn: "2025-01-01" },
    { slug: "ads", name: "Ads BV", status: "active", coordinatorId: ids.milou, contentFocus: "advertentie", monthlyVideoQuota: 6, startedOn: "2025-01-01" },
    { slug: "combi", name: "Combi BV", status: "active", coordinatorId: ids.milou, contentFocus: "beide", monthlyVideoQuota: 8, startedOn: "2025-01-01" },
    { slug: "nieuw", name: "Nieuw BV", status: "active", coordinatorId: ids.milou, contentFocus: "organisch", monthlyVideoQuota: 6, startedOn: "2026-08-20" },
    { slug: "geendata", name: "Geen Data BV", status: "active", coordinatorId: ids.milou, contentFocus: "organisch", startedOn: "2025-01-01" },
    { slug: "contract", name: "Contract BV", status: "active", coordinatorId: ids.milou, contentFocus: "organisch", monthlyVideoQuota: 6, startedOn: "2026-02-15" },
    { slug: "wissel", name: "Wissel BV", status: "active", coordinatorId: ids.milou, contentFocus: "organisch", startedOn: "2025-01-01" },
    { slug: "gestopt", name: "Gestopt BV", status: "churned", coordinatorId: ids.milou, contentFocus: "organisch", startedOn: "2025-01-01" },
  ]).returning({ id: s.clients.id, slug: s.clients.slug });
  for (const c of clients) ids[c.slug] = c.id;
  const portal = await db.insert(s.users).values([
    { email: "klant-organisch@test.nl", fullName: "Klant Organisch", primaryRole: "client", status: "active", clientId: ids.organisch },
    { email: "klant-ads@test.nl", fullName: "Klant Ads", primaryRole: "client", status: "active", clientId: ids.ads },
  ]).returning({ id: s.users.id, email: s.users.email });
  for (const u of portal) ids[u.email.split("@")[0]!] = u.id;

  await db.insert(s.clientIntegrations).values(["organisch", "ads", "combi", "nieuw", "contract", "wissel"].map((k, i) => ({ clientId: ids[k]!, provider: "metricool" as const, externalId: String(i + 1), isActive: true })));
  await db.insert(s.clientQuarterSettings).values({ clientId: ids.contract!, mode: "contract" });

  // Organisch: volledig Q2 en Q3 (Q3 groeit), plus video's, een opnamedag en een script.
  await seedDays(ids.organisch!, "2026-04-01", "2026-06-30", 100);
  await seedDays(ids.organisch!, "2026-07-01", "2026-09-30", 150);
  await seedVideos(ids.organisch!, ["2026-07-10", "2026-08-12", "2026-09-05", "2026-09-20"]);
  await db.insert(s.productionDays).values({ clientId: ids.organisch!, title: "Opname", scheduledOn: "2026-08-05" });
  await db.insert(s.scripts).values({ clientId: ids.organisch!, title: "Script rondleiding", createdAt: new Date("2026-07-05T10:00:00Z") });
  // Ads en combinatie: volledig Q3, geen Q2.
  for (const k of ["ads", "combi"]) { await seedDays(ids[k]!, "2026-07-01", "2026-09-30", 80); await seedVideos(ids[k]!, ["2026-07-15", "2026-09-01"], 500); }
  // Nieuw: cijfers vanaf de startdatum.
  await seedDays(ids.nieuw!, "2026-08-20", "2026-09-30", 60);
  await seedVideos(ids.nieuw!, ["2026-09-10"], 400);
  // Contract: 15 mei t/m 14 augustus.
  await seedDays(ids.contract!, "2026-05-15", "2026-08-14", 90);
  await seedVideos(ids.contract!, ["2026-06-01", "2026-07-20"], 700);
  // Wissel: pakket gaat op 1 september van 6 naar 8 video's per maand.
  await seedDays(ids.wissel!, "2026-07-01", "2026-09-30", 70);
  await seedVideos(ids.wissel!, ["2026-07-08"], 300);
  await db.insert(s.contracts).values([
    { clientId: ids.wissel!, startsOn: "2026-01-01", endsOn: "2026-08-31", videosPerMonth: 6 },
    { clientId: ids.wissel!, startsOn: "2026-09-01", endsOn: "2027-08-31", videosPerMonth: 8 },
  ]);
}, 240000);

afterAll(async () => { vi.useRealTimers(); await closeDatabase(); });

/* ------------------------------------------------------------------ */

describe("periodes", () => {
  it("kalenderkwartalen", () => {
    const q = calendarQuarterOf("2026-11-15");
    expect([q.key, q.from, q.to, q.label]).toEqual(["2026-Q4", "2026-10-01", "2026-12-31", "Q4 2026"]);
    expect(q.segments.map((x) => x.from)).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(previousQuarter(calendarQuarterOf("2026-02-01"))!.key).toBe("2025-Q4");
  });

  it("contractkwartalen vanaf de startdatum (15 februari tot en met 14 mei)", () => {
    const q1 = contractQuarter("2026-02-15", 1);
    expect([q1.from, q1.to, q1.key]).toEqual(["2026-02-15", "2026-05-14", "C2026-02-15"]);
    expect(contractQuarterOf("2026-02-15", "2026-05-14")!.index).toBe(1);
    expect(contractQuarterOf("2026-02-15", "2026-05-15")!.index).toBe(2);
    expect(contractQuarterOf("2026-02-15", "2026-02-14")).toBeNull();
    expect(previousQuarter(q1, "2026-02-15")).toBeNull();
    expect(quarterFromKey("C2026-05-15", "2026-02-15")!.index).toBe(2);
    // Start op de 31e verschuift niet: altijd vanaf het anker gerekend.
    expect(addMonthsClamped("2026-08-31", 6)).toBe("2027-02-28");
    expect(contractQuarter("2026-08-31", 3).from).toBe("2027-02-28");
    expect(contractQuarter("2026-08-31", 4).from).toBe("2027-05-31");
    // Contract zonder startdatum valt terug op het kalenderkwartaal.
    expect(quarterOf("contract", null, "2026-08-01").key).toBe("2026-Q3");
  });

  it("planning: dag 1 derde maand, halverwege, laatste week, vijf en zeven werkdagen na afloop", () => {
    const q = calendarQuarterOf("2026-08-01");
    const sch = quarterSchedule(q);
    expect(sch).toMatchObject({ voorbereiden: "2026-09-01", concept: "2026-09-15", laatsteWeek: "2026-09-24", naAfloop: "2026-10-01", controleDeadline: "2026-10-07", publicatieDeadline: "2026-10-09" });
    expect(quarterPhase(q, "2026-08-31")).toBe("lopend");
    expect(quarterPhase(q, "2026-09-01")).toBe("voorbereiding");
    expect(quarterPhase(q, "2026-09-15")).toBe("concept");
    expect(quarterPhase(q, "2026-09-24")).toBe("laatste_week");
    expect(quarterPhase(q, "2026-10-01")).toBe("na_afloop");
    expect(isAchterstallig({ status: "klaar_voor_controle" }, q, "2026-10-07")).toBe(false);
    expect(isAchterstallig({ status: "klaar_voor_controle" }, q, "2026-10-08")).toBe(true);
    expect(isAchterstallig({ status: "gepubliceerd" }, q, "2026-12-01")).toBe(false);
  });

  it("taaksleutels en taken per status", () => {
    const key = quarterTaskKey("abc", "C2026-02-15", "controleren");
    expect(parseQuarterTaskKey(key)).toEqual({ clientId: "abc", periodKey: "C2026-02-15", stap: "controleren" });
    expect(parseQuarterTaskKey("maandrapport:abc:2026-10:controleren")).toBeNull();
    const q = calendarQuarterOf("2026-08-01");
    const w = gewensteKwartaalTaken({ status: "klaar_voor_controle", controller: "milou", gecontroleerd: false }, q, "jarno");
    expect(w.controleren?.open).toBe(true);
    expect(w.goedkeuren?.open).toBe(false);
    const w2 = gewensteKwartaalTaken({ status: "klaar_voor_controle", controller: "milou", gecontroleerd: true }, q, "jarno");
    expect(w2.controleren?.afgerond).toBe(true);
    expect(w2.goedkeuren).toMatchObject({ open: true, assignee: "jarno" });
    // Jarno zelf verantwoordelijk: één taak tot en met goedkeuren.
    const w3 = gewensteKwartaalTaken({ status: "klaar_voor_controle", controller: "jarno", gecontroleerd: true }, q, "jarno");
    expect(w3.controleren?.open).toBe(true);
    expect(w3.goedkeuren).toBeUndefined();
  });

  it("goedkeuren kan nooit met voorlopige cijfers", () => {
    expect(approveBlocker({ status: "klaar_voor_controle", voorlopig: true, hasAnalysis: true, bezig: false })).toMatch(/voorlopig/);
    expect(approveBlocker({ status: "concept_gegenereerd", voorlopig: false, hasAnalysis: true, bezig: false })).toMatch(/controle/);
    expect(approveBlocker({ status: "klaar_voor_controle", voorlopig: false, hasAnalysis: true, bezig: false })).toBeNull();
  });

  it("vergelijkbaarheid en gezondheid met zichtbare criteria", () => {
    expect(vergelijkbaarheid({ dagen: 92, meetdagen: 92, platforms: ["instagram"] }, null).vergelijkbaar).toBe(false);
    expect(vergelijkbaarheid({ dagen: 92, meetdagen: 92, platforms: ["instagram"] }, { dagen: 91, meetdagen: 40, platforms: ["instagram"] }).vergelijkbaar).toBe(false);
    expect(vergelijkbaarheid({ dagen: 92, meetdagen: 92, platforms: ["instagram", "tiktok"] }, { dagen: 91, meetdagen: 91, platforms: ["instagram"] }).redenen[0]).toMatch(/kanalen/);
    expect(vergelijkbaarheid({ dagen: 92, meetdagen: 92, platforms: ["instagram"] }, { dagen: 91, meetdagen: 91, platforms: ["instagram"] }).vergelijkbaar).toBe(true);
    const h = quarterHealth({ viewsPct: null, doelen: { totaal: 0, behaald: 0 }, dekking: 1, ontbrekend: 0, afspraak: { verwacht: 18, gepubliceerd: 12 }, verbeteringen: { totaal: 4, uitgevoerd: 0 }, feedback: null });
    expect(h.find((c) => c.key === "resultaten")!.niveau).toBe("onbekend");
    expect(h.find((c) => c.key === "pakket")!.niveau).toBe("zorg");
    expect(h.find((c) => c.key === "verbeteringen")!.niveau).toBe("zorg");
    expect(h.every((c) => c.toelichting.length > 10)).toBe(true);
  });

  it("cijfercontrole: een getal dat niet uit de cijfers komt wordt gemeld", () => {
    const metrics = { totaal: { views: 27600, reach: 19320 }, vorig: { pct: { views: 50.5 } } };
    expect(unverifiedNumbers({ a: "We haalden 27.600 weergaven, +50,5% en ruim 19.300 bereik in 2026 met 4 video's." }, metrics)).toEqual([]);
    expect(unverifiedNumbers({ a: "Dit leverde 4.200 leads en 37% meer omzet op." }, metrics)).toEqual(["4.200", "37%"]);
    const klant = normalizeKlant({ ...KLANT_AI, samenvatting: { ...KLANT_AI.samenvatting, kern: "We haalden 99.999 weergaven." } });
    const checks = quarterChecks({ klant, intern: EMPTY_INTERN, metrics, conversiesGemeten: false, ontbrekend: [], dataCompleet: true, dataOverride: false, openFeedback: 0 });
    expect(checks.some((c) => c.id === "cijfer:99.999" && c.severity === "blok")).toBe(true);
    expect(checks.some((c) => c.id === "impact")).toBe(true);
    const bevestigd = quarterChecks({ klant, intern: { ...EMPTY_INTERN, akkoord: ["cijfer:99.999", "impact"] }, metrics, conversiesGemeten: false, ontbrekend: [], dataCompleet: true, dataOverride: false, openFeedback: 0 });
    expect(bevestigd.filter((c) => c.severity === "blok")).toEqual([]);
  });
});

describe("automatische planning", () => {
  it("plant per actieve klant precies één kwartaal in, ook contractkwartalen, nooit dubbel", async () => {
    const { runQuarterlyPlanner } = await import("@/server/quarterly/workflow");
    at("2026-08-03");
    const a = await runQuarterlyPlanner(new Date());
    // 7 actieve klanten, maar Nieuw BV start pas op 20 augustus.
    expect(a.created).toBe(6);
    const b = await runQuarterlyPlanner(new Date());
    expect(b.created).toBe(0);
    const all = await db.select().from(s.quarterlyReports);
    expect(all.length).toBe(6);
    expect(all.some((r) => r.clientId === ids.gestopt)).toBe(false);
    const c = await report("contract");
    expect([c.periodKey, String(c.periodStart), String(c.periodEnd), c.periodMode]).toEqual(["C2026-05-15", "2026-05-15", "2026-08-14", "contract"]);
    // Contractkwartaal zit al in de derde maand: voorbereiding gestart, kalenderklanten nog niet.
    expect(c.status).toBe("in_voorbereiding");
    expect((await report("organisch")).status).toBe("gepland");
  });

  it("dag 1 van de derde maand: status in voorbereiding en één taak voor de verantwoordelijke", async () => {
    const { runQuarterlyPlanner } = await import("@/server/quarterly/workflow");
    const { like } = await import("drizzle-orm");
    at("2026-09-01");
    await runQuarterlyPlanner(new Date());
    await runQuarterlyPlanner(new Date());
    const r = await report("organisch", "2026-Q3");
    expect(r.status).toBe("in_voorbereiding");
    const taken = (await db.select().from(s.tasks).where(like(s.tasks.dedupeKey, `kwartaalrapport:${ids.organisch}:2026-Q3:%`)));
    expect(taken.length).toBe(1);
    expect(taken[0]).toMatchObject({ assigneeId: ids.milou, entityType: "quarterly_report", status: "todo" });
    // Nieuw BV is inmiddels gestart en doet mee.
    expect((await report("nieuw", "2026-Q3")).status).toBe("in_voorbereiding");
  });

  it("halverwege de derde maand: voorlopig concept, duidelijk gemarkeerd en niet goed te keuren", async () => {
    const { runQuarterlyPlanner, runQuarterlyQueue } = await import("@/server/quarterly/workflow");
    const { approveQuarter, markQuarterReviewed } = await import("@/server/actions/quarterly-reports");
    at("2026-09-16");
    const plan = await runQuarterlyPlanner(new Date());
    expect(plan.queuedVoorlopig).toBeGreaterThanOrEqual(6);
    await runQuarterlyQueue();
    const r = await report("organisch", "2026-Q3");
    expect(r.status).toBe("concept_gegenereerd");
    expect(r.voorlopig).toBe(true);
    const m = r.metrics as { voorlopig: boolean; totaal: { dagen: number }; vorig: { vergelijkbaar: boolean; pct: Record<string, number> } };
    expect(m.voorlopig).toBe(true);
    expect(m.totaal.dagen).toBe(77); // 1 juli t/m 15 september
    expect(m.vorig.vergelijkbaar).toBe(false); // kwartaal loopt nog: geen groeipercentages
    expect(m.vorig.pct).toEqual({});
    current = jarno();
    expect((await approveQuarter(r.id)).ok).toBe(false);
    expect((await markQuarterReviewed(r.id)).message).toMatch(/voorlopig/);
    // Tweede planner-run zet niets opnieuw in de wachtrij.
    expect((await runQuarterlyPlanner(new Date())).queuedVoorlopig).toBe(0);
  });

  it("na afloop: definitieve cijfers, of wachten als de data niet compleet is", async () => {
    const { runQuarterlyPlanner, runQuarterlyQueue } = await import("@/server/quarterly/workflow");
    at("2026-10-01");
    aiCalls = [];
    await runQuarterlyPlanner(new Date());
    await runQuarterlyQueue();
    const r = await report("organisch", "2026-Q3");
    expect(r.status).toBe("klaar_voor_controle");
    expect(r.voorlopig).toBe(false);
    // Klant zonder socialmediadata: nooit automatisch definitief.
    const g = await report("geendata", "2026-Q3");
    expect(g.status).toBe("wachten_op_data");
    expect(g.wachtReden).toMatch(/Metricool/);
    expect(g.voorlopig).toBe(true);
    // De volgende dag wordt er opnieuw gekeken, zonder dubbele rapportage.
    at("2026-10-02");
    const again = await runQuarterlyPlanner(new Date());
    expect(again.queuedDefinitief).toBe(1);
    await runQuarterlyQueue();
    expect((await db.select().from(s.quarterlyReports)).filter((x) => x.clientId === ids.geendata && x.periodKey === "2026-Q3").length).toBe(1);
    // Voor Q4 staat inmiddels voor elke klant een nieuw kwartaal gepland.
    expect((await report("organisch", "2026-Q4")).status).toBe("gepland");
  });

  it("één dagoverzicht per medewerker, geen losse meldingen per klant", async () => {
    const { eq } = await import("drizzle-orm");
    const { sendQuarterlyDigest } = await import("@/server/quarterly/workflow");
    at("2026-10-02");
    expect(await sendQuarterlyDigest(new Date())).toBeGreaterThanOrEqual(1);
    expect(await sendQuarterlyDigest(new Date())).toBe(0); // tweede keer op dezelfde dag: niets
    const notes = (await db.select().from(s.notifications).where(eq(s.notifications.type, "quarter_report_digest")));
    const mijn = notes.filter((n) => n.userId === ids.milou);
    expect(mijn.length).toBe(1);
    expect(mijn[0]!.body).toMatch(/Definitieve rapportage beschikbaar: .*Organisch BV/);
    expect(mijn[0]!.body).toMatch(/Ontbrekende gegevens: Geen Data BV/);
    // In het weekend geen overzicht.
    at("2026-10-03");
    expect(await sendQuarterlyDigest(new Date())).toBe(0);
  });
});

describe("cijfers per type klant", () => {
  type M = import("@/server/quarterly/metrics").QuarterMetrics;
  const metricsOf = async (key: string, period = "2026-Q3") => (await report(key, period)).metrics as unknown as M;

  it("1. organische klant met een volledig kwartaal en eerlijke vergelijking", async () => {
    const m = await metricsOf("organisch");
    expect(m.pakket.type).toBe("organisch");
    expect(m.totaal.views).toBe(92 * 2 * 150);
    expect(m.totaal.meetdagen).toBe(92);
    expect(m.segmenten.map((x) => x.views)).toEqual([31 * 300, 31 * 300, 30 * 300]);
    // Vier video's op twee kanalen: vier unieke video's, acht plaatsingen (geen dubbeltelling).
    expect(m.geleverd.gepubliceerd).toBe(4);
    expect(m.geleverd.plaatsingen).toBe(8);
    expect(m.totaal.videos).toBe(4);
    expect(m.videos[0]!.views).toBe(2000);
    expect(m.videos[0]!.platforms.sort()).toEqual(["instagram", "tiktok"]);
    expect(m.geleverd.opnamedagen).toBe(1);
    expect(m.geleverd.concepten).toBe(1);
    expect(m.pakket.verwachtInKwartaal).toBe(18);
    expect(m.vorig!.vergelijkbaar).toBe(true);
    expect(m.vorig!.pct.views).toBe(51.6); // 27.600 t.o.v. 18.200
    expect(m.kijktijd.gemSec).toBe(13);
    expect(m.conversies).toBeNull();
    expect(m.dataCompleet).toBe(true);
    expect(m.bronnen.every((b) => b.naam && b.periode)).toBe(true);
  });

  it("2. advertentieklant: geen advertentiecijfers verzinnen, wel benoemen wat ontbreekt", async () => {
    const r = await report("ads", "2026-Q3");
    const m = r.metrics as unknown as M;
    expect(r.pakketType).toBe("advertentie");
    expect(m.advertenties.gekoppeld).toBe(false);
    expect((r.ontbrekend as string[]).some((o) => /Advertentiecijfers/.test(o))).toBe(true);
    expect(aiCalls.some((c) => c.user.includes("Ads BV") && c.user.includes('"type":"advertentie"'))).toBe(true);
  });

  it("3. combinatieklant krijgt het juiste pakket mee", async () => {
    const m = await metricsOf("combi");
    expect(m.pakket.type).toBe("beide");
    expect(m.pakket.label).toBe("Organisch en advertenties");
    expect(m.pakket.verwachtInKwartaal).toBe(24);
  });

  it("4. nieuwe klant die halverwege start: geen volledig kwartaal, afspraak naar rato, geen vergelijking", async () => {
    const m = await metricsOf("nieuw");
    expect(m.pakket.bijzonderheden.join(" ")).toMatch(/startte op 20 aug/);
    expect(m.pakket.verwachtInKwartaal).toBe(0 + 2 + 6); // juli 0, augustus 12 van 31 dagen, september volledig
    expect(m.vorig!.vergelijkbaar).toBe(false);
    expect(m.vorig!.redenen.join(" ")).toMatch(/liep in het vorige kwartaal nog niet/);
    expect(m.ontbrekend.some((o) => /juli/.test(o))).toBe(true);
  });

  it("6. afwijkende contractkwartalen rekenen met de eigen periode", async () => {
    const r = await report("contract", "C2026-05-15");
    const m = r.metrics as unknown as M;
    expect(r.status).toBe("klaar_voor_controle");
    expect(m.periode).toMatchObject({ from: "2026-05-15", to: "2026-08-14", mode: "contract", dagen: 92 });
    expect(m.totaal.views).toBe(92 * 2 * 90);
    expect(m.segmenten.map((x) => x.from)).toEqual(["2026-05-15", "2026-06-15", "2026-07-15"]);
    // Het volgende contractkwartaal is al ingepland.
    expect((await report("contract", "C2026-08-15")).status).toBe("gepland");
  });

  it("7. pakketwijziging in het kwartaal wordt benoemd en meegerekend", async () => {
    const m = await metricsOf("wissel");
    expect(m.pakket.bijzonderheden.join(" ")).toMatch(/van 6 naar 8/);
    expect(m.pakket.verwachtInKwartaal).toBe(6 + 6 + 8);
    expect(m.pakket.bron).toMatch(/Contractperiode/);
  });

  it("12. kwartaal zonder eerder kwartaal met cijfers: geen groeipercentages", async () => {
    const m = await metricsOf("combi");
    expect(m.vorig!.vergelijkbaar).toBe(false);
    expect(m.vorig!.pct).toEqual({});
    expect(m.vorig!.redenen.join(" ")).toMatch(/geen cijfers gemeten/);
  });

  it("vangnet na de AI: onbestaande topvideo's en verzonnen leads verdwijnen", async () => {
    const r = await report("organisch", "2026-Q3");
    const k = normalizeKlant(r.klant);
    expect(k.topVideos.every((t) => t.key !== "v99")).toBe(true);
    expect(k.topVideos.length).toBeGreaterThanOrEqual(3);
    expect(k.impact.direct).toEqual([]); // geen conversiemeting: geen direct meetbare zakelijke resultaten
    expect(k.impact.nietMeetbaar).toMatch(/geen conversiemeting/i);
  });
});

describe("goedkeuringsproces", () => {
  it("5. klant zonder volledige data: alleen een mens kan bewust afronden", async () => {
    const { finishWithIncompleteData, approveQuarter } = await import("@/server/actions/quarterly-reports");
    const { getQuarterlyReport } = await import("@/server/quarterly/service");
    at("2026-10-05");
    const g = await report("geendata", "2026-Q3");
    current = milou();
    expect((await finishWithIncompleteData(g.id, "kort")).ok).toBe(false);
    expect((await finishWithIncompleteData(g.id, "Klant heeft geen koppeling, we rapporteren op wat er is.")).ok).toBe(true);
    await settle();
    const after = await report("geendata", "2026-Q3");
    expect(after.status).toBe("klaar_voor_controle");
    expect((after.ontbrekend as string[])[0]).toMatch(/Bewust afgerond met onvolledige data/);
    expect(after.dataOverrideById).toBe(ids.milou);
    const d = await getQuarterlyReport(jarno(), g.id);
    expect(d!.events.some((e) => e.type === "onvolledige_data_geaccepteerd" && e.byName === "Milou")).toBe(true);
    // Controlepunt "ontbrekende gegevens" vraagt nog een bewuste bevestiging, maar blokkeert niet.
    expect(d!.checks.some((c) => c.id === "ontbrekend" && c.severity === "let_op")).toBe(true);
    current = jarno();
    expect((await approveQuarter(g.id)).ok).toBe(true);
  });

  it("8 en 9. afkeuren zet terug, opnieuw genereren verwerkt de opmerking en bewaart de versies", async () => {
    const { requestQuarterChanges, approveQuarter } = await import("@/server/actions/quarterly-reports");
    const { getQuarterlyReport } = await import("@/server/quarterly/service");
    const r = await report("combi", "2026-Q3");
    current = milou();
    expect((await requestQuarterChanges(r.id, "", false)).ok).toBe(true);
    await settle();
    expect((await report("combi", "2026-Q3")).status).toBe("aanpassingen_nodig");
    aiCalls = [];
    expect((await requestQuarterChanges(r.id, "Noem de advertenties apart van organisch.", true)).ok).toBe(true);
    // Zolang de opmerking openstaat kan er niet goedgekeurd worden.
    current = jarno();
    expect((await approveQuarter(r.id)).ok).toBe(false);
    await settle();
    const after = await report("combi", "2026-Q3");
    expect(after.status).toBe("klaar_voor_controle");
    expect(after.openFeedback).toEqual([]);
    expect(aiCalls.some((c) => c.user.includes("Noem de advertenties apart van organisch."))).toBe(true);
    const d = await getQuarterlyReport(jarno(), r.id);
    expect(d!.versions.filter((v) => v.kind === "generatie").length).toBeGreaterThanOrEqual(3); // concept, definitief, na opmerking
    expect(d!.events.map((e) => e.type)).toEqual(expect.arrayContaining(["aanpassingen_gevraagd", "definitief_gegenereerd"]));
  });

  it("alleen een bevoegd teamlid keurt goed; controle en goedkeuring worden vastgelegd", async () => {
    const { markQuarterReviewed, approveQuarter, publishQuarter } = await import("@/server/actions/quarterly-reports");
    const { getQuarterlyReport } = await import("@/server/quarterly/service");
    const { syncQuarterlyTasks } = await import("@/server/quarterly/workflow");
    const { like } = await import("drizzle-orm");
    const r = await report("organisch", "2026-Q3");
    // Publiceren vóór goedkeuring kan niet.
    current = milou();
    expect((await publishQuarter(r.id)).ok).toBe(false);
    expect((await approveQuarter(r.id)).message).toMatch(/bevoegd/);
    expect((await markQuarterReviewed(r.id)).ok).toBe(true);
    await settle();
    await syncQuarterlyTasks();
    const taken = await db.select().from(s.tasks).where(like(s.tasks.dedupeKey, `kwartaalrapport:${ids.organisch}:2026-Q3:%`));
    const stap = (k: string) => taken.find((t) => t.dedupeKey!.endsWith(`:${k}`));
    expect(stap("voorbereiden")!.status).toBe("done");
    expect(stap("controleren")!.status).toBe("done");
    expect(stap("goedkeuren")).toMatchObject({ status: "todo", assigneeId: ids.jarno });
    current = jarno();
    expect((await approveQuarter(r.id)).ok).toBe(true);
    await settle();
    const d = await getQuarterlyReport(jarno(), r.id);
    expect(d).toMatchObject({ status: "goedgekeurd", reviewedByName: "Milou", approvedByName: "Jarno" });
    expect(d!.approvedVersion).toBe(d!.versie);
    expect(d!.publishedVersion).toBeNull();
    // Na goedkeuring: lessen in het Contentgeheugen en verbeterpunten voor de opvolging.
    const lessons = await db.select().from(s.quarterlyLessons);
    expect(lessons.filter((l) => l.clientId === ids.organisch).map((l) => l.kind).sort()).toEqual(["minder", "onderwerp", "vaker"]);
    expect(d!.improvements.map((i) => i.titel)).toEqual(["Hooks zijn te lang"]);
    const { quarterLessonsPromptText } = await import("@/server/quarterly/service");
    expect(await quarterLessonsPromptText(ids.organisch!)).toMatch(/Vaker maken: Rondleidingen/);
    expect(await quarterLessonsPromptText(ids.ads!)).toBe("");
  });

  it("wijzigen na goedkeuring kan alleen via heropenen, daarna is opnieuw goedkeuring nodig", async () => {
    const { saveQuarterContent, requestQuarterChanges, resolveQuarterFeedback, approveQuarter, markQuarterReviewed } = await import("@/server/actions/quarterly-reports");
    const r = await report("organisch", "2026-Q3");
    current = milou();
    expect((await saveQuarterContent(r.id, { toelichting: "x" })).ok).toBe(false);
    expect((await requestQuarterChanges(r.id, "Conclusie aanscherpen.", false)).ok).toBe(true);
    await settle();
    let now = await report("organisch", "2026-Q3");
    expect([now.status, now.approvedAt, now.approvedVersion]).toEqual(["aanpassingen_nodig", null, null]);
    const klant = normalizeKlant(now.klant);
    klant.conclusie.kern = "Aangescherpte conclusie.";
    expect((await saveQuarterContent(r.id, { klant })).ok).toBe(true);
    expect((await resolveQuarterFeedback(r.id)).ok).toBe(true);
    expect((await markQuarterReviewed(r.id)).ok).toBe(true);
    current = jarno();
    expect((await approveQuarter(r.id)).ok).toBe(true);
    await settle();
    now = await report("organisch", "2026-Q3");
    expect(now.status).toBe("goedgekeurd");
    // Verbeterpunten zijn niet verdubbeld door de tweede goedkeuring.
    expect((await db.select().from(s.quarterlyImprovements)).filter((i) => i.reportId === r.id).length).toBe(1);
    expect((await db.select().from(s.quarterlyLessons)).filter((l) => l.reportId === r.id).length).toBe(3);
  });
});

describe("klantportaal", () => {
  it("10 en 11. alleen de gepubliceerde klantversie, alleen voor de eigen klant, zonder interne informatie", async () => {
    const { publishQuarter } = await import("@/server/actions/quarterly-reports");
    const { getPortalQuarterlyReports, getPortalQuarterDetail, getQuarterlyReport, listQuarterlyReports } = await import("@/server/quarterly/service");
    const { renderQuarterKlantHtml, renderQuarterInternHtml } = await import("@/server/quarterly/pdf-html");
    const r = await report("organisch", "2026-Q3");
    const klantOrg = viewer("klant-organisch", [], { portalClient: ids.organisch });
    const klantAds = viewer("klant-ads", [], { portalClient: ids.ads });
    // Goedgekeurd maar niet gepubliceerd: de klant ziet niets.
    expect(await getPortalQuarterlyReports(klantOrg)).toEqual([]);
    expect(await getPortalQuarterDetail(klantOrg, r.id)).toBeNull();
    current = milou();
    expect((await publishQuarter(r.id)).ok).toBe(true);
    await settle();
    const lijst = await getPortalQuarterlyReports(klantOrg);
    expect(lijst.map((x) => [x.periodLabel, x.nieuw])).toEqual([["Q3 2026", true]]);
    const detail = await getPortalQuarterDetail(klantOrg, r.id);
    expect(detail!.klant.conclusie.kern).toBe("Aangescherpte conclusie.");
    const json = JSON.stringify(detail);
    for (const geheim of ["INTERN-GEHEIM", "Churnrisico", "Upsell", "dataKwaliteit", "ontbrekend", "verbetermonitor", "commercieel", "Wij leveren te laat"]) expect(json).not.toContain(geheim);
    expect(renderQuarterKlantHtml(detail!)).not.toContain("INTERN-GEHEIM");
    // Een andere klant komt er niet bij, ook niet met het id.
    expect(await getPortalQuarterDetail(klantAds, r.id)).toBeNull();
    expect(await getPortalQuarterlyReports(klantAds)).toEqual([]);
    // Klanten horen niet in de interne functies.
    await expect(getQuarterlyReport(klantOrg, r.id)).rejects.toThrow();
    // De portaalmelding gaat alleen naar de gebruikers van deze klant.
    const { eq } = await import("drizzle-orm");
    const meldingen = await db.select().from(s.notifications).where(eq(s.notifications.type, "report_published"));
    expect(meldingen.map((m) => m.userId)).toEqual([ids["klant-organisch"]]);
    // De interne PDF bevat de interne analyse wel.
    const { loadQuarterPdfData } = await import("@/server/quarterly/service");
    const { toKlantMetrics } = await import("@/lib/kwartaal-klant");
    const data = (await loadQuarterPdfData(r.id))!;
    expect(renderQuarterInternHtml({ clientName: data.clientName, pmName: data.pmName, title: data.title, periodLabel: data.quarter.label, periodStart: data.quarter.from, periodEnd: data.quarter.to, status: data.status, voorlopig: data.voorlopig, versie: data.versie, approvedAt: data.approvedAt, metrics: data.metrics, klant: data.klant, klantMetrics: toKlantMetrics(data.metrics, data.klant), intern: data.intern, ontbrekend: data.ontbrekend, health: data.health, thumbs: {} })).toContain("INTERN-GEHEIM");
    // Teamleden zonder controlerecht zien alleen goedgekeurde rapportages.
    const team = await listQuarterlyReports(jiska());
    expect(team.teamOnly).toBe(true);
    expect(team.rows.every((x) => x.status === "goedgekeurd" || x.status === "gepubliceerd")).toBe(true);
    expect(await getQuarterlyReport(jiska(), (await report("ads", "2026-Q3")).id)).toBeNull();
  });

  it("een gepubliceerde rapportage verandert niet stilzwijgend; herpublicatie is een bewuste nieuwe versie", async () => {
    const { requestQuarterChanges, resolveQuarterFeedback, markQuarterReviewed, approveQuarter, publishQuarter, unpublishQuarter, generateQuarter } = await import("@/server/actions/quarterly-reports");
    const { getPortalQuarterDetail, getQuarterlyReport } = await import("@/server/quarterly/service");
    const r = await report("organisch", "2026-Q3");
    const klantOrg = viewer("klant-organisch", [], { portalClient: ids.organisch });
    const voor = await getPortalQuarterDetail(klantOrg, r.id);
    // Later komen er andere cijfers binnen: het gepubliceerde rapport blijft gelijk.
    await seedDays(ids.organisch!, "2026-10-01", "2026-10-03", 9999);
    await db.update(s.dailyMetrics).set({ views: 1 });
    expect((await getPortalQuarterDetail(klantOrg, r.id))!.metrics.totaal.views).toBe(voor!.metrics.totaal.views);
    // Een goedgekeurde rapportage kan niet zomaar opnieuw gegenereerd worden.
    current = milou();
    expect((await generateQuarter(r.id)).message).toMatch(/Heropen/);
    // Heropenen: de oude versie blijft in het portaal staan tot de nieuwe bewust is gepubliceerd.
    expect((await requestQuarterChanges(r.id, "Cijfers opnieuw ophalen.", true)).ok).toBe(true);
    await settle();
    const tussen = await getPortalQuarterDetail(klantOrg, r.id);
    expect(tussen!.versie).toBe(voor!.versie);
    expect(tussen!.metrics.totaal.views).toBe(voor!.metrics.totaal.views);
    const d = await getQuarterlyReport(jarno(), r.id);
    expect(d!.portaalLooptAchter).toBe(true);
    expect(d!.metrics!.totaal.views).toBe(92 * 2); // werkversie heeft de nieuwe cijfers
    expect((await resolveQuarterFeedback(r.id)).ok).toBe(true);
    expect((await markQuarterReviewed(r.id)).ok).toBe(true);
    current = jarno();
    expect((await approveQuarter(r.id)).ok).toBe(true);
    expect((await publishQuarter(r.id)).ok).toBe(true);
    await settle();
    const na = await getPortalQuarterDetail(klantOrg, r.id);
    expect(na!.versie).toBeGreaterThan(voor!.versie);
    expect(na!.metrics.totaal.views).toBe(92 * 2);
    const hist = await getQuarterlyReport(jarno(), r.id);
    expect(hist!.versions.filter((v) => v.kind === "publicatie").length).toBe(1);
    expect(hist!.versions.filter((v) => v.kind === "herpublicatie").length).toBe(1);
    expect(hist!.events.map((e) => e.type)).toEqual(expect.arrayContaining(["heropend", "goedgekeurd", "gepubliceerd"]));
    // Publicatie intrekken haalt de rapportage uit het portaal; de versies blijven bewaard.
    expect((await unpublishQuarter(r.id)).ok).toBe(true);
    expect(await getPortalQuarterDetail(klantOrg, r.id)).toBeNull();
    expect((await getQuarterlyReport(jarno(), r.id))!.versions.length).toBe(hist!.versions.length);
  });
});

describe("verbetermonitor en klantpagina", () => {
  it("verbeterpunten uit het vorige kwartaal komen terug in de volgende rapportage", async () => {
    const { setImprovementStatus } = await import("@/server/actions/quarterly-reports");
    const { generateQuarterReport } = await import("@/server/quarterly/run");
    const { clientQuarterSummary } = await import("@/server/quarterly/service");
    const q3 = await report("organisch", "2026-Q3");
    const [imp] = (await db.select().from(s.quarterlyImprovements)).filter((i) => i.reportId === q3.id);
    current = milou();
    expect((await setImprovementStatus(imp!.id, "uitgevoerd", "Hooks ingekort vanaf oktober")).ok).toBe(true);
    at("2026-12-20");
    const q4 = await report("organisch", "2026-Q4");
    const res = await generateQuarterReport(q4.id, { force: true });
    expect(res.ok).toBe(true);
    const m = (await report("organisch", "2026-Q4")).metrics as unknown as import("@/server/quarterly/metrics").QuarterMetrics;
    expect(m.verbetermonitor).toMatchObject({ periodLabel: "Q3 2026", items: [{ titel: "Hooks zijn te lang", status: "uitgevoerd" }] });
    expect(aiCalls.at(-1)!.user).toContain("Hooks ingekort vanaf oktober");
    const sum = await clientQuarterSummary(ids.organisch!);
    expect(sum).toMatchObject({ periodLabel: "Q4 2026", status: "concept_gegenereerd", voorlopig: true });
    expect(sum!.deadline).not.toBeNull();
  });

  it("de maandrapportages blijven een eigen tabel en flow gebruiken", async () => {
    expect((await db.select().from(s.clientReports)).length).toBe(0);
  });
});
