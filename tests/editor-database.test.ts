import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { clients, deliverables, editorContacts, users } from "@/db/schema";
import {
  availabilityState,
  findDuplicate,
  formatPhone,
  missingFields,
  normalizeSpecialisations,
  normalizeUrl,
  parseCsv,
  parseImport,
  parseVcards,
  phoneDigits,
  sanitizeProfile,
  whatsappUrl,
} from "@/lib/editor-database";
import type { Viewer } from "@/server/auth/context";
import { canUseEditorDatabase } from "@/server/editor-database-access";

describe("editor database: normalisatie", () => {
  it("zet Nederlandse nummers om naar internationale cijfers", () => {
    expect(phoneDigits("06 12345678")).toBe("31612345678");
    expect(phoneDigits("+31 (0)6-1234 5678")).toBe("31612345678");
    expect(phoneDigits("0031612345678")).toBe("31612345678");
    expect(phoneDigits("+32 470 12 34 56")).toBe("32470123456");
    expect(phoneDigits("123")).toBeNull();
    expect(formatPhone("0612345678")).toBe("+31 6 12345678");
  });

  it("WhatsApp-link opent alleen het gesprek, zonder tekst", () => {
    expect(whatsappUrl(null, "06 12345678")).toBe("https://wa.me/31612345678");
    expect(whatsappUrl("+31 6 87654321", "06 12345678")).toBe("https://wa.me/31687654321");
    expect(whatsappUrl(null, null)).toBeNull();
    expect(whatsappUrl(null, "06 12345678")).not.toContain("text=");
  });

  it("accepteert alleen http(s)-links", () => {
    expect(normalizeUrl("vimeo.com/123")).toBe("https://vimeo.com/123");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("niks")).toBeNull();
  });

  it("specialisaties: vaste schrijfwijze en geen dubbelen", () => {
    expect(normalizeSpecialisations("automotive, Automotive; premium edits")).toEqual(["Automotive", "Premium edits"]);
  });

  it("profiel zonder naam wordt geweigerd, onbekende waarden vallen terug", () => {
    expect(() => sanitizeProfile({ fullName: "  " })).toThrow();
    const p = sanitizeProfile({ fullName: "Test Editor", category: "hacker", availability: "x", ratingQuality: 9, ratePerVideo: "€ 45,-" });
    expect(p.category).toBe("potentieel");
    expect(p.availability).toBe("onbekend");
    expect(p.ratingQuality).toBeNull();
    expect(p.ratePerVideo).toBe(45);
  });
});

describe("editor database: beschikbaarheid", () => {
  const today = new Date(2026, 10, 13);
  it("is nooit beschikbaar zonder bevestiging", () => {
    expect(availabilityState("beschikbaar", null, today).usable).toBe("onbekend");
    expect(availabilityState("onbekend", "2026-11-12", today).status).toBe("onbekend");
  });
  it("recente bevestiging telt, oude niet", () => {
    expect(availabilityState("beschikbaar", "2026-11-10", today)).toMatchObject({ status: "bevestigd", days: 3, usable: "beschikbaar" });
    expect(availabilityState("beschikbaar", "2026-10-01", today)).toMatchObject({ status: "verouderd", usable: "onbekend" });
  });
  it("benoemt ontbrekende gegevens", () => {
    const m = missingFields({ phone: "06", whatsapp: null, email: null, portfolioUrl: null, links: [], specialisations: [], ratePerVideo: null, knownRate: 40, availability: "onbekend", ratingQuality: null, ratingCollaboration: null });
    expect(m).toEqual(["email", "portfolio", "specialisations", "availability", "rating"]);
  });
});

describe("editor database: import", () => {
  it("leest WhatsApp-vCards (waid-nummer, meerdere kaarten)", () => {
    const vcf = [
      "BEGIN:VCARD", "VERSION:3.0", "N:Jansen;Lotte;;;", "FN:Lotte Jansen",
      "item1.TEL;waid=31611112222:+31 6 11112222", "item1.X-ABLabel:Mobiel", "EMAIL;type=INTERNET:Lotte@Voorbeeld.nl",
      "URL:https://vimeo.com/lotte", "URL:instagram.com/lotte.edits", "END:VCARD",
      "BEGIN:VCARD", "VERSION:3.0", "FN:Bram", "TEL;type=CELL:06 33334444", "END:VCARD",
    ].join("\r\n");
    const out = parseVcards(vcf);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ fullName: "Lotte Jansen", phone: "+31611112222", email: "lotte@voorbeeld.nl", portfolioUrl: "https://vimeo.com/lotte" });
    expect(out[0]!.links[0]).toMatchObject({ label: "Instagram" });
    expect(out[1]).toMatchObject({ fullName: "Bram", phone: "06 33334444" });
    expect(parseImport(vcf)).toHaveLength(2);
  });

  it("leest CSV met en zonder kopregel", () => {
    const withHeader = parseCsv('Naam;Telefoon;E-mail;Portfolio;Specialisaties;Tarief\n"Anna, de Vries";0612345678;anna@x.nl;vimeo.com/anna;Automotive, Advertenties;€ 45');
    expect(withHeader[0]).toMatchObject({ fullName: "Anna, de Vries", phone: "0612345678", email: "anna@x.nl", portfolioUrl: "https://vimeo.com/anna", specialisations: ["Automotive", "Advertenties"], ratePerVideo: 45 });
    const plain = parseCsv("Piet Bakker, 0687654321, piet@x.nl");
    expect(plain[0]).toMatchObject({ fullName: "Piet Bakker", phone: "0687654321", email: "piet@x.nl" });
  });

  it("herkent dubbelen op nummer, e-mail of volledige naam, niet op losse voornaam", () => {
    const existing = [
      { id: "1", fullName: "Sem van Tilburg", phone: "+31 6 12345678", whatsapp: null, email: "info@semvantilburg.nl" },
      { id: "2", fullName: "Quinn", phone: null, whatsapp: null, email: null },
    ];
    expect(findDuplicate({ fullName: "S.", phone: "0612345678", email: null }, existing)?.reason).toBe("telefoon");
    expect(findDuplicate({ fullName: "X", phone: null, email: "INFO@semvantilburg.nl" }, existing)?.reason).toBe("e-mail");
    expect(findDuplicate({ fullName: "sem van tilburg", phone: null, email: null }, existing)?.reason).toBe("naam");
    expect(findDuplicate({ fullName: "Quinn", phone: null, email: null }, existing)).toBeNull();
  });
});

