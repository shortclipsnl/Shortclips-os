import { describe, expect, it } from "vitest";
import { parseLeadMail } from "@/server/leads/mail-parser";
import { matchLeadMail, type MatchClient, type MatchLead } from "@/server/leads/matching";

/**
 * Lead-mails uit de map "LEADS - SHORTCLIPS": elk formulier heeft een eigen
 * opmaak. De voorbeelden volgen de echte mails, met verzonnen gegevens.
 */
describe("parseLeadMail — de vier formuliersoorten", () => {
  it("Rocket Leads", () => {
    const p = parseLeadMail({
      from: "contact@rocket-leads.nl",
      body: "Beste,\n\nBij deze een nieuwe lead van Shortclips. Gelieve binnen 24 uur contact\nopnemen voor het beste resultaat:\n\n- Naam: Jan Voorbeeld\n- Bedrijfsnaam: Voorbeeld BV\n- Email: Jan@voorbeeld.nl\n- Telefoon: +31611112222\n- Wat maakt dat je interesse hebt: Ik wil meer leads genereren voor mijn bedrijf\n- Hoeveel werknemers heeft je bedrijf: 1-3\n- €5.000 - €25.000\n\nSucces!\n",
    });
    expect(p.formType).toBe("Rocket Leads");
    expect(p.source).toBe("Rocket leads");
    expect(p.contactName).toBe("Jan Voorbeeld");
    expect(p.company).toBe("Voorbeeld BV");
    expect(p.email).toBe("Jan@voorbeeld.nl");
    expect(p.phone).toBe("+31611112222");
    expect(p.message).toContain("Hoeveel werknemers heeft je bedrijf: 1-3");
    expect(p.message).toContain("Maandomzet: €5.000 - €25.000");
  });

  it("oude site (Elementor): voorloopnul terug, technische voet weg", () => {
    const p = parseLeadMail({
      from: '"Shortclips" <email@shortclips.nl>',
      body: "naam: Piet Test\nBedrijfsnaam: Test Fietsen\nEmail: info@testfietsen.nl\nTelefoon nummer: 612345000\nBericht: Hallo,\nWe zagen jullie video's. Voorbeeld: https://www.instagram.com/reel/abc\nGroet\n\n---\n\nDate: May 14, 2024\nPage URL: https://shortclips.nl/contact-opnemen/\nUser Agent: Mozilla/5.0\nRemote IP: 1.2.3.4\nPowered by: Elementor\n",
    });
    expect(p.formType).toBe("Website (Elementor, oude site)");
    expect(p.source).toBe("Website contactformulier");
    expect(p.contactName).toBe("Piet Test");
    expect(p.company).toBe("Test Fietsen");
    expect(p.phone).toBe("0612345000");
    expect(p.message).toContain("https://www.instagram.com/reel/abc");
    expect(p.original).not.toContain("Remote IP");
    expect(p.original).toContain("Pagina: https://shortclips.nl/contact-opnemen/");
  });

  it("Framer met generieke veldnamen (Name/Number/Location)", () => {
    const p = parseLeadMail({
      from: '"Contactformulier" <noreply@framer.com>',
      replyTo: '"Contactformulier" <kees@bedrijfx.nl>',
      body: "Je hebt een nieuw bericht van het contactformulier op de website.\n͏ ­͏ ­\nJe hebt een nieuw bericht van het contactformulier op de website.\nName: Kees de Tester\nName: kees@bedrijfx.nl\nName: Woensdag middag\nNumber: 0611223344\nNumber: Bedrijf X B.V.\nLocation: Meer dan €100.000+\nLocation: Zo snel mogelijk\nMessage: Ik wil graag starten met wekelijkse video's.\nThis email is a submission of a Framer form.\n",
    });
    expect(p.formType).toBe("Website (Framer, contactformulier)");
    expect(p.contactName).toBe("Kees de Tester");
    expect(p.email).toBe("kees@bedrijfx.nl");
    expect(p.phone).toBe("0611223344");
    expect(p.company).toBe("Bedrijf X B.V.");
    expect(p.message).toBe("Ik wil graag starten met wekelijkse video's.");
    expect(p.original).not.toContain("This email is a submission");
  });

  it("Framer gratis kennismaking: vierde Name is de bedrijfsnaam", () => {
    const p = parseLeadMail({
      from: '"Gratis kennismaking" <noreply@framer.com>',
      body: "Het gratis kennismaken formulier op de website is ingevuld.\nhttps://framer.link/abc\nName: Anna Proef\nName: anna@proef.nl\nName: 0655443322\nName: Proef School\nName: 3-11 11.00 uur\nMessage: Graag contact.\n",
    });
    expect(p.formType).toBe("Website (Framer, gratis kennismaking)");
    expect(p.contactName).toBe("Anna Proef");
    expect(p.phone).toBe("0655443322");
    expect(p.company).toBe("Proef School");
  });

  it("Framer met echte veldnamen, ook via de Meta-landingspagina (trackingcodes weg)", () => {
    const p = parseLeadMail({
      from: '"Contactformulier" <noreply@framer.com>',
      body: "Je hebt een nieuwe aanvraag via de landingspagina /plan-kennismaking (Meta-advertentie). Bel binnen een werkdag terug.\nnaam: Sam Demo\ntelefoonnummer: 06 12 34 50 00\nemail: sam@demo.nl\nbedrijfsnaam: Demo Security\nbericht: Aanvraag via landingspagina /plan-kennismaking (Meta) Situatie: Doen we zelf fbclid:\nPAZXh0bgNhZW0BMABw\nPagina:\nhttps://www.shortclips.nl/plan-kennismaking?fbclid=PAZX&utm_medium=paid\nThis email is a submission of a Framer form.\n",
    });
    expect(p.formType).toBe("Website (Framer, landingspagina Meta-advertentie)");
    expect(p.contactName).toBe("Sam Demo");
    expect(p.company).toBe("Demo Security");
    expect(p.phone).toBe("06 12 34 50 00");
    expect(p.original).not.toContain("PAZX");
    expect(p.original).toContain("https://www.shortclips.nl/plan-kennismaking");
  });

  it("verzint niets: onbruikbaar telefoonnummer blijft leeg", () => {
    const p = parseLeadMail({ from: "email@shortclips.nl", body: "naam: X\nBedrijfsnaam: Y\nEmail: x@y.nl\nTelefoon nummer: 0\nBericht: hoi\n---\nPowered by: Elementor" });
    expect(p.phone).toBeNull();
    expect(p.website).toBeNull();
  });
});

