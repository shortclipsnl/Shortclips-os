import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * Lead-intake uit de mail: elke mail precies één keer, bestaande leads blijven
 * intact (status, notities) en krijgen de aanvraag als contactmoment erbij.
 */
describe("Lead-intake — geen dubbele leads, bestaande gegevens blijven", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let intake: typeof import("@/server/leads/intake");

  const rocket = (name: string, company: string, email: string, phone: string) =>
    `Beste,\n\nBij deze een nieuwe lead van Shortclips. Gelieve binnen 24 uur contact\nopnemen voor het beste resultaat:\n\n- Naam: ${name}\n- Bedrijfsnaam: ${company}\n- Email: ${email}\n- Telefoon: ${phone}\n- Wat maakt dat je interesse hebt: Meer leads\n\nSucces!\n`;
  const mail = (id: string, body: string, date = "2026-11-10T09:00:00Z") => ({
    messageId: id,
    from: "contact@rocket-leads.nl",
    replyTo: null,
    subject: "Nieuwe lead | Shortclips",
    date: new Date(date),
    body,
  });

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    intake = await import("@/server/leads/intake");
    await db.insert(s.salesLeads).values({
      company: "Oude Relatie BV",
      contactName: "Tina Oud",
      email: "tina@ouderelatie.nl",
      status: "verloren",
      note: "Waren we te duur.",
      source: "Netwerk",
    });
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it("nieuwe aanvraag wordt één lead; dezelfde mail opnieuw doet niets", async () => {
    const ctx = await intake.loadIntakeContext();
    const m = mail("<a1@test>", rocket("Nieuw Persoon", "Nieuw Bedrijf", "nieuw@nieuwbedrijf.nl", "+31600000001"));
    expect(await intake.processLeadMail(m, ctx, { notify: false })).toBe("created");
    expect(await intake.processLeadMail(m, await intake.loadIntakeContext(), { notify: false })).toBe("skipped");

    const leads = await db.select().from(s.salesLeads).where(eq(s.salesLeads.email, "nieuw@nieuwbedrijf.nl"));
    expect(leads).toHaveLength(1);
    expect(leads[0]!.status).toBe("lead");
    expect(leads[0]!.source).toBe("Rocket leads");
    expect(leads[0]!.firstContactOn).toBe("2026-11-10");
    expect(leads[0]!.note).toContain("Wat maakt dat je interesse hebt: Meer leads");
    expect(await intake.knownMessageIds(["<a1@test>", "<onbekend@test>"])).toEqual(new Set(["<a1@test>"]));
  });

  it("tweede aanvraag van dezelfde persoon (andere mail) wordt geen tweede lead", async () => {
    const ctx = await intake.loadIntakeContext();
    const m = mail("<a2@test>", rocket("Nieuw Persoon", "Nieuw Bedrijf", "NIEUW@nieuwbedrijf.nl", "0600000001"), "2026-11-12T09:00:00Z");
    expect(await intake.processLeadMail(m, ctx, { notify: false })).toBe("attached");
    const leads = await db.select().from(s.salesLeads).where(eq(s.salesLeads.company, "Nieuw Bedrijf"));
    expect(leads).toHaveLength(1);
    expect(leads[0]!.note).toContain("[Aanvraag 12-11-2026 via Rocket Leads]");
  });

  it("verloren lead: aanvraag komt erbij, status en bestaande notitie blijven, telefoon wordt aangevuld", async () => {
    const ctx = await intake.loadIntakeContext();
    const m = mail("<a3@test>", rocket("Tina Oud", "Oude Relatie", "tina@ouderelatie.nl", "+31600000002"));
    expect(await intake.processLeadMail(m, ctx, { notify: false })).toBe("attached");
    const [lead] = await db.select().from(s.salesLeads).where(eq(s.salesLeads.email, "tina@ouderelatie.nl"));
    expect(lead!.status).toBe("verloren");
    expect(lead!.source).toBe("Netwerk");
    expect(lead!.note!.startsWith("Waren we te duur.")).toBe(true);
    expect(lead!.note).toContain("[Aanvraag 10-11-2026 via Rocket Leads]");
    expect(lead!.phone).toBe("+31600000002");
    const [ev] = await db.select().from(s.leadMailEvents).where(eq(s.leadMailEvents.messageId, "<a3@test>"));
    expect(ev!.outcome).toBe("attached");
    expect(ev!.leadId).toBe(lead!.id);
  });
});