describe("editor database: toegang", () => {
  const v = (over: Partial<Viewer>) => ({ id: "u", email: "x@x.nl", primaryRole: "editor", isPortalUser: false, isEditorOnly: false, permissions: new Set(), clientScope: [], ...over }) as unknown as Viewer;
  it("alleen eigenaar en vast kantoorteam", () => {
    expect(canUseEditorDatabase(v({ primaryRole: "owner", email: "jarno@shortclips.nl" } as Partial<Viewer>))).toBe(true);
    expect(canUseEditorDatabase(v({ email: "milou@shortclips.nl", primaryRole: "project_coordinator" } as Partial<Viewer>))).toBe(true);
    expect(canUseEditorDatabase(v({ email: "rutger@shortclips.nl", primaryRole: "videographer" } as Partial<Viewer>))).toBe(true);
  });
  it("freelance editors, videografen en klanten niet", () => {
    expect(canUseEditorDatabase(v({ email: "info@fabianmedia.nl", isEditorOnly: true }))).toBe(false);
    expect(canUseEditorDatabase(v({ email: "nathan@x.nl", primaryRole: "videographer" } as Partial<Viewer>))).toBe(false);
    expect(canUseEditorDatabase(v({ email: "klant@x.nl", primaryRole: "client", isPortalUser: true } as Partial<Viewer>))).toBe(false);
    expect(canUseEditorDatabase(v({ email: "milou@shortclips.nl", isEditorOnly: true }))).toBe(false);
    expect(canUseEditorDatabase(null)).toBe(false);
  });
});

describe("editor database: bestaande editors uit het portaal", () => {
  beforeAll(async () => {
    const db = await freshDatabase();
    const [fabian, oud, nooit] = await db.insert(users).values([
      { email: "info@fabianmedia.nl", fullName: "Fabian Media", status: "active", primaryRole: "editor" },
      { email: "oud@example.com", fullName: "Oud Editor", status: "suspended", primaryRole: "editor" },
      { email: "nooit@example.com", fullName: "Nooit Gemonteerd", status: "active", primaryRole: "editor" },
    ]).returning({ id: users.id });
    void nooit;
    const [c] = await db.insert(clients).values({ slug: "klant-ed", name: "Klant ED", status: "active" }).returning({ id: clients.id });
    await db.insert(deliverables).values([
      { clientId: c!.id, title: "A", status: "published", editorId: fabian!.id, dueOn: "2026-10-01" },
      { clientId: c!.id, title: "B", status: "editing", editorId: fabian!.id, dueOn: "2026-11-20" },
      { clientId: c!.id, title: "C", status: "published", editorId: oud!.id, dueOn: "2026-05-01" },
    ]);
  });
  afterAll(closeDatabase);

  it("maakt profielen aan, één keer, met echte werkhistorie", async () => {
    const { listEditorProfiles, syncPortalEditors } = await import("@/server/editor-database");
    const first = await listEditorProfiles();
    await syncPortalEditors();
    const again = await listEditorProfiles();
    expect(again).toHaveLength(first.length);
    const fabian = first.find((p) => p.fullName === "Fabian Media")!;
    expect(fabian).toMatchObject({ category: "actief", workedWithUs: "ja", linkedUser: true, availabilityStatus: "onbekend", knownRate: 48 });
    expect(fabian.stats).toMatchObject({ total: 2, done: 1, inProduction: 1, clients: 1 });
    const oud = first.find((p) => p.fullName === "Oud Editor")!;
    expect(oud).toMatchObject({ category: "backup", unverifiedFields: ["category"] });
    expect(first.find((p) => p.fullName === "Nooit Gemonteerd")).toBeUndefined();
  });

  it("maakt een gearchiveerd profiel niet opnieuw aan", async () => {
    const { db } = await import("@/db/client");
    const { listEditorProfiles } = await import("@/server/editor-database");
    await db.update(editorContacts).set({ deletedAt: new Date() });
    expect(await listEditorProfiles()).toHaveLength(0);
  });
});
