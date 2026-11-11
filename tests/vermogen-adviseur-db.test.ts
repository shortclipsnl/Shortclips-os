import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * Mijn Vermogensadviseur tegen een echte (PGlite) database. De AI is vervangen
 * door vaste antwoorden: eerst één met een verzonnen getal, daarna een correct.
 */
const antwoorden: string[] = [];
const prompts: string[] = [];
vi.mock("@/server/ai/client", () => ({
  aiConfigured: () => true,
  aiModelStrong: () => "test-opus",
  runPrompt: async (input: { user: string }) => {
    prompts.push(input.user);
    return { ok: true, text: antwoorden.shift() ?? "{}", model: "test-opus" };
  },
}));

const feiten = {
  versie: 1,
  datum: new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }),
  bronnen: [{ label: "Banksaldi", datum: "2026-11-06" }],
  feiten: [
    { id: "btw_tekort", label: "Btw nog apart te zetten", waarde: 6537, eenheid: "EUR" },
    { id: "crypto_pct", label: "Crypto als deel van beleggingen", waarde: 30.2, eenheid: "%" },
  ],
  posities: [{ product: "Fictief ETF", rekening: "Broker", soort: "ETF", valuta: "EUR", waarde: 1000, gewicht: 50 }],
  regelchecks: [],
  waarschuwingen: [],
};
const advies = (tekst: string) =>
  JSON.stringify({
    samenvatting: tekst,
    gezondheid: { oordeel: "Redelijk", toelichting: "Crypto is 30,2%." },
    goed: [], aandacht: [], kansen: [],
    acties: [{ titel: "Btw", actie: "Zet € 6.537 apart", waarom: "", voordeel: "", risico: "", data: "", effect: "" }],
    aandelen: [{ product: "Fictief ETF", oordeel: "Vasthouden", onderbouwing: "50% van je beleggingen", voorstel: "Geen actie" }],
    nietsDoen: null,
  });

let store: typeof import("@/server/vermogen/store");
let adviseur: typeof import("@/server/vermogen/adviseur");

beforeAll(async () => {
  await freshDatabase();
  store = await import("@/server/vermogen/store");
  adviseur = await import("@/server/vermogen/adviseur");
});
afterAll(closeDatabase);

describe("vermogensadviseur met database", () => {
  it("meldt netjes als er nog geen feitenblad is", async () => {
    const d = await adviseur.maakAdvies("handmatig");
    expect(d.status).toBe("fout");
    expect(d.melding).toMatch(/feitenblad/);
  });

  it("corrigeert een verzonnen getal in een tweede poging en bewaart het advies", async () => {
    await store.putVermogenDoc("v/feiten", feiten);
    await store.putVermogenDoc("v/cfg", { rekeningen: [], profiel: { maxCrypto: 15 } });
    antwoorden.push(advies("Je mist € 9.999 aan belastinggeld."), advies("Zet € 6.537 apart voor de btw."));
    const d = await adviseur.maakAdvies("handmatig");
    expect(d.status).toBe("ok");
    expect(d.controle.pogingen).toBe(2);
    expect(prompts.at(-1)).toContain("€ 9.999");
    expect(prompts[0]).toContain('"maxCrypto"');
    const docs = await store.getAllVermogenDocs();
    expect(Object.keys(docs).filter((k) => k.startsWith("v/advies/"))).toHaveLength(1);
    expect(await adviseur.heeftAdviesVoorMaand(d.maand)).toBe(true);
  });

  it("de maandtaak doet niets als er deze maand al een goed advies is", async () => {
    expect((await adviseur.maandAdviesTaak()).status).toBe("al gedaan");
  });

  it("blokkeert als ook de tweede poging een verkeerd getal bevat", async () => {
    antwoorden.push(advies("€ 1.111"), advies("€ 2.222"));
    const d = await adviseur.maakAdvies("handmatig");
    expect(d.status).toBe("geblokkeerd");
    expect(d.controle.fouten[0]).toContain("2.222");
    expect((await adviseur.laatsteAdvies())?.status).toBe("ok");
  });
});
