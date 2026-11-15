import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import {
  applyCorrections,
  compareBaselines,
  knowledgeFromDossier,
  missingInfo,
  nextCheckDate,
  normalizeDossier,
  normalizeSources,
  resumePhase,
  wholeNumber,
  type BaselineRow,
} from "@/lib/client-research";

/**
 * Klantonderzoek: de rekenregels (zonder database) en de hele keten tegen een
 * echte PGlite-database: onderzoek draaien, controleren, corrigeren,
 * goedkeuren, koppelen aan klantkennis, hercontrole na 90 dagen en het
 * automatisch starten bij een nieuwe klant. De AI is vervangen door vaste
 * antwoorden; er gaat niets naar buiten.
 */

const finding = (tekst: string, soort = "feit", betrouwbaarheid = "hoog", bron = "Website", bronUrl = "https://voorbeeld.nl/over-ons") => ({ tekst, soort, betrouwbaarheid, bron, bronUrl });

const RAW_DOSSIER = {
  modules: {
    bedrijfsprofiel: { conclusie: "Regionale kozijnenfabrikant met eigen productie.", bevindingen: [finding("Produceert kunststof kozijnen in eigen fabriek."), finding("Richt zich vermoedelijk vooral op renovatie.", "aanname", "laag", "", "")], ontbreekt: ["Aantal medewerkers is niet openbaar"] },
    doelgroep: { conclusie: "Particuliere woningeigenaren.", bevindingen: [finding("De site spreekt particulieren aan met een offerteformulier.")], ontbreekt: [] },
    social: { conclusie: "Actief op Instagram.", bevindingen: [finding("Plaatst ongeveer twee keer per week.", "berekening", "middel", "Instagram", "https://instagram.com/voorbeeld")], ontbreekt: ["TikTok niet gevonden"] },
    contentanalyse: { conclusie: "Vooral projectfoto's.", bevindingen: [finding("Video's tonen montage op locatie.")], ontbreekt: [] },
    marketing_software: { conclusie: "Website op WordPress.", bevindingen: [finding("De site draait op WordPress.")], ontbreekt: ["CRM niet zichtbaar"] },
    concurrenten: { conclusie: "Twee regionale concurrenten.", bevindingen: [finding("Concurrent A plaatst wekelijks video.")], ontbreekt: [] },
    reviews: { conclusie: "Positieve reviews over service.", bevindingen: [finding("Klanten noemen de nette afwerking.", "feit", "hoog", "Google", "https://google.com/maps/x")], ontbreekt: [] },
  },
  kanalen: [
    { platform: "Instagram", gevonden: "ja", url: "https://instagram.com/voorbeeld", volgers: "1.250", frequentie: "twee keer per week", opmerking: "" },
    { platform: "TikTok", gevonden: "nee", url: "", volgers: "12K", frequentie: "", opmerking: "Niet gevonden" },
  ],
  concurrenten: [
    { naam: "Concurrent A", url: "https://concurrent-a.nl", instagram: "@a", tiktok: "", youtube: "", aanpak: "Wekelijks montagevideo's.", watWerkt: "Voor en na.", kansVoorKlant: "Uitleg over prijzen ontbreekt." },
    { naam: "Bekende Concurrent", url: "", instagram: "", tiktok: "", youtube: "", aanpak: "Weinig actief.", watWerkt: "", kansVoorKlant: "" },
  ],
  software: [
    { categorie: "Website", naam: "WordPress", status: "zichtbaar", bewijs: "Zichtbaar in de broncode" },
    { categorie: "CRM", naam: "HubSpot", status: "zichtbaar", bewijs: "" },
  ],
  wijzigingen: [] as string[],
  bronnen: [{ label: "Over ons", url: "https://voorbeeld.nl/over-ons" }, { label: "Dubbel", url: "https://voorbeeld.nl/over-ons" }, { label: "Kapot", url: "javascript:alert(1)" }],
};

