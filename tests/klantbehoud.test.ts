import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import {
  attentionStates, clientFeedback, clients, contracts, dailyMetrics, leaveRequests, notifications,
  publications, reviewComments, reviewThreads, deliverables, socialMetrics, tasks, users,
} from "@/db/schema";
import { clientHealth, contractMoment, coverFor, evaluateResults, suggestFeedback, type DailyRow, type VideoRow } from "@/lib/client-retention";

/**
 * Klantbehoud-signalering, de acht situaties uit de opdracht, tegen een echte
 * testdatabase (PGlite). Er wordt niets naar buiten verstuurd: meldingen zijn
 * alleen rijen in de testdatabase, en alle klanten en medewerkers zijn testdata.
 */

// Ingelogde medewerker voor de server-acties (in tests is er geen sessie).
const session = { viewer: null as null | Record<string, unknown> };
vi.mock("@/server/auth/context", async (orig) => {
  const actual = await orig<typeof import("@/server/auth/context")>();
  return { ...actual, requireTeamMember: async () => session.viewer, requireInternal: async () => session.viewer };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;
const id: Record<string, string> = {};
const TODAY = new Date().toISOString().slice(0, 10);
const day = (n: number) => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function user(key: string, role: "owner" | "content_creator" | "videographer") {
  const [u] = await db.insert(users).values({ email: `${key}@shortclips.nl`, fullName: `${key[0].toUpperCase()}${key.slice(1)} Test`, status: "active", primaryRole: role }).returning({ id: users.id });
  id[key] = u!.id;
}
async function client(name: string, coordinator: string) {
  const [c] = await db.insert(clients).values({ slug: name.toLowerCase().replace(/\s+/g, "-"), name, status: "active", coordinatorId: id[coordinator] }).returning({ id: clients.id });
  return c!.id;
}

/** 60 dagen meetdata + video's. `drop` = hoeveel lager de laatste 30 dagen zijn (0.3 = 30%). */
async function seedResults(clientId: string, opts: { drop: number; videosPerWindow?: number; lastDay?: number; outlier?: boolean }) {
  const vpw = opts.videosPerWindow ?? 6;
  const lastDay = opts.lastDay ?? -1;
  const rowsD = [];
  for (let n = -60; n <= lastDay; n++) {
    const cur = n >= -30;
    const f = cur ? 1 - opts.drop : 1;
    rowsD.push({ clientId, platform: "instagram" as const, measuredOn: day(n), views: Math.round(1000 * f), reach: Math.round(800 * f), engagements: Math.round(40 * f), followerDelta: cur ? Math.round(3 * f) : 3, source: "metricool" });
  }
  await db.insert(dailyMetrics).values(rowsD);
  for (const [from, factor] of [[-58, 1], [-28, 1 - opts.drop]] as const) {
    for (let i = 0; i < vpw; i++) {
      const [p] = await db.insert(publications).values({ clientId, platform: "instagram", status: "published", publishedAt: new Date(`${day(from + i * 4)}T12:00:00Z`), externalPostId: `${clientId}-${from}-${i}`, caption: `Video ${from}-${i}` }).returning({ id: publications.id });
      // Optioneel één extreme uitschieter in de huidige periode (mag geen signaal geven).
      const views = opts.outlier && from === -28 && i === 0 ? 5 : Math.round(5000 * factor);
      await db.insert(socialMetrics).values({ publicationId: p!.id, clientId, platform: "instagram", measuredOn: day(lastDay), views, reach: views, source: "metricool" });
    }
  }
}

async function overview() {
  const { retentionContext, getRetentionOverview, retentionSignals, actedOnKeys, pendingFeedbackComments } = await import("@/server/client-retention");
  const ctx = await retentionContext(TODAY);
  const list = await getRetentionOverview(ctx);
  const signals = retentionSignals(list, ctx, await actedOnKeys(), await pendingFeedbackComments(list.map((c) => c.clientId)));
  return { ctx, list, signals };
}
const asViewer = (key: string) => {
  session.viewer = { id: id[key], email: `${key}@shortclips.nl`, fullName: `${key} Test`, primaryRole: key === "jarno" ? "owner" : "content_creator", permissions: new Set<string>(), clientScope: null, isPortalUser: false };
};
const resetData = async () => {
  for (const t of [notifications, attentionStates, tasks, clientFeedback, socialMetrics, publications, dailyMetrics, contracts, leaveRequests, reviewComments, reviewThreads, deliverables]) await db.delete(t);
  await db.delete(clients);
};

beforeAll(async () => {
  db = await freshDatabase();
  await user("jarno", "owner");
  await user("milou", "content_creator");
  await user("jiska", "content_creator");
  await user("rutger", "videographer");
});
afterAll(async () => { await closeDatabase(); });
beforeEach(async () => { await resetData(); });

/* ------------------------------------------------------------------ *
 * Regels (puur)
 * ------------------------------------------------------------------ */

describe("regels", () => {
  const daily = (drop: number, days = 60): DailyRow[] => Array.from({ length: days }, (_, i) => ({ platform: "instagram", measuredOn: day(-days + i), views: i >= days - 30 ? 1000 * (1 - drop) : 1000, reach: i >= days - 30 ? 800 * (1 - drop) : 800, engagements: 40, followerDelta: 2 }));
  const vids = (n: number, cur: number, prev: number): VideoRow[] => [
    ...Array.from({ length: n }, (_, i) => ({ platform: "instagram", publishedOn: day(-58 + i * 4), views: prev, title: `p${i}` })),
    ...Array.from({ length: n }, (_, i) => ({ platform: "instagram", publishedOn: day(-28 + i * 4), views: cur, title: `c${i}` })),
  ];

  it("daling onder de grens: geen signaal; boven de grens wel; grens is instelbaar", () => {
    expect(evaluateResults({ today: TODAY, daily: daily(0.2), videos: vids(6, 4000, 5000), hasIntegration: true }).state).toBe("ok");
    expect(evaluateResults({ today: TODAY, daily: daily(0.3), videos: vids(6, 3500, 5000), hasIntegration: true }).state).toBe("daling");
    expect(evaluateResults({ today: TODAY, daily: daily(0.2), videos: vids(6, 4000, 5000), hasIntegration: true, settings: { dropPct: 15 } }).state).toBe("daling");
  });
  it("veel meer video's geplaatst met stabiel totaal: geen signaal", () => {
    // Totale weergaven gelijk, maar 3x zoveel video's → per video veel lager.
    const r = evaluateResults({ today: TODAY, daily: daily(0), videos: [...vids(4, 5000, 5000).slice(0, 4), ...Array.from({ length: 12 }, (_, i) => ({ platform: "instagram", publishedOn: day(-29 + i * 2), views: 1600, title: `n${i}` }))], hasIntegration: true });
    expect(r.state).toBe("ok");
    expect(r.platforms[0].note).toMatch(/meer video's geplaatst/);
  });
  it("te weinig video's of meetdagen: geen oordeel", () => {
    const r = evaluateResults({ today: TODAY, daily: daily(0.5), videos: vids(2, 1000, 5000), hasIntegration: true });
    expect(r.state).toBe("onvoldoende_data");
    expect(r.summary).toContain("te weinig video's");
  });
  it("normale correctie wordt niet als klacht gezien, twijfel over samenwerking wel als ernstig", () => {
    expect(suggestFeedback("Kun je de ondertitel bij 0:12 aanpassen? Typfout in de naam.").kind).toBe("correctie");
    expect(suggestFeedback("Eerlijk gezegd valt de kwaliteit erg tegen").kind).toBe("aandacht");
    expect(suggestFeedback("Het beeld is onscherp en het geluid is slecht").category).toBe("techniek");
    expect(suggestFeedback("We twijfelen over de samenwerking na dit kwartaal").kind).toBe("ernstig");
    expect(suggestFeedback("De resultaten vallen tegen deze maand").category).toBe("resultaten");
  });
  it("opzegdeadline ligt vóór de einddatum en is leidend; onzekere gegevens worden benoemd", () => {
    const m = contractMoment({ startsOn: day(-300), endsOn: day(70), noticePeriodDays: 60, autoRenew: true, verified: false }, TODAY);
    expect(m.decisionDate).toBe(day(10));
    expect(m.decisionLabel).toBe("opzegdeadline");
    expect(m.stage).toBe(14);
    expect(m.issues).toContain("Contractgegevens nog niet gecontroleerd");
    expect(contractMoment(null, TODAY).issues).toEqual(["Geen actief contract vastgelegd"]);
  });
  it("contractmoment maakt een klant niet ontevreden", () => {
    const h = clientHealth({ results: { state: "ok", summary: "" }, openFeedback: [], dataIssues: [] });
    expect(h.status).toBe("gezond");
  });
  it("vervanging: Milou en Jiska vervangen elkaar, Jarno en Rutger door Milou", () => {
    expect(coverFor("milou", new Set(["milou"]))).toBe("jiska");
    expect(coverFor("jarno", new Set(["jarno"]))).toBe("milou");
    expect(coverFor("rutger", new Set(["rutger", "milou"]))).toBe("jiska");
  });
});

/* ------------------------------------------------------------------ *
 * De acht situaties
 * ------------------------------------------------------------------ */

describe("scenario's", () => {
  it("1. klant heeft 30% minder gemiddeld bereik → één gegroepeerd signaal + taak voor de verantwoordelijke", async () => {
    const c = await client("Test Bereik", "milou");
    await seedResults(c, { drop: 0.3 });
    const { signals } = await overview();
    const s = signals.filter((x) => x.id.startsWith(`retentie-resultaten-${c}`));
    expect(s).toHaveLength(1);
    expect(s[0].ownerId).toBe(id.milou);
    expect(s[0].reason).toMatch(/30% gedaald ten opzichte van de 30 dagen daarvoor/);
    expect(s[0].href).toBe("/analytics/test-bereik");
    expect(s[0].kids!.map((k) => k.label).join(" ")).toMatch(/bereik/);
    expect(s[0].dueOn > TODAY).toBe(true);

    const { runRetentionTasks } = await import("@/server/jobs/retention");
    await runRetentionTasks();
    await runRetentionTasks(); // tweede keer: geen dubbele taak
    const t = await db.select().from(tasks).where(like(tasks.dedupeKey, "retentie_resultaten:%"));
    expect(t).toHaveLength(1);
    expect(t[0].assigneeId).toBe(id.milou);
    // Geen melding: alleen een taak en een punt in de lijst.
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("1b. één slecht presterende video of te weinig video's geeft géén signaal", async () => {
    const a = await client("Test Uitschieter", "milou");
    await seedResults(a, { drop: 0, outlier: true });
    const b = await client("Test Weinig", "milou");
    await seedResults(b, { drop: 0.5, videosPerWindow: 2 });
    const { signals, list } = await overview();
    expect(signals.some((x) => x.id.startsWith("retentie-resultaten-"))).toBe(false);
    expect(list.find((x) => x.clientId === b)!.results.state).toBe("onvoldoende_data");
  });

  it("2. meerdere keren negatieve feedback op video's → herkend, geregistreerd, oplopende status", async () => {
    const c = await client("Test Feedback", "milou");
    // Een klantreactie in Frame.io die op ontevredenheid wijst, en een normale correctie.
    const [d] = await db.insert(deliverables).values({ clientId: c, title: "Video 1" }).returning({ id: deliverables.id });
    const [t1] = await db.insert(reviewThreads).values({ deliverableId: d!.id, visibility: "client" }).returning({ id: reviewThreads.id });
    await db.insert(reviewComments).values([
      { threadId: t1!.id, body: "Ondertitel bij 0:05 iets later laten beginnen", authorName: "Klant" },
      { threadId: t1!.id, body: "Dit valt echt tegen, weer dezelfde fout als vorige keer", authorName: "Klant" },
    ]);
    let { signals } = await overview();
    const checks = signals.filter((s) => s.id.startsWith("retentie-check-"));
    expect(checks).toHaveLength(1); // alleen de echte klacht, niet de ondertitel
    expect(checks[0].action).toMatch(/Beoordelen/);

    asViewer("milou");
    const { registerClientFeedback } = await import("@/server/actions/client-retention");
    for (const summary of ["Kwaliteit montage valt tegen", "Weer dezelfde fout in de montage"]) {
      const r = await registerClientFeedback({ clientId: c, source: "frame", kind: "aandacht", category: "kwaliteit", summary, followUp: "Editor briefen en nieuwe versie sturen" });
      expect(r.ok).toBe(true);
    }
    let res = await overview();
    const me = res.list.find((x) => x.clientId === c)!;
    expect(me.health.status).toBe("aandacht");
    expect(res.signals.filter((s) => s.id.startsWith("retentie-feedback-"))).toHaveLength(2);
    // Derde klacht → directe aandacht.
    await registerClientFeedback({ clientId: c, source: "whatsapp", kind: "aandacht", category: "kwaliteit", summary: "Klant vindt het niet professioneel", followUp: "Bellen en verbeterplan bespreken" });
    res = await overview();
    expect(res.list.find((x) => x.clientId === c)!.health.status).toBe("direct");
    // Een normale correctie laat zich niet registreren.
    const corr = await registerClientFeedback({ clientId: c, source: "frame", kind: "correctie", category: "overig", summary: "Ondertitel aanpassen", followUp: "Aanpassen" });
    expect(corr.ok).toBe(false);
    ({ signals } = res);
    expect(signals.every((s) => !s.id.startsWith("retentie-feedback-") || s.ownerId === id.milou)).toBe(true);
  });

  it("3. klant twijfelt over de samenwerking → direct één melding, directe aandacht, geen dubbele ochtendmelding", async () => {
    const c = await client("Test Twijfel", "jiska");
    asViewer("jiska");
    const { registerClientFeedback } = await import("@/server/actions/client-retention");
    const r = await registerClientFeedback({ clientId: c, source: "telefoon", kind: "ernstig", category: "samenwerking", summary: "Klant twijfelt over de samenwerking", followUp: "Evaluatiegesprek inplannen" });
    expect(r.ok).toBe(true);
    const n = await db.select().from(notifications);
    expect(n).toHaveLength(1);
    expect(n[0].userId).toBe(id.jiska);
    expect(n[0].type).toBe("retention_urgent");
    const { list, signals } = await overview();
    expect(list.find((x) => x.clientId === c)!.health.status).toBe("direct");
    const s = signals.find((x) => x.id === `retentie-feedback-${r.id}`)!;
    expect(s.priority).toBe("hoog");
    expect(s.detail).toMatch(/Beslissingshulp/);
    // De gewone meldingenronde ziet dat dit punt al gemeld is.
    const [st] = await db.select().from(attentionStates).where(eq(attentionStates.signalKey, `retentie-feedback-${r.id}`));
    expect(st.notifiedAt).not.toBeNull();
  });

  it("4. contract nadert het beslismoment → 60/30/14-dagen opvolging, opzegdeadline leidend", async () => {
    const c = await client("Test Contract", "milou");
    // Einde over 60 dagen, opzegtermijn 30 → beslismoment over 30 dagen.
    const [k] = await db.insert(contracts).values({ clientId: c, status: "active", startsOn: day(-300), endsOn: day(60), noticePeriodDays: 30, autoRenew: true, verifiedAt: new Date() }).returning({ id: contracts.id });
    const first = await overview();
    let signals = first.signals;
    const me = first.list.find((x) => x.clientId === c)!;
    expect(me.contract.stage).toBe(30);
    expect(me.health.status).toBe("gezond"); // commercieel ≠ ontevreden
    expect(me.commercial?.label).toMatch(/Opzegdeadline over 30 dagen/);
    const s30 = signals.find((s) => s.id.endsWith("-30"))!;
    expect(s30.ownerId).toBe(id.milou);
    expect(s30.action).toMatch(/Contact opnemen/);
    const { runRetentionTasks } = await import("@/server/jobs/retention");
    await runRetentionTasks();
    expect((await db.select().from(tasks).where(like(tasks.dedupeKey, "retentie_contract:%")))).toHaveLength(1);

    // 14 dagen ervoor zonder vastgelegde actie → hoog.
    await db.update(contracts).set({ endsOn: day(40) }).where(eq(contracts.id, k!.id));
    ({ signals } = await overview());
    const s14 = signals.find((s) => s.id.endsWith("-14"))!;
    expect(s14.priority).toBe("hoog");
    // Met een vastgelegde actie op het 30-dagenpunt: geen extra controle.
    const { contractSignalKey } = await import("@/server/client-retention");
    await db.insert(attentionStates).values({ signalKey: contractSignalKey(k!.id, day(10), 30), status: "bezig", notes: [{ at: new Date().toISOString(), userId: id.milou, name: "Milou", text: "Gebeld, evaluatie op dinsdag" }] });
    ({ signals } = await overview());
    expect(signals.some((s) => s.id.endsWith("-14"))).toBe(false);
    // Oude contracttaak (ander beslismoment) wordt opgeruimd, nieuwe komt ervoor in de plaats.
    await runRetentionTasks();
    const open = (await db.select().from(tasks).where(like(tasks.dedupeKey, "retentie_contract:%"))).filter((t) => !t.archivedAt);
    expect(open).toHaveLength(1);
    expect(open[0].dedupeKey).toContain(day(10));
  });

  it("4b. ongecontroleerde of ontbrekende contractgegevens → één controlepunt voor Jiska, geen aanname van verlenging", async () => {
    const a = await client("Test Geen Contract", "milou");
    const b = await client("Test Onzeker", "milou");
    await db.insert(contracts).values({ clientId: b, status: "active", startsOn: day(-200), endsOn: day(-5 + 30), noticePeriodDays: 30, autoRenew: true });
    const { signals, list } = await overview();
    const data = signals.filter((s) => s.id === "retentie-gegevens-contracten");
    expect(data).toHaveLength(1);
    expect(data[0].ownerId).toBe(id.jiska);
    expect(data[0].kids!.map((k) => k.label).sort()).toEqual(["Test Geen Contract", "Test Onzeker"]);
    expect(list.find((x) => x.clientId === a)!.contract.issues).toContain("Geen actief contract vastgelegd");
    // Ontbrekende contractgegevens maken een klant niet "ontevreden".
    expect(list.find((x) => x.clientId === a)!.health.status).toBe("gezond");
    // Gepasseerd beslismoment op onzekere gegevens: geen alarm bij de verantwoordelijke.
    expect(signals.some((s) => s.id.startsWith("retentie-contract-") && s.clientName === "Test Onzeker" && s.id.endsWith("voorbij"))).toBe(false);
  });

  it("5. medewerker afwezig terwijl er een belangrijke melding ontstaat → vervanger krijgt het, escalatie één keer", async () => {
    const a = await client("Test Afwezig Milou", "milou");
    const b = await client("Test Afwezig Jarno", "jarno");
    await db.insert(leaveRequests).values([
      { userId: id.milou, startOn: day(-1), endOn: day(5), status: "approved" },
      { userId: id.jarno, startOn: day(-1), endOn: day(5), status: "approved" },
    ]);
    asViewer("rutger");
    const { registerClientFeedback } = await import("@/server/actions/client-retention");
    const r = await registerClientFeedback({ clientId: a, source: "mail", kind: "ernstig", category: "samenwerking", summary: "Klant overweegt te stoppen", followUp: "Vandaag bellen" });
    await registerClientFeedback({ clientId: b, source: "mail", kind: "aandacht", category: "resultaten", summary: "Resultaten vallen tegen", followUp: "Resultaten doornemen" });
    const n = await db.select().from(notifications);
    // Melding naar Jiska (vervanger van Milou), niet naar Milou of het hele team.
    expect(n.map((x) => x.userId)).toEqual([id.jiska]);
    const { signals } = await overview();
    expect(signals.find((s) => s.clientName === "Test Afwezig Jarno")!.ownerId).toBe(id.jiska);
    // Jarno krijgt niets.
    expect(n.some((x) => x.userId === id.jarno)).toBe(false);

    // Na twee werkdagen nog niet opgepakt → escalatie, maar slechts één keer.
    await db.update(attentionStates).set({ createdAt: new Date(Date.now() - 4 * 864e5) }).where(eq(attentionStates.signalKey, `retentie-feedback-${r.id}`));
    await db.delete(leaveRequests);
    const { runRetentionEscalations } = await import("@/server/jobs/retention");
    const items = (await overview()).signals.map((s) => ({ key: s.id, clientName: s.clientName ?? null, action: s.action, reason: s.reason, priority: s.priority, ownerId: s.ownerId, status: "open" as const, since: new Date(Date.now() - 4 * 864e5).toISOString(), dueOn: s.dueOn })) as never;
    expect(await runRetentionEscalations(items)).toBe(1);
    expect(await runRetentionEscalations(items)).toBe(0);
    const esc = await db.select().from(notifications).where(eq(notifications.type, "retention_escalation"));
    expect(esc).toHaveLength(1);
    expect(esc[0].userId).toBe(id.jiska); // eigenaar is Milou → escalatie naar Jiska
  });

  it("6. eerder gemeld probleem is opgelost → punt verdwijnt, status weer gezond, afronden vraagt een vastgelegde actie", async () => {
    const c = await client("Test Opgelost", "milou");
    asViewer("milou");
    const { registerClientFeedback, resolveClientFeedback } = await import("@/server/actions/client-retention");
    const { setAttentionStatus, addAttentionNote } = await import("@/server/actions/attention");
    const r1 = await registerClientFeedback({ clientId: c, source: "portaal", kind: "aandacht", category: "kwaliteit", summary: "Montage te rommelig", followUp: "Editor bijsturen" });
    const r2 = await registerClientFeedback({ clientId: c, source: "portaal", kind: "aandacht", category: "communicatie", summary: "Geen reactie op mail", followUp: "Terugbellen" });
    // Afronden zonder notitie wordt geweigerd.
    const k1 = `retentie-feedback-${r1.id}`;
    expect((await setAttentionStatus({ key: k1, status: "klaar" })).ok).toBe(false);
    await addAttentionNote({ key: k1, text: "Editor gebriefd, nieuwe versie goedgekeurd door klant" });
    expect((await setAttentionStatus({ key: k1, status: "klaar" })).ok).toBe(true);
    const [f1] = await db.select().from(clientFeedback).where(eq(clientFeedback.id, r1.id!));
    expect(f1.status).toBe("opgelost");
    expect(f1.resolution).toMatch(/Editor gebriefd/);
    // Tweede via de klantpagina.
    expect((await resolveClientFeedback({ id: r2.id!, resolution: "Teruggebeld, excuses gemaakt" })).ok).toBe(true);
    const { list, signals } = await overview();
    expect(signals.some((s) => s.id.startsWith("retentie-feedback-"))).toBe(false);
    expect(list.find((x) => x.clientId === c)!.health.status).not.toBe("direct");
    expect(list.find((x) => x.clientId === c)!.openFeedback).toHaveLength(0);
  });

  it("7. resultatenkoppeling levert tijdelijk geen gegevens → geen valse daling, wel één controlepunt", async () => {
    const a = await client("Test Stil A", "milou");
    const b = await client("Test Stil B", "jiska");
    await seedResults(a, { drop: 0.6, lastDay: -9 });
    await seedResults(b, { drop: 0, lastDay: -9 });
    const { signals, list } = await overview();
    expect(signals.some((s) => s.id.startsWith("retentie-resultaten-"))).toBe(false);
    const data = signals.filter((s) => s.id.startsWith("retentie-gegevens-resultaten-"));
    expect(data).toHaveLength(1);
    expect(data[0].kids).toHaveLength(2);
    expect(data[0].ownerId).toBe(id.jiska);
    const ha = list.find((x) => x.clientId === a)!.health;
    expect(ha.status).toBe("aandacht");
    expect(ha.reasons.join(" ")).toMatch(/dagen oud/);
  });

  it("8. meerdere signalen tegelijk bij dezelfde klant → één punt per soort, juiste mensen, geen dubbele meldingen", async () => {
    const c = await client("Test Alles", "milou");
    await seedResults(c, { drop: 0.35 });
    await db.insert(contracts).values({ clientId: c, status: "active", startsOn: day(-300), endsOn: day(55), noticePeriodDays: 30, autoRenew: false, verifiedAt: new Date() });
    asViewer("milou");
    const { registerClientFeedback } = await import("@/server/actions/client-retention");
    await registerClientFeedback({ clientId: c, source: "frame", kind: "aandacht", category: "techniek", summary: "Geluid is slecht in de laatste video's", followUp: "Opnameset controleren" });
    const { signals, list } = await overview();
    const mine = signals.filter((s) => s.clientName === "Test Alles");
    const kinds = mine.map((s) => s.category).sort();
    expect(kinds).toEqual(["Contractmoment", "Klant ontevreden", "Resultaten lopen terug"]);
    // Techniek-klacht naar Rutger, de rest naar de verantwoordelijke.
    expect(mine.find((s) => s.category === "Klant ontevreden")!.ownerId).toBe(id.rutger);
    expect(mine.find((s) => s.category === "Resultaten lopen terug")!.ownerId).toBe(id.milou);
    expect(mine.find((s) => s.category === "Contractmoment")!.ownerId).toBe(id.milou);
    // Daling + klacht = directe aandacht; contract staat er apart naast.
    const me = list.find((x) => x.clientId === c)!;
    expect(me.health.status).toBe("direct");
    expect(me.commercial).not.toBeNull();
    // Geen enkele directe melding: niets hiervan is een spoedgeval.
    expect(await db.select().from(notifications)).toHaveLength(0);
    // Taken: één voor resultaten, één voor het contract.
    const { runRetentionTasks } = await import("@/server/jobs/retention");
    await runRetentionTasks(); await runRetentionTasks();
    const t = await db.select({ k: tasks.dedupeKey }).from(tasks).where(and(eq(tasks.clientId, c), sql`${tasks.dedupeKey} like 'retentie_%'`));
    expect(t).toHaveLength(2);

    // Op de echte pagina Aandachtspunten: elk punt apart (niet samengevoegd), met deadline.
    const { viewerForUser } = await import("@/server/auth/context");
    const { getAttentionBoard } = await import("@/server/attention");
    const viewer = await viewerForUser(id.jarno);
    const board = await getAttentionBoard(viewer!, { trusted: true });
    const onBoard = board.items.filter((i) => i.clientName === "Test Alles");
    expect(onBoard.map((i) => i.key).every((k) => k.startsWith("retentie-"))).toBe(true);
    expect(onBoard).toHaveLength(3);
    expect(onBoard.every((i) => !!i.dueOn)).toBe(true);
    // Milou ziet bij "Mijn punten" alleen haar eigen twee.
    expect(onBoard.filter((i) => i.ownerId === id.milou)).toHaveLength(2);
  });
});