describe("matchLeadMail — bestaande lead, twijfel of nieuw", () => {
  const leads: MatchLead[] = [
    { id: "L1", company: "Voorbeeld BV", contactName: "Jan Voorbeeld", email: "jan@voorbeeld.nl", phone: "+31611112222", website: null },
    { id: "L2", company: "Bob Zwart   Financial Partner BV", contactName: null, email: null, phone: null, website: null },
    { id: "L3", company: "Jasper Koekoek", contactName: "ADG Group - Jasper Koekoek", email: null, phone: null, website: null },
    { id: "L4", company: "KIVA - Atze Atsma", contactName: "Atze Atsma", email: null, phone: null, website: null },
  ];
  const clients: MatchClient[] = [{ name: "Wallable", status: "churned", website: "https://wallable.nl", emails: [], phones: [] }];

  it("zelfde e-mailadres (hoofdletters maken niet uit) → bestaande lead", () => {
    const r = matchLeadMail({ company: "Iets anders", contactName: null, email: "Jan@Voorbeeld.nl", phone: null }, leads, clients);
    expect(r).toMatchObject({ kind: "existing", leadId: "L1" });
  });

  it("zelfde telefoonnummer in andere schrijfwijze → bestaande lead", () => {
    const r = matchLeadMail({ company: null, contactName: null, email: "ander@gmail.com", phone: "06 1111 2222" }, leads, clients);
    expect(r).toMatchObject({ kind: "existing", leadId: "L1" });
  });

  it("bedrijfsnaam + naam + domein, zonder e-mail op de lead → bestaande lead", () => {
    const r = matchLeadMail({ company: "FinancialPartner B.V.", contactName: "Bob Zwart", email: "info@financialpartner.nl", phone: "0655000000" }, leads, clients);
    expect(r).toMatchObject({ kind: "existing", leadId: "L2" });
  });

  it("alleen de naam van de contactpersoon komt overeen → twijfel, met voorstel", () => {
    const r = matchLeadMail({ company: "ADG groep", contactName: "Jasper koekoek", email: "marketing@adggroep.nl", phone: "0646000000" }, leads, clients);
    expect(r).toMatchObject({ kind: "review", candidateLeadId: "L3" });
  });

  it("kort domein dat toevallig in een andere naam zit (iva in KIVA) is geen match", () => {
    const r = matchLeadMail({ company: "IVA Business School", contactName: "Caspar Proef", email: "caspar@iva.nl", phone: "0654000000" }, leads, clients);
    expect(r.kind).toBe("new");
  });

  it("bedrijf is al klant zonder leadprofiel → twijfel, niet opnieuw als prospect", () => {
    const r = matchLeadMail({ company: "Wallable", contactName: "Dennis de Jong", email: "info@wallable.nl", phone: null }, leads, clients);
    expect(r).toMatchObject({ kind: "review", candidateLeadId: null });
  });

  it("alleen dezelfde voornaam of een nepnummer is geen match → nieuwe lead", () => {
    const r = matchLeadMail({ company: "Heel Nieuw", contactName: "Jan", email: "jan@heelnieuw.nl", phone: "0612345678" }, leads, clients);
    expect(r.kind).toBe("new");
  });
});