const RAW_STRATEGY = {
  kansen: { conclusie: "Vertrouwen opbouwen met uitleg.", bevindingen: [finding("Maak video's over prijsopbouw.", "feit", "hoog", "Dossier", "")], ontbreekt: [] },
  strategieModule: { conclusie: "Start met uitleg en projecten.", bevindingen: [finding("Test een vaste serie vanuit de fabriek.", "aanbeveling", "middel", "Dossier", "")], ontbreekt: [] },
  strategie: {
    pijlers: [{ naam: "Uitleg", waarom: "Veel vragen over prijs." }],
    formats: [{ naam: "Fabrieksrondleiding", waarom: "Eigen productie is onderscheidend." }],
    hooks: ["Dit kost een kozijn echt."],
    scriptideeen: [{ titel: "Prijsopbouw", hook: "Dit kost een kozijn echt.", kern: "Leg de opbouw uit." }],
    opnames: ["In de fabriek"],
    verbeterpunten: ["Meer video dan foto"],
  },
  topInzichten: ["Eigen productie is het sterkste verhaal."],
  topKansen: ["Leg prijzen uit in korte video's."],
};

describe("Klantonderzoek: rekenregels", () => {
  it("neemt alleen exacte openbare cijfers over", () => {
    expect(wholeNumber("1.250")).toBe(1250);
    expect(wholeNumber("12400")).toBe(12400);
    expect(wholeNumber("12K")).toBeNull();
    expect(wholeNumber("ca. 12.000")).toBeNull();
    expect(wholeNumber("")).toBeNull();
    expect(wholeNumber(-3)).toBeNull();
  });

  it("maakt een geldig dossier en verzint niets bij", () => {
    const d = normalizeDossier(RAW_DOSSIER);
    expect(d.modules.bedrijfsprofiel.bevindingen).toHaveLength(2);
    expect(d.modules.bedrijfsprofiel.bevindingen[0]!.id).toBe("bedrijfsprofiel-1");
    // Modules die het onderzoek niet aanleverde bestaan, maar zijn leeg.
    expect(d.modules.kansen.bevindingen).toHaveLength(0);
    expect(d.modules.strategie.conclusie).toBe("");
    // Niet gevonden kanaal krijgt geen volgers; afronding "12K" is geen meting.
    const tiktok = d.kanalen.find((k) => k.platform === "tiktok")!;
    expect(tiktok.gevonden).toBe(false);
    expect(tiktok.volgers).toBeNull();
    expect(d.kanalen.find((k) => k.platform === "instagram")!.volgers).toBe(1250);
    // Software zonder bewijs is nooit "zichtbaar".
    expect(d.software.find((x) => x.categorie === "CRM")!.status).toBe("onbekend");
    expect(d.software.find((x) => x.categorie === "Website")!.status).toBe("zichtbaar");
  });

  it("laat een feit zonder bron nooit op betrouwbaarheid hoog staan", () => {
    const d = normalizeDossier({ modules: { doelgroep: { conclusie: "", bevindingen: [finding("Zonder bron.", "feit", "hoog", "", "")], ontbreekt: [] } } });
    expect(d.modules.doelgroep.bevindingen[0]!.betrouwbaarheid).toBe("middel");
  });

  it("behandelt kansen en strategie altijd als advies, nooit als feit", () => {
    const d = normalizeDossier({ modules: { kansen: RAW_STRATEGY.kansen } });
    expect(d.modules.kansen.bevindingen[0]!.soort).toBe("aanbeveling");
  });

  it("haalt gedachtestreepjes uit teksten", () => {
    const d = normalizeDossier({ topInzichten: ["Sterk merk — weinig video"] });
    expect(d.topInzichten[0]).toBe("Sterk merk, weinig video");
  });

  it("ontdubbelt bronnen en weigert onveilige links", () => {
    const s = normalizeSources(RAW_DOSSIER.bronnen);
    expect(s).toHaveLength(1);
    expect(s[0]!.url).toBe("https://voorbeeld.nl/over-ons");
  });

  it("past correcties toe zonder het dossier te wijzigen", () => {
    const d = normalizeDossier(RAW_DOSSIER);
    const list = d.modules.bedrijfsprofiel.bevindingen;
    const out = applyCorrections(list, {
      "bedrijfsprofiel-1": { tekst: "Produceert kunststof en aluminium kozijnen.", door: "Milou", op: "2026-11-15" },
      "bedrijfsprofiel-2": { verborgen: true, door: "Milou", op: "2026-11-15" },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.tekst).toBe("Produceert kunststof en aluminium kozijnen.");
    expect(out[0]!.origineel).toBe("Produceert kunststof kozijnen in eigen fabriek.");
    expect(list[0]!.tekst).toBe("Produceert kunststof kozijnen in eigen fabriek.");
  });

  it("vergelijkt alleen cijfers van dezelfde herkomst", () => {
    const row = (herkomst: BaselineRow["herkomst"], value: number, platform = "instagram"): BaselineRow => ({ id: `${herkomst}-${platform}`, platform, metric: "volgers", value, herkomst, bron: "x", gemetenOp: "2026-11-15" });
    const changes = compareBaselines([row("openbaar", 1000), row("handmatig", 5000, "tiktok")], [row("openbaar", 1150), row("gekoppeld", 1200), row("openbaar", 300, "tiktok")]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ was: 1000, nu: 1150, verschil: 150, pct: 15 });
  });

  it("geeft geen percentage bij een startwaarde van nul", () => {
    const a: BaselineRow = { id: "a", platform: "tiktok", metric: "weergaven_30d", value: 0, herkomst: "gekoppeld", bron: "Metricool", gemetenOp: "2026-11-15" };
    expect(compareBaselines([a], [{ ...a, value: 400 }])[0]!.pct).toBeNull();
  });

  it("plant de hercontrole 90 dagen na goedkeuring", () => {
    expect(nextCheckDate("2026-11-15")).toBe("2027-02-13");
  });

  it("zet aannames niet door naar de klantkennis", () => {
    const d = normalizeDossier(RAW_DOSSIER);
    const k = knowledgeFromDossier(d, {}, [{ id: "1", module: "doelgroep", tekst: "Beslisser is de eigenaar.", door: "Milou", op: "2026-11-15" }]);
    const profiel = k.find((x) => x.title.startsWith("Bedrijfsprofiel"))!;
    expect(profiel.body).toContain("eigen fabriek");
    expect(profiel.body).not.toContain("vermoedelijk");
    expect(k.find((x) => x.category === "audience")!.body).toContain("Beslisser is de eigenaar.");
    expect(k.find((x) => x.category === "competitor")!.body).toContain("Concurrent A");
  });

  it("benoemt wat het team nog kan aanleveren", () => {
    const d = normalizeDossier(RAW_DOSSIER);
    const m = missingInfo({ website: null, kanalen: [], briefingVelden: 0, gekoppeldeCijfers: false, contactpersoon: true }, d, []);
    expect(m.some((x) => x.includes("Website"))).toBe(true);
    expect(m.some((x) => x.includes("Klantbriefing"))).toBe(true);
    expect(m.some((x) => x.includes("nog te bevestigen"))).toBe(true);
    expect(m.some((x) => x.includes("Nulmeting"))).toBe(true);
  });

  it("hervat op de juiste fase", () => {
    expect(resumePhase("wacht_social")).toBe("social");
    expect(resumePhase("dossier")).toBe("dossier");
    expect(resumePhase("iets_onbekends")).toBe("intern");
  });
});

