import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { attentionStates, auditLogs, clients, contracts, users } from "@/db/schema";
import {
  addMonths, attentionList, buildRow, endDateFor, monthsBetween, periodValue, remainingLabel, stageFor, totalsFor,
  type ContractClient, type ContractPeriod,
} from "@/lib/contracts";

/**
 * Contracten & Verlengingen. Eerst de rekenregels (zonder database, vaste
 * datum), daarna de acties tegen een echte testdatabase (PGlite), inclusief
 * toegangscontrole. Alle klanten en medewerkers zijn testdata.
 */

/* ------------------------------------------------------------------ *
 * Rekenregels
 * ------------------------------------------------------------------ */

const T = "2026-11-08";
let seq = 0;
function period(p: Partial<ContractPeriod>): ContractPeriod {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, status: "active", startsOn: null, endsOn: null,
    durationMonths: null, monthlyValue: 0, videosPerMonth: null, autoRenew: false, noticePeriodDays: 0,
    renewalStatus: "open", clientConfirmed: false, reminderDays: null, endReason: null, reactivation: null, notes: null,
    verified: true, ownerManaged: true, previousContractId: null, createdAt: `2026-01-01T00:00:${String(seq % 60).padStart(2, "0")}.000Z`,
    ...p,
  };
}
function klant(name: string, periods: ContractPeriod[], extra: Partial<ContractClient> = {}): ContractClient {
  return { id: `c-${name}`, slug: name.toLowerCase(), name, logoUrl: null, color: null, status: "active", monthlyRevenue: 0, monthlyVideoQuota: 0, endedOn: null, periods, ...extra };
}

describe("datums en looptijd", () => {
  it("rekent einddatum en looptijd correct, ook rond maandeinde", () => {
    expect(endDateFor("2027-01-01", 3)).toBe("2027-03-31");
    expect(endDateFor("2027-01-01", 12)).toBe("2027-12-31");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(monthsBetween("2027-01-01", "2027-03-31")).toBe(3);
    expect(monthsBetween("2027-01-01", "2027-06-30")).toBe(6);
    expect(monthsBetween("2026-11-15", "2027-11-14")).toBe(12);
  });
  it("resterende tijd in dagen tot twee maanden, daarna in maanden", () => {
    expect(remainingLabel(14)).toBe("14 dagen");
    expect(remainingLabel(1)).toBe("1 dag");
    expect(remainingLabel(0)).toBe("Eindigt vandaag");
    expect(remainingLabel(120)).toBe("4 maanden");
    expect(remainingLabel(null)).toBe("Onbekend");
  });
});

describe("contractwaarde: oorspronkelijk, verstreken, resterend", () => {
  it("nieuwe klant met drie maanden: alles nog resterend", () => {
    const p = period({ startsOn: "2026-12-01", durationMonths: 3, endsOn: "2027-02-28", monthlyValue: 2760 });
    expect(periodValue(p, T)).toEqual({ total: 8280, elapsed: 0, remaining: 8280 });
  });
  it("jaarcontract halverwege: lopende maand telt als verstreken (vooraf gefactureerd)", () => {
    const p = period({ startsOn: "2026-06-01", durationMonths: 12, endsOn: "2027-05-31", monthlyValue: 2070 });
    // Termijnen gestart t/m 8 nov: jun t/m nov = 6. Resterend: dec t/m mei = 6.
    expect(periodValue(p, T)).toEqual({ total: 24840, elapsed: 12420, remaining: 12420 });
  });
  it("zonder startdatum: resterend teruggerekend vanaf de einddatum, totaal onbekend", () => {
    const p = period({ startsOn: null, endsOn: "2027-01-31", monthlyValue: 1800 });
    // Termijnen die na vandaag beginnen: dec, jan = 2.
    expect(periodValue(p, T)).toEqual({ total: null, elapsed: null, remaining: 3600 });
  });
  it("zonder einddatum: resterende waarde onbekend, niet gegokt", () => {
    const p = period({ startsOn: "2026-01-01", endsOn: null, monthlyValue: 2000 });
    expect(periodValue(p, T).remaining).toBeNull();
  });
});

