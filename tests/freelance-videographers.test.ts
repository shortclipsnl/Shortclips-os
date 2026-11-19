import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { clients, productionDays, users, videographerContacts } from "@/db/schema";
import {
  EMPTY_FILTERS,
  findDuplicate,
  initials,
  matchesFilters,
  missingFields,
  normalizeLabels,
  normalizePhoto,
  REGIONS,
  sanitizeProfile,
  sortProfiles,
  whatsappUrl,
  type FilterableVideographer,
} from "@/lib/freelance-videographers";
import type { Viewer } from "@/server/auth/context";
import { canUseFreelanceVideographers } from "@/server/freelance-videographers-access";

describe("freelance videografen: normalisatie", () => {
  it("vereist een naam en laat onbekende waarden leeg of op de standaard", () => {
    expect(() => sanitizeProfile({ fullName: "  " })).toThrow(/Vul een naam in/);
    const p = sanitizeProfile({ fullName: " Jan  de Vries ", status: "onzin", availability: "kapot", dayRate: "€ 450,50", hourlyRate: "-3", email: "geen-mail", portfolioUrl: "javascript:alert(1)" });
    expect(p).toMatchObject({ fullName: "Jan de Vries", status: "in_gesprek", availability: "onbekend", dayRate: 451, hourlyRate: null, email: null, portfolioUrl: null, photo: null });
  });

  it("neemt geen tarief, beschikbaarheid of nummer over die niet is ingevuld", () => {
    const p = sanitizeProfile({ fullName: "Alleen Naam" });
    expect(p).toMatchObject({ phone: null, whatsapp: null, dayRate: null, hourlyRate: null, availability: "onbekend", regions: [], specialisations: [] });
  });

  it("houdt vaste regio's in hun spelling en maakt labels uniek", () => {
    expect(normalizeLabels(["friesland", "Friesland", "heel nederland", "Texel"], REGIONS)).toEqual(["Friesland", "Heel Nederland", "Texel"]);
    expect(normalizeLabels("drone; Drone / horeca en food", ["Drone", "Horeca en food"])).toEqual(["Drone", "Horeca en food"]);
  });

  it("accepteert alleen een kleine jpeg, png of webp als foto", () => {
    expect(normalizePhoto("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).not.toBeNull();
    expect(normalizePhoto("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(normalizePhoto("https://x.nl/foto.jpg")).toBeNull();
    expect(normalizePhoto(`data:image/jpeg;base64,${"A".repeat(230_000)}`)).toBeNull();
  });

  it("maakt initialen voor de avatar", () => {
    expect(initials("Jan de Vries")).toBe("JV");
    expect(initials("Nathan")).toBe("N");
    expect(initials("")).toBe("?");
  });
});

describe("freelance videografen: WhatsApp en dubbelen", () => {
  it("gebruikt het juiste nummer en opent alleen het gesprek", () => {
    expect(whatsappUrl(null, "06 12345678")).toBe("https://wa.me/31612345678");
    expect(whatsappUrl("+31 6 87654321", "06 12345678")).toBe("https://wa.me/31687654321");
    expect(whatsappUrl(null, null)).toBeNull();
    expect(whatsappUrl("niet bellen", null)).toBeNull();
  });

  it("herkent dubbelen op nummer, e-mail of volledige naam, niet op losse voornaam", () => {
    const existing = [
      { id: "1", fullName: "Jan de Vries", phone: "+31 6 12345678", whatsapp: null, email: "jan@film.nl" },
      { id: "2", fullName: "Nathan", phone: null, whatsapp: null, email: null },
    ];
    expect(findDuplicate({ fullName: "X", phone: "0612345678", email: null }, existing)?.reason).toBe("telefoon");
    expect(findDuplicate({ fullName: "X", phone: null, email: "JAN@film.nl" }, existing)?.reason).toBe("e-mail");
    expect(findDuplicate({ fullName: "jan de vries", phone: null, email: null }, existing)?.reason).toBe("naam");
    expect(findDuplicate({ fullName: "Nathan", phone: null, email: null }, existing)).toBeNull();
  });

  it("markeert ontbrekende gegevens als nog aanvullen", () => {
    const empty = { phone: null, whatsapp: null, email: null, city: null, regions: [], portfolioUrl: null, links: [], specialisations: [], dayRate: null, hourlyRate: null, availability: "onbekend" };
    expect(missingFields(empty)).toEqual(["phone", "email", "region", "portfolio", "specialisations", "rate", "availability"]);
    expect(missingFields({ ...empty, whatsapp: "0612345678", city: "Sneek", hourlyRate: 60, availability: "beschikbaar", specialisations: ["Drone"], portfolioUrl: "https://x.nl", email: "a@b.nl" })).toEqual([]);
  });
});

describe("freelance videografen: zoeken en filteren", () => {
  const mk = (over: Partial<FilterableVideographer>): FilterableVideographer => ({
    fullName: "Test", email: null, phone: null, city: null, regions: [], specialisations: [], status: "geselecteerd", availability: "onbekend", availabilityStatus: "onbekend", ...over,
  });
  const jan = mk({ fullName: "Jan de Vries", city: "Sneek", regions: ["Friesland"], specialisations: ["Automotive"], availability: "beschikbaar", availabilityStatus: "bevestigd" });
  const els = mk({ fullName: "Els Bakker", city: "Groningen", regions: ["Groningen", "Drenthe"], specialisations: ["Drone"], status: "in_gesprek", availability: "beperkt", availabilityStatus: "bevestigd" });
  const oud = mk({ fullName: "Piet Oud", city: "Amsterdam", regions: ["Amsterdam en omgeving"], status: "niet_actief", availability: "beschikbaar", availabilityStatus: "verouderd" });
  const all = [jan, els, oud];
  const run = (f: Partial<typeof EMPTY_FILTERS>) => all.filter((p) => matchesFilters(p, { ...EMPTY_FILTERS, ...f })).map((p) => p.fullName);

  it("zoekt op naam, woonplaats en specialisatie", () => {
    expect(run({ q: "bakk" })).toEqual(["Els Bakker"]);
    expect(run({ q: "sneek" })).toEqual(["Jan de Vries"]);
    expect(run({ q: "drone" })).toEqual(["Els Bakker"]);
  });
  it("filtert op werkregio, specialisatie en status", () => {
    expect(run({ region: "Drenthe" })).toEqual(["Els Bakker"]);
    expect(run({ region: "Amsterdam en omgeving" })).toEqual(["Piet Oud"]);
    expect(run({ spec: "Automotive" })).toEqual(["Jan de Vries"]);
    expect(run({ status: "niet_actief" })).toEqual(["Piet Oud"]);
  });
  it("telt alleen recent bevestigde beschikbaarheid", () => {
    expect(run({ av: "beschikbaar" })).toEqual(["Jan de Vries"]);
    expect(run({ av: "inzetbaar" })).toEqual(["Jan de Vries", "Els Bakker"]);
    expect(run({ av: "niet_bevestigd" })).toEqual(["Piet Oud"]);
  });
  it("sorteert op status en daarna op naam", () => {
    expect(sortProfiles(all).map((p) => p.fullName)).toEqual(["Jan de Vries", "Els Bakker", "Piet Oud"]);
  });
});

describe("freelance videografen: toegang", () => {
  const v = (over: Partial<Viewer>) => ({ id: "u", email: "x@x.nl", primaryRole: "content_creator", isPortalUser: false, isEditorOnly: false, permissions: new Set(), clientScope: [], ...over }) as unknown as Viewer;
  it("alleen eigenaar en vast kantoorteam", () => {
    expect(canUseFreelanceVideographers(v({ primaryRole: "owner", email: "jarno@shortclips.nl" } as Partial<Viewer>))).toBe(true);
    expect(canUseFreelanceVideographers(v({ email: "milou@shortclips.nl", primaryRole: "project_coordinator" } as Partial<Viewer>))).toBe(true);
    expect(canUseFreelanceVideographers(v({ email: "jiska@shortclips.nl" }))).toBe(true);
    expect(canUseFreelanceVideographers(v({ email: "rutger@shortclips.nl", primaryRole: "videographer" } as Partial<Viewer>))).toBe(true);
  });
  it("freelance videografen, editors en klanten niet", () => {
    expect(canUseFreelanceVideographers(v({ email: "nathan@x.nl", primaryRole: "videographer" } as Partial<Viewer>))).toBe(false);
    expect(canUseFreelanceVideographers(v({ email: "info@fabianmedia.nl", primaryRole: "editor", isEditorOnly: true } as Partial<Viewer>))).toBe(false);
    expect(canUseFreelanceVideographers(v({ email: "klant@x.nl", primaryRole: "client", isPortalUser: true } as Partial<Viewer>))).toBe(false);
    expect(canUseFreelanceVideographers(v({ email: "ergens@x.nl" }))).toBe(false);
    expect(canUseFreelanceVideographers(null)).toBe(false);
  });
});

describe("freelance videografen: bestaande videografen uit het portaal", () => {
  beforeAll(async () => {
    const db = await freshDatabase();
    const [sven, , , nathan] = await db.insert(users).values([
      { email: "sven@shortclips.nl", fullName: "Sven Hoekstra", status: "active", primaryRole: "videographer" },
      { email: "rutger@shortclips.nl", fullName: "Rutger Hettema", status: "active", primaryRole: "videographer" },
      { email: "fabian@example.com", fullName: "Fabian Media", status: "active", primaryRole: "editor" },
      { email: "nathan@example.com", fullName: "Nathan Bakker", status: "suspended", primaryRole: "videographer" },
    ]).returning({ id: users.id });
    void nathan;
    const [c] = await db.insert(clients).values({ slug: "klant-vg", name: "Klant VG", status: "active" }).returning({ id: clients.id });
    await db.insert(productionDays).values([
      { clientId: c!.id, title: "Opname 1", scheduledOn: "2026-09-27", videographerId: sven!.id },
      { clientId: c!.id, title: "Opname 2", scheduledOn: "2999-01-01", videographerId: sven!.id },
    ]);
  });
  afterAll(closeDatabase);

  it("begint met alleen wat echt bekend is: Nathan uit de migratie, zonder verzonnen gegevens", async () => {
    const { db } = await import("@/db/client");
    const rows = await db.select().from(videographerContacts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fullName: "Nathan", status: "niet_actief", source: "bekend", phone: null, email: null, dayRate: null, hourlyRate: null, availability: "onbekend", userId: null });
  });

  it("maakt profielen aan, één keer, zonder kernteam en zonder verzonnen gegevens", async () => {
    const { listVideographerProfiles, syncPortalVideographers } = await import("@/server/freelance-videographers");
    const first = await listVideographerProfiles();
    await syncPortalVideographers();
    const again = await listVideographerProfiles();
    expect(again).toHaveLength(first.length);
    expect(first.map((p) => p.fullName).sort()).toEqual(["Nathan Bakker", "Sven Hoekstra"]);
    const sven = first.find((p) => p.fullName === "Sven Hoekstra")!;
    expect(sven).toMatchObject({ status: "geselecteerd", linkedUser: true, email: null, phone: null, dayRate: null, availabilityStatus: "onbekend", source: "portaal" });
    expect(sven.stats).toMatchObject({ total: 2, past: 1, clients: 1, nextWorkOn: "2999-01-01" });
    expect(sven.missing).toContain("rate");
  });

  it("koppelt het bestaande profiel Nathan aan zijn account in plaats van een dubbel profiel te maken", async () => {
    const { listVideographerProfiles } = await import("@/server/freelance-videographers");
    const list = await listVideographerProfiles();
    const nathans = list.filter((p) => p.fullName.startsWith("Nathan"));
    expect(nathans).toHaveLength(1);
    expect(nathans[0]).toMatchObject({ fullName: "Nathan Bakker", status: "niet_actief", linkedUser: true });
    expect(nathans[0]!.sourceLabel).toContain("Gekoppeld aan videograafaccount");
  });

  it("maakt een gearchiveerd profiel niet opnieuw aan", async () => {
    const { db } = await import("@/db/client");
    const { listVideographerProfiles } = await import("@/server/freelance-videographers");
    await db.update(videographerContacts).set({ deletedAt: new Date() });
    expect(await listVideographerProfiles()).toHaveLength(0);
  });
});