/* ------------------------------ Hele keten ------------------------------ */

const ai = { research: 0, structured: 0, failNext: null as string | null, volgers: "1.250", wijzigingen: [] as string[] };

vi.mock("@/server/ai/client", () => ({
  aiConfigured: () => true,
  aiModel: () => "test",
  aiModelStrong: () => "test-strong",
  runResearch: async () => {
    ai.research++;
    if (ai.failNext) {
      const error = ai.failNext;
      ai.failNext = null;
      return { ok: false, reason: "error", error };
    }
    return { ok: true, model: "test", text: "BRIEFING. ".repeat(40) };
  },
  runStructured: async (input: { schema: { properties: Record<string, unknown> } }) => {
    ai.structured++;
    if ("kanalen" in input.schema.properties) {
      const data = structuredClone(RAW_DOSSIER);
      data.kanalen[0]!.volgers = ai.volgers;
      data.wijzigingen = ai.wijzigingen;
      return { ok: true, model: "test", data };
    }
    return { ok: true, model: "test", data: RAW_STRATEGY };
  },
  runJsonPrompt: async () => ({ ok: false, reason: "error", error: "niet verwacht" }),
  runPrompt: async () => ({ ok: true, text: "", model: "test" }),
}));

type Db = Awaited<ReturnType<typeof freshDatabase>>;
type Schema = typeof import("@/db/schema");
let db: Db;
let s: Schema;
const id: Record<string, string> = {};