describe("statussen, verlengingen en meldingen", () => {
  it("nieuwe klant met drie maanden: actief, nog geen melding", () => {
    const r = buildRow(klant("Nieuw", [period({ startsOn: "2026-11-01", durationMonths: 3, endsOn: "2027-01-31", monthlyValue: 2760, videosPerMonth: 8 })]), T);
    expect(r.active).toBe(true);
    expect(r.status).toBe("actief");
    expect(r.months).toBe(3);
    expect(r.videosPerMonth).toBe(8);
    expect(r.attention).toBeNull(); // 84 dagen tot einde, buiten 60
  });

  it("jaarcontract: meldingen per fase 60, 30, 14 en 7 dagen", () => {
    const at = (days: number) => {
      const end = new Date(`${T}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + days);
      const e = end.toISOString().slice(0, 10);
      return buildRow(klant("Jaar", [period({ startsOn: "2026-01-01", endsOn: e, monthlyValue: 2070 })]), T).attention;
    };
    expect(at(90)).toBeNull();
    expect(at(60)?.stage).toBe(60);
    expect(at(45)?.stage).toBe(60);
    expect(at(30)?.stage).toBe(30);
    expect(at(14)?.stage).toBe(14);
    expect(at(14)?.tone).toBe("urgent");
    expect(at(7)?.stage).toBe(7);
    expect(at(7)?.tone).toBe("kritiek");
    expect(at(-3)?.stage).toBe("verlopen");
  });

  it("opzegtermijn eerder dan einddatum: de melding komt op het beslismoment", () => {
    // Einde over 50 dagen, opzegtermijn 30 → opzeggen kan nog 20 dagen → fase 30.
    const r = buildRow(klant("Opzeg", [period({ startsOn: "2026-01-01", endsOn: "2026-12-28", noticePeriodDays: 30, monthlyValue: 2000 })]), T);
    expect(r.decisionDate).toBe("2026-11-28");
    expect(r.attention?.stage).toBe(30);
    expect(r.attention?.detail).toContain("opzeggen kan tot 28 november 2026");
    // Opzegtermijn al verstreken, contract loopt nog.
    const late = buildRow(klant("Laat", [period({ startsOn: "2026-01-01", endsOn: "2026-11-30", noticePeriodDays: 30, monthlyValue: 2000 })]), T);
    expect(late.attention?.stage).toBe("opzegtermijn_voorbij");
  });

  it("ongecontroleerde opzegtermijn (standaardwaarde) telt niet mee: einddatum is leidend", () => {
    const r = buildRow(klant("Onzeker", [period({ verified: false, startsOn: null, endsOn: "2026-11-30", noticePeriodDays: 30, monthlyValue: 2000 })]), T);
    expect(r.decisionDate).toBe("2026-11-30");
    expect(r.attention?.stage).toBe(30);
    expect(r.attention?.detail).toContain("nog niet gecontroleerd");
  });

  it("eigen herinneringsmomenten per klant", () => {
    expect(stageFor(40, [90, 45, 10])).toBe(45);
    const r = buildRow(klant("Eigen", [period({ startsOn: "2026-01-01", endsOn: "2027-01-20", reminderDays: [90, 45], monthlyValue: 1000 })]), T);
    expect(r.attention?.stage).toBe(90);
  });

  it("tussentijds verlengd: geen waarschuwing meer over de oude einddatum", () => {
    const oud = period({ status: "expired", startsOn: "2026-01-01", endsOn: "2026-11-30", monthlyValue: 2000, renewalStatus: "verlengd" });
    const nieuw = period({ startsOn: "2026-12-01", durationMonths: 6, endsOn: "2027-05-31", monthlyValue: 2000, previousContractId: oud.id });
    const r = buildRow(klant("Verlengd", [oud, nieuw]), T);
    expect(r.renewed).toBe(true);
    expect(r.status).toBe("verlengd");
    expect(r.current?.id).toBe(oud.id);
    expect(r.endsOn).toBe("2027-05-31");
    expect(r.attention).toBeNull();
    // Lopende waarde: rest oude periode (0, november al gefactureerd) + 6 maanden nieuw.
    expect(r.remainingCommitted).toBe(12000);
  });

  it("maandbedrag verandert: huidige maand oud bedrag, historie blijft compleet", () => {
    const oud = period({ status: "expired", startsOn: "2026-05-01", endsOn: "2026-10-31", durationMonths: 6, monthlyValue: 2070, renewalStatus: "verlengd" });
    const nieuw = period({ startsOn: "2026-11-01", durationMonths: 6, endsOn: "2027-04-30", monthlyValue: 2760 });
    const r = buildRow(klant("Prijs", [oud, nieuw]), T);
    expect(r.monthly).toBe(2760);
    expect(r.historicTotal).toBe(6 * 2070 + 6 * 2760);
    expect(r.historicComplete).toBe(true);
  });

  it("klant die stopt: blijft actief tot de einddatum, daarna niet actief en niet in de omzet", () => {
    const loopt = buildRow(klant("Stopt", [period({ startsOn: "2026-06-01", endsOn: "2026-11-30", monthlyValue: 1500, renewalStatus: "beeindigd", endReason: "Interne creator" })]), T);
    expect(loopt.active).toBe(true);
    expect(loopt.status).toBe("stopt");
    expect(loopt.attention).toBeNull();
    expect(loopt.countsInRevenue).toBe(true);

    const weg = buildRow(klant("Weg", [period({ startsOn: "2026-01-01", endsOn: "2026-10-31", monthlyValue: 1500, renewalStatus: "beeindigd" })]), T);
    expect(weg.active).toBe(false);
    expect(weg.status).toBe("beeindigd");
    const gestopt = buildRow(klant("Gestopt", [period({ startsOn: "2026-01-01", endsOn: "2026-06-30", monthlyValue: 900 })], { status: "churned" }), T);
    const totals = totalsFor([loopt, weg, gestopt], T);
    expect(totals.activeClients).toBe(1);
    expect(totals.monthlyRevenue).toBe(1500);
  });

  it("automatische verlenging: niet meegeteld na de einddatum, wel signaal als niets is vastgelegd", () => {
    const r = buildRow(klant("Auto", [period({ startsOn: "2026-02-01", endsOn: "2026-10-31", autoRenew: true, monthlyValue: 1200 })]), T);
    expect(r.status).toBe("verlopen");
    expect(r.attention?.stage).toBe("verlopen");
    expect(r.attention?.detail).toContain("automatische verlenging nog niet vastgelegd");
    expect(r.remainingCommitted).toBe(0);
  });

  it("totalen: maandomzet, lopende waarde, verstreken deel en binnenkort aflopend", () => {
    const rows = [
      buildRow(klant("A", [period({ startsOn: "2026-12-01", durationMonths: 3, endsOn: "2027-02-28", monthlyValue: 2760 })]), T),
      buildRow(klant("B", [period({ startsOn: "2026-06-01", durationMonths: 12, endsOn: "2027-05-31", monthlyValue: 2070 })]), T),
      buildRow(klant("C", [period({ startsOn: "2026-06-01", durationMonths: 6, endsOn: "2026-11-30", monthlyValue: 2760 })]), T),
      buildRow(klant("D", [period({ startsOn: "2026-01-01", endsOn: null, monthlyValue: 1000 })]), T),
      buildRow(klant("P", [period({ startsOn: "2026-01-01", endsOn: "2027-01-31", monthlyValue: 2000 })], { status: "paused" }), T),
    ];
    const t = totalsFor(rows, T);
    expect(t.activeClients).toBe(5);
    // A begint pas in december: telt nog niet in de huidige maandomzet. Gepauzeerd telt niet.
    expect(t.monthlyRevenue).toBe(2070 + 2760 + 1000);
    expect(t.remainingValue).toBe(8280 + 12420 + 0);
    expect(t.remainingUnknown).toBe(1);
    expect(t.expiringSoon).toBe(1); // alleen C
    expect(t.originalValue).toBe(24840 + 16560);
    expect(t.elapsedValue).toBe(12420 + 16560);
  });

  it("afgehandelde fase verdwijnt, de volgende fase komt terug", () => {
    const mk = (end: string) => buildRow(klant("Fase", [period({ id: "11111111-1111-4111-8111-111111111111", startsOn: "2026-01-01", endsOn: end, monthlyValue: 1000 })]), T);
    const r60 = mk("2026-12-28"); // 50 dagen → fase 60
    const handled = new Set([r60.attention!.key]);
    expect(attentionList([r60], handled)).toHaveLength(0);
    const r30 = mk("2026-12-01"); // 23 dagen → fase 30, andere sleutel
    expect(attentionList([r30], handled)).toHaveLength(1);
  });

  it("verzint geen gegevens: ontbrekende start, einde en looptijd worden benoemd", () => {
    const r = buildRow(klant("Leeg", [period({ verified: false, startsOn: null, endsOn: null, monthlyValue: 2300 })]), T);
    expect(r.issues).toEqual(["Nog niet gecontroleerd", "Startdatum onbekend", "Einddatum onbekend", "Looptijd onbekend"]);
    expect(r.months).toBeNull();
    expect(r.value.total).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Acties en toegang (testdatabase)
 * ------------------------------------------------------------------ */

const session = { viewer: null as null | Record<string, unknown> };
vi.mock("@/server/auth/context", async (orig) => {
  const actual = await orig<typeof import("@/server/auth/context")>();
  return {
    ...actual,
    requireTeamMember: async () => session.viewer,
    requireInternal: async () => session.viewer,
    requireOwner: async () => {
      if (!actual.isOwner(session.viewer as never)) throw new actual.ForbiddenError("Dit onderdeel is alleen toegankelijk voor de eigenaar.");
      return session.viewer;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/server/audit", () => ({ auditLog: async () => {} }));

type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;
const id: Record<string, string> = {};
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
const day = (n: number) => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const asViewer = (key: string) => {
  session.viewer = { id: id[key], email: `${key}@shortclips.nl`, fullName: `${key} Test`, primaryRole: key === "jarno" ? "owner" : "content_creator", permissions: new Set<string>(), clientScope: null, isPortalUser: false };
};

async function newClient(name: string, extra: Partial<typeof clients.$inferInsert> = {}) {
  const [c] = await db.insert(clients).values({ slug: name.toLowerCase().replace(/\s+/g, "-"), name, status: "active", monthlyRevenue: "2000", monthlyVideoQuota: 6, ...extra }).returning({ id: clients.id });
  return c!.id;
}

describe("acties en toegangscontrole", () => {
  beforeAll(async () => {
    db = await freshDatabase();
    for (const [k, role] of [["jarno", "owner"], ["milou", "content_creator"]] as const) {
      const [u] = await db.insert(users).values({ email: `${k}@shortclips.nl`, fullName: `${k} Test`, status: "active", primaryRole: role }).returning({ id: users.id });
      id[k] = u!.id;
    }
  });
  beforeEach(async () => {
    for (const t of [attentionStates, contracts, auditLogs]) await db.delete(t);
    await db.delete(clients);
  });
  afterAll(async () => { await closeDatabase(); });

  it("teamleden kunnen niets wijzigen of afhandelen", async () => {
    const c = await newClient("Afgeschermd");
    asViewer("milou");
    const a = await import("@/server/actions/contracts");
    const r = await a.saveContract({ clientId: c, startsOn: day(0), durationMonths: 3, monthlyValue: 2000, autoRenew: false, noticePeriodDays: 30 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/eigenaar/);
    expect((await db.select().from(contracts)).length).toBe(0);
    const h = await a.handleContractAttention({ key: `contract-owner:${c}:${day(0)}:60` });
    expect(h.ok).toBe(false);
  });

  it("nieuwe klant met drie maanden: einddatum uit looptijd, klantgegevens bijgewerkt", async () => {
    const c = await newClient("Drie maanden");
    asViewer("jarno");
    const { saveContract } = await import("@/server/actions/contracts");
    const r = await saveContract({ clientId: c, startsOn: day(0), durationMonths: 3, monthlyValue: 2760, videosPerMonth: 8, autoRenew: false, noticePeriodDays: 30 });
    expect(r.ok).toBe(true);
    const [k] = await db.select().from(contracts).where(eq(contracts.clientId, c));
    expect(String(k!.endsOn).slice(0, 10)).toBe(endDateFor(day(0), 3));
    expect(k!.ownerManaged).toBe(true);
    expect(k!.verifiedAt).not.toBeNull();
    const [cl] = await db.select().from(clients).where(eq(clients.id, c));
    expect(Number(cl!.monthlyRevenue)).toBe(2760);
    expect(cl!.monthlyVideoQuota).toBe(8);
  });

  it("lege of nul-herinneringen worden standaardmomenten, nooit 'geen meldingen'", async () => {
    const c = await newClient("Herinneringen leeg");
    asViewer("jarno");
    const { saveContract } = await import("@/server/actions/contracts");
    await saveContract({ clientId: c, startsOn: day(0), durationMonths: 3, monthlyValue: 1000, autoRenew: false, noticePeriodDays: 0, reminderDays: [0] });
    const [k] = await db.select().from(contracts).where(eq(contracts.clientId, c));
    expect(k!.reminderDays).toBeNull();
  });

  it("verlengen bewaart de historie en sluit de oude periode af", async () => {
    const c = await newClient("Verlenger");
    asViewer("jarno");
    const a = await import("@/server/actions/contracts");
    await a.saveContract({ clientId: c, startsOn: day(-80), endsOn: day(10), monthlyValue: 2000, autoRenew: false, noticePeriodDays: 0 });
    const [old] = await db.select().from(contracts).where(eq(contracts.clientId, c));
    const r = await a.renewContract({ contractId: old!.id, durationMonths: 6, monthlyValue: 2300, videosPerMonth: 8, autoRenew: false, noticePeriodDays: 30 });
    expect(r.ok).toBe(true);
    const all = await db.select().from(contracts).where(eq(contracts.clientId, c));
    expect(all).toHaveLength(2);
    const prev = all.find((k) => k.id === old!.id)!;
    const next = all.find((k) => k.id !== old!.id)!;
    expect(prev.status).toBe("expired");
    expect(prev.renewalStatus).toBe("verlengd");
    expect(String(prev.endsOn).slice(0, 10)).toBe(day(10));
    expect(String(next.startsOn).slice(0, 10)).toBe(day(11));
    expect(next.previousContractId).toBe(old!.id);
    // Nieuwe periode begint pas later: klant houdt het oude bedrag tot dan.
    const [cl] = await db.select().from(clients).where(eq(clients.id, c));
    expect(Number(cl!.monthlyRevenue)).toBe(2000);
    // Geen melding over de oude einddatum.
    const { getContractsDashboard } = await import("@/server/contracts");
    const d = await getContractsDashboard(TODAY);
    expect(d.attention.filter((x) => x.clientId === c)).toHaveLength(0);
    expect(d.active.find((x) => x.client.id === c)?.status).toBe("verlengd");
  });

  it("tussentijds verlengen met nieuw bedrag: oude periode wordt ingekort, geen dubbele maand", async () => {
    const c = await newClient("Tussentijds");
    asViewer("jarno");
    const a = await import("@/server/actions/contracts");
    await a.saveContract({ clientId: c, startsOn: day(-60), endsOn: day(120), monthlyValue: 2000, autoRenew: false, noticePeriodDays: 30 });
    const [old] = await db.select().from(contracts).where(eq(contracts.clientId, c));
    const r = await a.renewContract({ contractId: old!.id, startsOn: day(0), durationMonths: 12, monthlyValue: 2500, autoRenew: false, noticePeriodDays: 30 });
    expect(r.ok).toBe(true);
    const [prev] = await db.select().from(contracts).where(eq(contracts.id, old!.id));
    expect(String(prev!.endsOn).slice(0, 10)).toBe(day(-1));
    const [cl] = await db.select().from(clients).where(eq(clients.id, c));
    expect(Number(cl!.monthlyRevenue)).toBe(2500);
  });

  it("beëindigen in het verleden: klant naar gestopt, telt niet meer mee", async () => {
    const c = await newClient("Stopper");
    asViewer("jarno");
    const a = await import("@/server/actions/contracts");
    await a.saveContract({ clientId: c, startsOn: day(-200), endsOn: day(20), monthlyValue: 1800, autoRenew: false, noticePeriodDays: 30 });
    const [k] = await db.select().from(contracts).where(eq(contracts.clientId, c));
    const r = await a.endContract({ contractId: k!.id, endsOn: day(-1), endReason: "Kiest voor interne creator", reactivation: "misschien" });
    expect(r.ok).toBe(true);
    const [cl] = await db.select().from(clients).where(eq(clients.id, c));
    expect(cl!.status).toBe("churned");
    const { getContractsDashboard } = await import("@/server/contracts");
    const d = await getContractsDashboard(TODAY);
    expect(d.inactive.find((x) => x.client.id === c)?.shown?.endReason).toBe("Kiest voor interne creator");
    expect(d.totals.monthlyRevenue).toBe(0);
  });

  it("geen dubbele meldingen: afgehandelde fase blijft weg", async () => {
    const c = await newClient("Herinnering");
    asViewer("jarno");
    const a = await import("@/server/actions/contracts");
    await a.saveContract({ clientId: c, startsOn: day(-300), endsOn: day(40), monthlyValue: 1500, autoRenew: false, noticePeriodDays: 0 });
    const { getContractAttention } = await import("@/server/contracts");
    const before = await getContractAttention(TODAY);
    expect(before.items).toHaveLength(1);
    expect((await a.handleContractAttention({ key: before.items[0]!.key, clientId: c })).ok).toBe(true);
    expect((await a.handleContractAttention({ key: before.items[0]!.key, clientId: c })).ok).toBe(true); // idempotent
    expect((await getContractAttention(TODAY)).items).toHaveLength(0);
  });

  it("door Jarno vastgelegd contract kan een teamlid niet meer via klantbehoud wijzigen", async () => {
    const c = await newClient("Beschermd");
    asViewer("jarno");
    const a = await import("@/server/actions/contracts");
    await a.saveContract({ clientId: c, startsOn: day(-30), endsOn: day(60), monthlyValue: 2000, autoRenew: false, noticePeriodDays: 30 });
    asViewer("milou");
    const { saveContractTerms } = await import("@/server/actions/client-retention");
    const r = await saveContractTerms({ clientId: c, startsOn: day(-30), endsOn: day(400), noticePeriodDays: 0, autoRenew: true });
    expect(r.ok).toBe(false);
    const [k] = await db.select().from(contracts).where(eq(contracts.clientId, c));
    expect(String(k!.endsOn).slice(0, 10)).toBe(day(60));
  });

  it("contract dat Jarno nog niet vastlegde blijft door het team aan te passen (bestaand gedrag)", async () => {
    const c = await newClient("Nog vrij");
    await db.insert(contracts).values({ clientId: c, status: "active", startsOn: null, endsOn: day(30), monthlyValue: "1000" });
    asViewer("milou");
    const { saveContractTerms } = await import("@/server/actions/client-retention");
    const r = await saveContractTerms({ clientId: c, startsOn: day(-60), endsOn: day(90), noticePeriodDays: 30, autoRenew: false });
    expect(r.ok).toBe(true);
  });
});
