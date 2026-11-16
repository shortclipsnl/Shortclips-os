/**
 * Integratietest van het volledige offertetraject met een nagebootste PandaDoc:
 * nieuwe lead → offerte verzonden → bekeken → ondertekend → omzetten naar klant.
 * Daarnaast: nieuwe lead aanmaken, twijfel, historische import, afgewezen,
 * verlopen, ontbrekend bedrag, herhaalde synchronisatie en een PandaDoc-storing.
 * Er wordt niets naar PandaDoc gestuurd en geen echte data gewijzigd.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";

type Doc = {
  id: string; name: string; status: string; date_created: string; date_modified: string; date_sent?: string | null;
  date_completed?: string | null; expiration_date?: string | null;
  recipients: { email: string; first_name?: string; last_name?: string; recipient_type?: string }[];
  grand_total?: { amount: string; currency: string } | null; text: string; audit: { id: string; action: number; date_created: string; user?: { email?: string } }[];
};
const docs = new Map<string, Doc>();
let outage = false;

vi.mock("@/server/quotes/pandadoc-client", () => {
  class PandaDocError extends Error {
    constructor(public status: number, public userMessage: string) { super(userMessage); }
  }
  const get = (id: string) => {
    if (outage) throw new PandaDocError(503, "PandaDoc is tijdelijk niet bereikbaar.");
    const d = docs.get(id);
    if (!d) throw new PandaDocError(404, "Document niet (meer) gevonden in PandaDoc.");
    return d;
  };
  return {
    PandaDocError,
    pandadocConfigured: () => true,
    getDocumentDetails: async (id: string) => {
      const d = get(id);
      return { ...d, sent_by: { email: "jarno@shortclips.nl", first_name: "Jarno", last_name: "Klijnsma" } };
    },
    getAuditTrail: async (id: string) => get(id).audit,
    downloadDocumentPdf: async (id: string) => new TextEncoder().encode(get(id).text),
    listDocuments: async () => [...docs.values()].map(({ id, name, status, date_modified }) => ({ id, name, status, date_modified })),
    changeDocumentStatus: async () => { throw new Error("niet gebruiken in tests"); },
    verifyWebhookSignature: () => true,
  };
});
vi.mock("@/server/quotes/storage", () => ({ putQuotePdf: async (k: string) => `test/${k}.pdf` }));
vi.mock("@/server/briefing/guide-highlights", () => ({ pdfPlainText: async (b: Uint8Array) => new TextDecoder().decode(b) }));
vi.mock("@/server/automation", () => ({ dispatch: async () => {} }));
vi.mock("@/server/notifications", () => ({ notify: async () => {} }));

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let S: any;
let sync: typeof import("@/server/quotes/pandadoc-sync");

beforeAll(async () => {
  db = await freshDatabase();
  S = await import("@/db/schema");
  sync = await import("@/server/quotes/pandadoc-sync");
  await db.insert(S.users).values([
    { email: "jarno@shortclips.nl", fullName: "Jarno Klijnsma", status: "active", primaryRole: "owner" },
    { email: "milou@shortclips.nl", fullName: "Milou", status: "active", primaryRole: "project_coordinator" },
  ]);
});
afterAll(async () => { await closeDatabase(); });
beforeEach(() => { outage = false; });

const quoteOf = async (docId: string) => (await db.select().from(S.quotes).where(eq(S.quotes.externalId, docId)))[0];
const leadsNamed = async (company: string) => (await db.select().from(S.salesLeads)).filter((l: any) => l.company === company);

describe("Traject: lead → offerte → ondertekend → klant", () => {
  it("koppelt een nieuwe offerte aan de bestaande lead op e-mailadres", async () => {
    await db.insert(S.salesLeads).values({ company: "Zocon", email: "info@zocon.nl", phone: "0612345678", status: "lead" });
    docs.set("doc-zocon", {
      id: "doc-zocon", name: "Offerte - ZOCON - Shortclips.2026", status: "document.sent", date_created: iso(2), date_modified: iso(1), date_sent: iso(1),
      expiration_date: new Date(Date.now() + 20 * 86400000).toISOString(),
      recipients: [{ email: "info@zocon.nl", first_name: "piet", last_name: "zonderland", recipient_type: "signer" }],
      grand_total: null,
      text: "Organische short video. 8 short video's per maand. Looptijd: minimaal 3 maanden. € 2.950 excl. btw per maand. Totaal € 8.850 excl. btw, € 10.708,50 incl. btw.",
      audit: [{ id: "a1", action: 1, date_created: iso(2) }, { id: "a2", action: 6, date_created: iso(1) }],
    });
    const r = await sync.syncPandaDocDocument("doc-zocon");
    expect(r.created).toBe(true);
    const q = await quoteOf("doc-zocon");
    expect(q.status).toBe("verzonden");
    expect(q.leadMatch).toBe("email");
    expect(Number(q.amount)).toBe(8850);
    expect(q.recipientContactName).toBe("Piet Zonderland");
    expect(q.dealTerms).toMatchObject({ focus: "organisch", shortsPerMonth: 8, contractMonths: 3, monthlyExclVat: 2950 });
    const [lead] = await leadsNamed("Zocon");
    expect(lead.status).toBe("offerte");
  });

  it("bekeken en daarna ondertekend: status, tijdlijn en lead gewonnen", async () => {
    const d = docs.get("doc-zocon")!;
    d.status = "document.viewed"; d.date_modified = iso(0.5);
    d.audit.push({ id: "a3", action: 8, date_created: iso(0.5), user: { email: "info@zocon.nl" } });
    await sync.syncPandaDocDocument("doc-zocon");
    expect((await quoteOf("doc-zocon")).status).toBe("bekeken");

    d.status = "document.completed"; d.date_completed = iso(0.1); d.date_modified = iso(0.1);
    d.audit.push({ id: "a4", action: 7, date_created: iso(0.1) });
    await sync.syncPandaDocDocument("doc-zocon");
    await sync.syncPandaDocDocument("doc-zocon"); // herhaald: niets dubbel
    const q = await quoteOf("doc-zocon");
    expect(q.status).toBe("ondertekend");
    expect(q.openCount).toBe(1);
    const events = await db.select().from(S.quoteEvents).where(eq(S.quoteEvents.quoteId, q.id));
    expect(events.map((e: any) => e.type).sort()).toEqual(["created", "opened", "sent", "signed"]);
    expect((await db.select().from(S.quotes)).length).toBe(1);
    const [lead] = await leadsNamed("Zocon");
    expect(lead.status).toBe("gewonnen");
  });

  it("omzetten: afspraken uit de offerte, klant aangemaakt, offerte in het klantdossier, geen dubbele klant", async () => {
    const { getConvertForm, convertLead } = await import("@/server/onboarding");
    const [lead] = await leadsNamed("Zocon");
    const form = await getConvertForm(lead.id);
    expect(form?.quote?.status).toBe("ondertekend");
    expect(form?.quote?.terms).toMatchObject({ shortsPerMonth: 8, contractMonths: 3, monthlyExclVat: 2950 });
    const milou = form!.pms.find((p) => p.email === "milou@shortclips.nl")!;
    const input = {
      leadId: lead.id, company: "Zocon", contactName: "Piet Zonderland", email: "info@zocon.nl", phone: "0612345678",
      pakket: "org8" as const, shortsPerMonth: 8, contentFocus: "organisch" as const, monthlyRevenue: "2950", startOn: null,
      contractMonths: 3, coordinatorId: milou.id, publisher: "shortclips" as const, notes: null, confirmSimilar: false,
    };
    const res = await convertLead({ id: milou.id, email: "milou@shortclips.nl" }, input);
    expect(res.ok).toBe(true);
    const q = await quoteOf("doc-zocon");
    expect(q.clientId).toBeTruthy();
    const again = await convertLead({ id: milou.id, email: "milou@shortclips.nl" }, input);
    // Tweede poging: geweigerd of terugverwezen naar dezelfde klant, nooit een tweede klant.
    expect(again.ok === false || again.existing === true).toBe(true);
    expect((await getConvertForm(lead.id))?.alreadyClient?.name).toBe("Zocon");
    expect((await db.select().from(S.clients)).length).toBe(1);
  });

  it("verlenging bij een bestaande klant: aan dezelfde lead en klant, geen nieuwe lead", async () => {
    docs.set("doc-zocon-2", {
      id: "doc-zocon-2", name: "Offerte - Zocon - verlenging", status: "document.sent", date_created: iso(1), date_modified: iso(1), date_sent: iso(1),
      recipients: [{ email: "piet@gmail.com", recipient_type: "signer" }], text: "", audit: [],
    });
    await sync.syncPandaDocDocument("doc-zocon-2");
    const q = await quoteOf("doc-zocon-2");
    const [lead] = await leadsNamed("Zocon");
    expect(q.leadId).toBe(lead.id);
    expect(q.clientId).toBe(lead.convertedClientId);
    expect((await db.select().from(S.salesLeads)).length).toBe(1);
  });
});

describe("Leads automatisch aanmaken, bij twijfel controleren", () => {
  it("maakt één lead aan voor een nieuwe offerte zonder lead (ook bij herhaalde sync)", async () => {
    docs.set("doc-aquasel", {
      id: "doc-aquasel", name: "Offerte - Aquasel - Shortclips.2026", status: "document.sent", date_created: iso(1), date_modified: iso(1), date_sent: iso(1),
      recipients: [{ email: "marketing@aquasel.nl", first_name: "Anna", recipient_type: "signer" }], grand_total: { amount: "7470.00", currency: "EUR" }, text: "", audit: [],
    });
    await sync.syncPandaDocDocument("doc-aquasel");
    await sync.syncPandaDocDocument("doc-aquasel");
    const leads = await leadsNamed("Aquasel");
    expect(leads.length).toBe(1);
    expect(leads[0].source).toBe("PandaDoc");
    expect(leads[0].email).toBe("marketing@aquasel.nl");
    const q = await quoteOf("doc-aquasel");
    expect(q.leadMatch).toBe("aangemaakt");
    expect(Number(q.amount)).toBe(7470);
  });

  it("twijfel: lijkt op een bestaande lead → controleren, geen nieuwe lead", async () => {
    await db.insert(S.salesLeads).values({ company: "Hoekstra Transport Sneek", status: "lead" });
    docs.set("doc-hoekstra", {
      id: "doc-hoekstra", name: "Offerte - Hoekstra - Shortclips.2026", status: "document.sent", date_created: iso(1), date_modified: iso(1), date_sent: iso(1),
      recipients: [{ email: "r.hoekstra@hotmail.com", recipient_type: "signer" }], text: "", audit: [],
    });
    await sync.syncPandaDocDocument("doc-hoekstra");
    const q = await quoteOf("doc-hoekstra");
    expect(q.leadMatch).toBe("controleren");
    expect(q.leadId).toBeNull();
    expect(await leadsNamed("Hoekstra")).toEqual([]);
  });

  it("historische offertes worden geïmporteerd maar maken geen leads aan", async () => {
    docs.set("doc-oud", {
      id: "doc-oud", name: "Offerte - Oudbedrijf - Shortclips.2025", status: "document.completed", date_created: iso(300), date_modified: iso(290), date_sent: iso(299), date_completed: iso(290),
      recipients: [{ email: "info@oudbedrijf.nl", recipient_type: "signer" }], text: "", audit: [],
    });
    await sync.syncPandaDocDocument("doc-oud");
    const q = await quoteOf("doc-oud");
    expect(q.status).toBe("ondertekend");
    expect(q.leadId).toBeNull();
    expect(await leadsNamed("Oudbedrijf")).toEqual([]);
  });
});

describe("Afgewezen, verlopen, ontbrekende bedragen en storingen", () => {
  it("afgewezen en verlopen krijgen de juiste status en tijdlijnregel", async () => {
    for (const [id, status] of [["doc-afw", "document.declined"], ["doc-verl", "document.expired"]] as const) {
      docs.set(id, {
        id, name: `Offerte - ${id} - Shortclips.2026`, status, date_created: iso(20), date_modified: iso(2), date_sent: iso(19),
        expiration_date: iso(2), recipients: [{ email: `info@${id}.nl`, recipient_type: "signer" }], text: "", audit: [],
      });
      await sync.syncPandaDocDocument(id);
    }
    expect((await quoteOf("doc-afw")).status).toBe("afgewezen");
    expect((await quoteOf("doc-verl")).status).toBe("verlopen");
    const ev = await db.select().from(S.quoteEvents).where(eq(S.quoteEvents.quoteId, (await quoteOf("doc-verl")).id));
    expect(ev.some((e: any) => e.type === "expired")).toBe(true);
  });

  it("bedrag dat niet te bevestigen is blijft leeg (geen verzonnen bedrag)", async () => {
    docs.set("doc-geenbedrag", {
      id: "doc-geenbedrag", name: "Offerte - Leeg - Shortclips.2026", status: "document.sent", date_created: iso(1), date_modified: iso(1), date_sent: iso(1),
      recipients: [{ email: "info@leeg.nl", recipient_type: "signer" }], text: "Investering € 2.950 per maand.", audit: [],
    });
    await sync.syncPandaDocDocument("doc-geenbedrag");
    const q = await quoteOf("doc-geenbedrag");
    expect(q.amountSource).toBeNull();
    expect(Number(q.amount)).toBe(0);
  });

  it("een PandaDoc-storing laat bestaande offertes intact", async () => {
    const before = await db.select().from(S.quotes);
    outage = true;
    const report = await sync.syncAllPandaDoc({ full: true }).catch((e: Error) => ({ error: e.message }));
    expect(report).toBeTruthy();
    const after = await db.select().from(S.quotes);
    expect(after.length).toBe(before.length);
    expect((await quoteOf("doc-zocon")).status).toBe("ondertekend");
  });

  it("volledige sync zonder wijzigingen maakt niets dubbel", async () => {
    const before = (await db.select().from(S.quotes)).length;
    const leadsBefore = (await db.select().from(S.salesLeads)).length;
    await sync.syncAllPandaDoc({ full: true });
    await sync.syncAllPandaDoc({ full: true });
    expect((await db.select().from(S.quotes)).length).toBe(before);
    expect((await db.select().from(S.salesLeads)).length).toBe(leadsBefore);
  });
});