async function runToEnd(runId: string) {
  const { runClientResearchJob } = await import("@/server/client-research/run");
  let last = { ok: false } as Awaited<ReturnType<typeof runClientResearchJob>>;
  for (let i = 0; i < 8; i++) {
    last = await runClientResearchJob(runId, { budgetMs: 30 * 60_000 });
    if (last.phase === "klaar" || last.reason === "not_running") break;
  }
  return last;
}

const getRun = async (runId: string) => (await db.select().from(s.clientResearchRuns).where(eq(s.clientResearchRuns.id, runId)))[0]!;

beforeAll(async () => {
  db = await freshDatabase();
  s = await import("@/db/schema");
  const users = await db.insert(s.users).values([
    { email: "jarno@test.nl", fullName: "Jarno", primaryRole: "owner", status: "active" },
    { email: "milou@test.nl", fullName: "Milou", primaryRole: "operational_manager", status: "active" },
  ]).returning({ id: s.users.id, email: s.users.email });
  for (const u of users) id[u.email.split("@")[0]!] = u.id;

  const old = new Date(Date.now() - 200 * 24 * 3600_000);
  const [bestaand] = await db.insert(s.clients).values({ slug: "kozijnen", name: "Kozijnen BV", website: "https://voorbeeld.nl", status: "active", coordinatorId: id.milou!, createdAt: old }).returning({ id: s.clients.id });
  id.client = bestaand!.id;
  await db.insert(s.socialAccounts).values({ clientId: id.client!, platform: "instagram", handle: "@voorbeeld", profileUrl: "https://instagram.com/voorbeeld" });
  await db.insert(s.clientKnowledge).values([
    { clientId: id.client!, category: "goal", title: "Doelstellingen", body: "Meer aanvragen uit de regio.", source: "onboarding" },
    { clientId: id.client!, category: "tone_of_voice", title: "Eigen notitie", body: "Nuchter en direct.", source: "manual" },
  ]);
  await db.insert(s.contentCompetitors).values({ clientId: id.client!, naam: "bekende concurrent", bron: "team", actief: false });
  const today = new Date().toISOString().slice(0, 10);
  await db.insert(s.dailyMetrics).values({ clientId: id.client!, platform: "instagram", measuredOn: today, views: 900, reach: 600, engagements: 40, followers: 1300, postsPublished: 2, source: "metricool" });
}, 240_000);

afterAll(async () => {
  await closeDatabase();
});

