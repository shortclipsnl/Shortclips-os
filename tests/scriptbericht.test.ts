import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES,
  LINK_TOKEN,
  PLACEHOLDER,
  checkMessage,
  insertedValue,
  normaliseSaved,
  normaliseTemplates,
  renderTemplate,
  swapLink,
  validateTemplate,
} from "@/lib/scriptbericht";

const ADOBE = "https://acrobat.adobe.com/id/urn:aaid:sc:EU:1234";
const REVIEW = "3f2a9c1e-1111-4222-8333-444455556666";
const OTHER_REVIEW = "9b9b9b9b-1111-4222-8333-444455556666";
const PORTAL = `https://shortclips-os.vercel.app/portal/scripts/${REVIEW}`;

describe("scriptbericht templates", () => {
  it("beide standaardteksten hebben precies één linkplek en WhatsApp-vet", () => {
    for (const t of Object.values(DEFAULT_TEMPLATES)) {
      expect(t.split(LINK_TOKEN).length - 1).toBe(1);
      expect(t).toContain("📄 *Scripts bekijken:*");
      expect(t).toContain("*Belangrijk om te weten:*");
    }
    expect(DEFAULT_TEMPLATES.adobe.startsWith("Hierbij de scripts voor de aankomende opnamedag! 🎬")).toBe(true);
    expect(DEFAULT_TEMPLATES.portal.startsWith("De scripts voor de aankomende opnamedag staan klaar in het Shortclips Portaal! 🎬")).toBe(true);
  });

  it("vult de link in, of de plaatshouder zonder link", () => {
    expect(renderTemplate(DEFAULT_TEMPLATES.adobe, "adobe", ADOBE)).toContain(`📄 *Scripts bekijken:*\n${ADOBE}\n`);
    expect(renderTemplate(DEFAULT_TEMPLATES.adobe, "adobe", "")).toContain(PLACEHOLDER.adobe);
    expect(renderTemplate(DEFAULT_TEMPLATES.portal, "portal", "  ")).toContain(PLACEHOLDER.portal);
  });

  it("vervangt de link ook in een aangepaste tekst", () => {
    const start = renderTemplate(DEFAULT_TEMPLATES.adobe, "adobe", "");
    const edited = `Hoi Jelle!\n\n${start}`;
    const r = swapLink(edited, insertedValue("adobe", ""), ADOBE);
    expect(r.replaced).toBe(true);
    expect(r.text.startsWith("Hoi Jelle!")).toBe(true);
    expect(r.text).toContain(ADOBE);
    expect(r.text).not.toContain(PLACEHOLDER.adobe);
    const r2 = swapLink(r.text, ADOBE, "https://acrobat.adobe.com/id/nieuw");
    expect(r2.text).toContain("/id/nieuw");
    expect(r2.text).not.toContain(ADOBE);
  });

  it("meldt het als de link uit de tekst is verwijderd", () => {
    expect(swapLink("geen link hier", ADOBE, "x").replaced).toBe(false);
  });

  it("templatebeheer vereist de linkplek", () => {
    expect(validateTemplate("Hoi")).toMatch(/link/);
    expect(validateTemplate(`Hoi ${LINK_TOKEN}`)).toBeNull();
    // Ongeldig opgeslagen template valt terug op de standaard.
    expect(normaliseTemplates({ adobe: "zonder link", portal: `P ${LINK_TOKEN}` })).toEqual({ adobe: DEFAULT_TEMPLATES.adobe, portal: `P ${LINK_TOKEN}` });
  });

  it("normaliseert opgeslagen data robuust", () => {
    expect(normaliseSaved(null).links).toEqual({});
    const s = normaliseSaved({ methode: "portal", links: { portal: PORTAL, foo: "x" }, texts: { adobe: "  " } });
    expect(s.methode).toBe("portal");
    expect(s.links).toEqual({ portal: PORTAL });
    expect(s.texts).toEqual({});
  });
});

describe("controle voor het kopiëren", () => {
  const base = { clientId: "klant-a", ownReviewId: REVIEW, foreign: [] };

  it("blokkeert zonder link", () => {
    const r = checkMessage({ ...base, methode: "adobe", link: "", text: renderTemplate(DEFAULT_TEMPLATES.adobe, "adobe", "") });
    expect(r.ok).toBe(false);
  });

  it("staat een correct Adobe-bericht toe", () => {
    const r = checkMessage({ ...base, methode: "adobe", link: ADOBE, text: renderTemplate(DEFAULT_TEMPLATES.adobe, "adobe", ADOBE) });
    expect(r).toEqual({ ok: true });
  });

  it("geeft een hint bij een niet-Adobe link", () => {
    const link = "https://drive.google.com/file/d/abc";
    const r = checkMessage({ ...base, methode: "adobe", link, text: renderTemplate(DEFAULT_TEMPLATES.adobe, "adobe", link) });
    expect(r.ok).toBe(true);
    expect(r.ok && r.hint).toBeTruthy();
  });

  it("blokkeert een link van een andere klant", () => {
    const r = checkMessage({
      ...base,
      methode: "adobe",
      link: ADOBE,
      text: renderTemplate(DEFAULT_TEMPLATES.adobe, "adobe", ADOBE),
      foreign: [{ link: `${ADOBE}/`, reviewId: null, clientId: "klant-b", clientName: "Klant B" }],
    });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("Klant B") });
  });

  it("blokkeert een portaallink met de review van een andere klant", () => {
    const link = `https://shortclips-os.vercel.app/portal/scripts/${OTHER_REVIEW}`;
    const r = checkMessage({
      ...base,
      methode: "portal",
      link,
      text: renderTemplate(DEFAULT_TEMPLATES.portal, "portal", link),
      foreign: [{ link: "x", reviewId: OTHER_REVIEW, clientId: "klant-b", clientName: "Klant B" }],
    });
    expect(r.ok).toBe(false);
  });

  it("blokkeert een portaallink die niet bij deze opname hoort", () => {
    const link = `https://shortclips-os.vercel.app/portal/scripts/${OTHER_REVIEW}`;
    const r = checkMessage({ ...base, methode: "portal", link, text: renderTemplate(DEFAULT_TEMPLATES.portal, "portal", link) });
    expect(r.ok).toBe(false);
  });

  it("staat de eigen portaallink toe", () => {
    const r = checkMessage({ ...base, methode: "portal", link: PORTAL, text: renderTemplate(DEFAULT_TEMPLATES.portal, "portal", PORTAL) });
    expect(r).toEqual({ ok: true });
  });

  it("blokkeert als de link niet meer in de tekst staat", () => {
    const r = checkMessage({ ...base, methode: "adobe", link: ADOBE, text: "Hoi, de scripts staan klaar." });
    expect(r.ok).toBe(false);
  });
});

describe("status na kopiëren", async () => {
  const { statusNaKopieren } = await import("@/lib/scriptbericht");
  it("zet alles op Controle bij klant, behalve als die al zo staat of final is", () => {
    for (const s of ["concepting", "scriptmeeting", "controle_jarno", "feedback_jarno", "afwachting_klant", "nog_aanvullen"]) {
      expect(statusNaKopieren(s)).toBe("scripts_bij_klant");
    }
    expect(statusNaKopieren("scripts_bij_klant")).toBeNull();
    expect(statusNaKopieren("final")).toBeNull();
  });
});