describe("Klantonderzoek: van start tot hercontrole", () => {
  let runId = "";

  it("draait het onderzoek en zet het klaar voor controle", async () => {
    const { startClientResearch } = await import("@/server/client-research/run");
    runId = await startClientResearch(id.client!, id.jarno!);
    const res = await runToEnd(runId);
    expect(res.phase).toBe("klaar");

    const run = await getRun(runId);
    expect(run.kind).toBe("nulmeting");
    expect(run.status).toBe("controle");
    expect(ai.research).toBe(2);
    expect(ai.structured).toBe(2);
    const dossier = run.dossier as import("@/lib/client-research").Dossier;
    expect(dossier.modules.kansen.bevindingen.length).toBeGreaterThan(0);
    expect(dossier.topKansen).toHaveLength(1);
    // De klantbriefing uit het kennismakingsgesprek is als invoer gebruikt.
    expect((run.internal as { briefing: unknown[] }).briefing).toHaveLength(1);
  });

  it("legt de nulmeting vast met de herkomst per cijfer", async () => {
    const baseline = (await getRun(runId)).baseline as BaselineRow[];
    const openbaar = baseline.find((b) => b.herkomst === "openbaar" && b.metric === "volgers")!;
    const gekoppeld = baseline.find((b) => b.herkomst === "gekoppeld" && b.metric === "volgers")!;
    expect(openbaar.value).toBe(1250);
    expect(gekoppeld.value).toBe(1300);
    expect(gekoppeld.bron).toBe("Metricool");
    expect(baseline.some((b) => b.herkomst === "gekoppeld" && b.metric === "weergaven_30d" && b.value === 900)).toBe(true);
    // TikTok is niet gevonden: daar staat dus geen cijfer.
    expect(baseline.some((b) => b.platform === "tiktok")).toBe(false);
  });

  it("stuurt precies één melding naar de verantwoordelijke", async () => {
    const rows = await db.select().from(s.notifications).where(eq(s.notifications.type, "client_research.ready"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(id.milou);
    expect(rows[0]!.href).toBe("/clients/kozijnen?tab=onderzoek");
  });

  it("koppelt niets aan de klantkennis vóór goedkeuring", async () => {
    const rows = await db.select().from(s.clientKnowledge).where(and(eq(s.clientKnowledge.clientId, id.client!), eq(s.clientKnowledge.source, "klantonderzoek")));
    expect(rows).toHaveLength(0);
  });

  it("koppelt na goedkeuring aan klantkennis en concurrenten", async () => {
    await db.update(s.clientResearchRuns).set({ corrections: { "bedrijfsprofiel-1": { tekst: "Produceert kunststof en aluminium kozijnen.", door: "Milou", op: new Date().toISOString() } } }).where(eq(s.clientResearchRuns.id, runId));
    const { approveResearch } = await import("@/server/client-research/approve");
    const res = await approveResearch(runId, { id: id.milou! });
    expect(res.ok).toBe(true);

    const kennis = await db.select().from(s.clientKnowledge).where(and(eq(s.clientKnowledge.clientId, id.client!), isNull(s.clientKnowledge.deletedAt)));
    const uitOnderzoek = kennis.filter((k) => k.source === "klantonderzoek");
    expect(uitOnderzoek.length).toBeGreaterThanOrEqual(5);
    // De correctie van het team is wat doorgaat, niet de oorspronkelijke tekst.
    expect(uitOnderzoek.find((k) => k.title.startsWith("Bedrijfsprofiel"))!.body).toContain("aluminium");
    // Wat het team zelf vastlegde blijft staan.
    expect(kennis.some((k) => k.source === "manual" && k.title === "Eigen notitie")).toBe(true);
    expect(kennis.some((k) => k.source === "onboarding")).toBe(true);

    // Nieuwe concurrent komt erbij; een door het team uitgesloten concurrent niet opnieuw.
    const comp = await db.select().from(s.contentCompetitors).where(eq(s.contentCompetitors.clientId, id.client!));
    expect(comp.filter((c) => c.naam === "Concurrent A")).toHaveLength(1);
    expect(comp.filter((c) => c.naam.toLowerCase() === "bekende concurrent")).toHaveLength(1);

    const run = await getRun(runId);
    expect(run.status).toBe("goedgekeurd");
    expect(run.approvedById).toBe(id.milou);
    expect(run.nextCheckOn).toBeTruthy();
    // Het dossier zelf is niet aangepast door de correctie.
    expect((run.dossier as import("@/lib/client-research").Dossier).modules.bedrijfsprofiel.bevindingen[0]!.tekst).toContain("in eigen fabriek");
  });

  it("weigert een tweede goedkeuring", async () => {
    const { approveResearch } = await import("@/server/client-research/approve");
    expect((await approveResearch(runId, { id: id.milou! })).ok).toBe(false);
  });

  it("werkt de klantkennis bij na een latere aanvulling", async () => {
    await db.update(s.clientResearchRuns).set({ additions: [{ id: "a1", module: "doelgroep", tekst: "Beslisser is meestal de eigenaar zelf.", door: "Milou", op: new Date().toISOString() }] }).where(eq(s.clientResearchRuns.id, runId));
    const { resyncApprovedKnowledge } = await import("@/server/client-research/approve");
    expect(await resyncApprovedKnowledge(runId, id.milou!)).toBe(true);
    const rows = await db.select().from(s.clientKnowledge).where(and(eq(s.clientKnowledge.clientId, id.client!), eq(s.clientKnowledge.source, "klantonderzoek"), isNull(s.clientKnowledge.deletedAt)));
    expect(rows.find((k) => k.category === "audience")!.body).toContain("eigenaar zelf");
    // Geen dubbele regels: elke titel komt één keer voor.
    expect(new Set(rows.map((r) => r.title)).size).toBe(rows.length);
  });

  it("start geen automatisch onderzoek voor bestaande klanten", async () => {
    const { runClientResearchAdvance } = await import("@/server/jobs/client-research");
    expect((await runClientResearchAdvance()).action).toBe("niets");
  });

  it("start na 90 dagen een hercontrole en bewaart de nulmeting", async () => {
    await db.update(s.clientResearchRuns).set({ nextCheckOn: "2020-01-01" }).where(eq(s.clientResearchRuns.id, runId));
    ai.volgers = "1.400";
    ai.wijzigingen = ["Plaatst nu ook op TikTok."];
    const { runClientResearchAdvance } = await import("@/server/jobs/client-research");
    const first = await runClientResearchAdvance();
    expect(first.action).toBe("hercontrole gestart");

    const runs = await db.select().from(s.clientResearchRuns).where(eq(s.clientResearchRuns.clientId, id.client!));
    const her = runs.find((r) => r.kind === "hercontrole")!;
    await runToEnd(her.id);
    const done = await getRun(her.id);
    expect(done.status).toBe("controle");
    expect(done.triggeredById).toBeNull();
    const changes = done.changes as { cijfers: { herkomst: string; was: number; nu: number }[]; inhoud: string[] };
    expect(changes.inhoud).toEqual(["Plaatst nu ook op TikTok."]);
    expect(changes.cijfers.find((c) => c.herkomst === "openbaar")).toMatchObject({ was: 1250, nu: 1400 });

    // De nulmeting is onaangeroerd.
    const nul = await getRun(runId);
    expect(nul.kind).toBe("nulmeting");
    expect((nul.baseline as BaselineRow[]).find((b) => b.herkomst === "openbaar")!.value).toBe(1250);

    // Zolang de hercontrole op controle wacht, start er geen nieuwe.
    expect((await runClientResearchAdvance()).action).toBe("niets");
  });

  it("toont de hercontrole met de nulmeting ernaast", async () => {
    const { getClientResearchView } = await import("@/server/client-research/view");
    const view = await getClientResearchView(id.client!);
    expect(view.shown?.kind).toBe("hercontrole");
    expect(view.nulmetingId).toBe(runId);
    expect(view.history).toHaveLength(2);
    const older = await getClientResearchView(id.client!, runId);
    expect(older.shown?.id).toBe(runId);
    expect(older.shownIsLatest).toBe(false);
  });

  it("start automatisch een nulmeting voor een nieuwe klant", async () => {
    const [nieuw] = await db.insert(s.clients).values({ slug: "nieuwe-klant", name: "Nieuwe Klant", status: "onboarding" }).returning({ id: s.clients.id });
    const { runClientResearchAdvance } = await import("@/server/jobs/client-research");
    const res = await runClientResearchAdvance();
    expect(res.action).toBe("nulmeting gestart");
    expect(res.clientId).toBe(nieuw!.id);
    const [run] = await db.select().from(s.clientResearchRuns).where(eq(s.clientResearchRuns.clientId, nieuw!.id));
    await runToEnd(run!.id);
    const done = await getRun(run!.id);
    expect(done.status).toBe("controle");
    // Zonder verantwoordelijke gaat de melding naar de eigenaar.
    const note = await db.select().from(s.notifications).where(and(eq(s.notifications.type, "client_research.ready"), eq(s.notifications.entityId, run!.id)));
    expect(note.map((n) => n.userId)).toEqual([id.jarno]);
  });

  it("probeert een mislukte fase opnieuw en meldt een gestrand automatisch onderzoek", async () => {
    const [c] = await db.insert(s.clients).values({ slug: "pech", name: "Pech BV", status: "active", coordinatorId: id.milou! }).returning({ id: s.clients.id });
    const { startClientResearch, runClientResearchJob } = await import("@/server/client-research/run");
    const rid = await startClientResearch(c!.id, null);
    ai.failNext = "tijdelijke storing";
    const first = await runClientResearchJob(rid, { budgetMs: 30 * 60_000 });
    expect(first.ok).toBe(false);
    expect((await getRun(rid)).status).toBe("bezig");
    // Tweede poging slaagt en gaat verder waar hij was.
    expect((await runToEnd(rid)).phase).toBe("klaar");

    const rid2 = await startClientResearch(c!.id, null);
    ai.failNext = "Your credit balance is too low";
    await runClientResearchJob(rid2, { budgetMs: 30 * 60_000 });
    const failed = await getRun(rid2);
    expect(failed.status).toBe("mislukt");
    expect(failed.errorMessage).toContain("AI-tegoed");
    const notes = await db.select().from(s.notifications).where(and(eq(s.notifications.type, "client_research.failed"), eq(s.notifications.entityId, rid2)));
    expect(notes).toHaveLength(1);
  });
});
