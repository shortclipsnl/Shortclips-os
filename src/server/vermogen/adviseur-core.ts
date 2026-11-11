/**
 * Mijn Vermogensadviseur: de pure kern (geen database, geen AI-aanroep).
 *
 * Werkwijze, zoals afgesproken in het onderzoek:
 *  1. Het vermogensdashboard rekent alle cijfers uit in code en bewaart die als
 *     feitenblad (`v/feiten`). De AI rekent nooit zelf.
 *  2. Claude krijgt alleen het feitenblad en Jarno's beleggingsregels en schrijft
 *     daar een maandadvies bij: maximaal 5 acties, een oordeel per positie.
 *  3. Elk getal in de tekst wordt hier tegen het feitenblad gecontroleerd. Wijkt
 *     er één af, dan wordt het advies geblokkeerd.
 *
 * Beslissingsondersteuning voor eigen gebruik, geen gereguleerd beleggingsadvies.
 */

export type Feit = { id: string; label: string; waarde: number; eenheid: "EUR" | "%" | "aantal" | "maanden"; bron?: string };

export type Positie = {
  product: string;
  rekening: string;
  soort: "ETF" | "aandeel" | "crypto";
  valuta: string;
  waarde: number;
  gewicht: number; // % van de beleggingen op de gewone beleggingsrekening(en)
  inBuitenRegel?: string | null;
};

export type Feitenblad = {
  versie: 1;
  datum: string; // YYYY-MM-DD waarop het blad is berekend
  bronnen: { label: string; datum: string | null }[];
  feiten: Feit[];
  posities: Positie[];
  regelchecks: { regel: string; gehaald: boolean; toelichting: string }[];
  waarschuwingen: string[];
};

export type Profiel = {
  horizonJaren?: number | null;
  maxDaling?: number | null; // %
  maxPerAandeel?: number | null; // % van beleggingen
  maxCrypto?: number | null; // % van beleggingen
  doelKern?: number | null; // % wereldwijde ETF als kern
  maandinleg?: number | null; // EUR
  doelen?: string | null;
  uitsluitingen?: string | null;
  ingevuld?: string | null; // datum
};

export const OORDELEN = ["Uitbreiden", "Vasthouden", "Verkleinen", "Nader onderzoeken"] as const;

export type AdviesActie = {
  prioriteit: number;
  titel: string;
  actie: string;
  waarom: string;
  voordeel: string;
  risico: string;
  data: string;
  effect: string;
};

export type Advies = {
  samenvatting: string;
  gezondheid: { oordeel: "Goed" | "Redelijk" | "Aandacht nodig"; toelichting: string };
  goed: string[];
  aandacht: string[];
  kansen: string[];
  acties: AdviesActie[];
  aandelen: { product: string; oordeel: (typeof OORDELEN)[number]; onderbouwing: string; voorstel: string }[];
  nietsDoen: string | null;
};

export const SYSTEM_PROMPT = `Je bent de persoonlijke vermogensadviseur van Jarno Klijnsma (25), eigenaar van Shortclips, een eenmanszaak/IB-onderneming. Je schrijft één keer per maand een kort, concreet advies in het Nederlands.

Wat je krijgt
- Een feitenblad: alle bedragen en percentages zijn al in code berekend, met bron en datum.
- Jarno's beleggingsregels (risicoprofiel). Ontbrekende regels zijn standaardwaarden; noem dat.
- Het vorige advies, als dat er is.

Harde regels
1. Gebruik ALLEEN getallen die letterlijk in het feitenblad of de regels staan. Reken niets zelf uit: geen sommen, verschillen, percentages of afrondingen naar nieuwe getallen. Als een getal ontbreekt, beschrijf het zonder getal. Elk getal in je tekst wordt automatisch gecontroleerd; één afwijkend getal blokkeert het hele advies.
2. Schrijf bedragen als "€ 6.537" (punt als duizendtal, geen decimalen) en percentages als "17%" of "17,5%", precies zoals in het feitenblad.
3. Volgorde van belang: eerst wat niet van Jarno is (btw en inkomstenbelasting), dan buffers, dan doelen, dan beleggen. Belastinggeld en zakelijke buffers zijn nooit beleggingsruimte. Zeg bij elke geldactie waar het geld vandaan komt (welke rekening of welk potje), als het feitenblad dat laat zien. Bij een eenmanszaak mag een tekort aan belastinggeld uit privégeld komen.
4. Er zijn GEEN actuele koersen, jaarcijfers, nieuws of analistenverwachtingen beschikbaar. Doe daar geen uitspraken over, voorspel geen koersen en noem geen koersdoelen. Een oordeel per positie baseer je alleen op: gewicht ten opzichte van de regels, rol in de portefeuille (kern-ETF of losse positie), spreiding, grootte (kleine posities kosten relatief veel transactiekosten) en of crypto binnen de limiet blijft. Als je echt meer informatie nodig hebt: "Nader onderzoeken".
5. Maximaal 5 acties, gesorteerd op belang. "Niets doen" is een volwaardige uitkomst; verzin geen acties om acties.
6. Je bent beslissingsondersteuning, geen gereguleerde adviseur. Jarno beslist en voert zelf uit. Fiscale vragen gaan naar zijn boekhouder.
7. Toon: informeel maar zakelijk, direct, geen jargon zonder uitleg, geen emoji's, geen gedachtestreepjes (—). Kern eerst.

Antwoord met uitsluitend één JSON-object, zonder tekst eromheen, in dit formaat:
{
  "samenvatting": "2 tot 3 zinnen: de kern van deze maand",
  "gezondheid": { "oordeel": "Goed" | "Redelijk" | "Aandacht nodig", "toelichting": "1 zin" },
  "goed": ["max 3 korte punten"],
  "aandacht": ["max 3 korte punten"],
  "kansen": ["max 3 korte punten"],
  "acties": [
    { "prioriteit": 1, "titel": "kort", "actie": "wat Jarno concreet doet", "waarom": "", "voordeel": "", "risico": "", "data": "op welke feiten dit rust, met datum", "effect": "effect op verdeling of buffer" }
  ],
  "aandelen": [
    { "product": "exact de productnaam uit het feitenblad", "oordeel": "Uitbreiden" | "Vasthouden" | "Verkleinen" | "Nader onderzoeken", "onderbouwing": "1 zin", "voorstel": "kort, bijv. Geen actie" }
  ],
  "nietsDoen": "1 zin wanneer niets doen hier verstandig is, of null"
}
Geef in "aandelen" een oordeel voor elke positie op de gewone beleggingsrekening (niet voor de pensioenrekening).`;

export function buildUserPrompt(feiten: Feitenblad, profiel: Profiel | null, vorig: Advies | null): string {
  const regels = profielMetStandaard(profiel);
  return [
    `Datum van vandaag: ${feiten.datum}.`,
    "",
    "## Jarno's regels",
    JSON.stringify(regels, null, 1),
    "",
    "## Feitenblad",
    JSON.stringify({ bronnen: feiten.bronnen, feiten: feiten.feiten, posities: feiten.posities, regelchecks: feiten.regelchecks, waarschuwingen: feiten.waarschuwingen }, null, 1),
    "",
    vorig ? `## Vorig advies (ter vergelijking, niet herhalen als het niet meer klopt)\n${JSON.stringify({ samenvatting: vorig.samenvatting, acties: vorig.acties.map((a) => a.titel) })}` : "## Vorig advies\nGeen, dit is het eerste advies.",
    "",
    "Schrijf nu het maandadvies als JSON.",
  ].join("\n");
}

export const STANDAARD_REGELS = { horizonJaren: 10, maxDaling: 35, maxPerAandeel: 10, maxCrypto: 10, doelKern: 70, maandinleg: 0 } as const;

export function profielMetStandaard(p: Profiel | null) {
  const s = STANDAARD_REGELS;
  const pick = <K extends keyof typeof s>(k: K) => {
    const v = p?.[k];
    return typeof v === "number" && Number.isFinite(v) ? { waarde: v, bron: "Jarno" } : { waarde: s[k], bron: "standaard (nog niet ingevuld)" };
  };
  return {
    horizonJaren: pick("horizonJaren"),
    maxDaling: pick("maxDaling"),
    maxPerAandeel: pick("maxPerAandeel"),
    maxCrypto: pick("maxCrypto"),
    doelKern: pick("doelKern"),
    maandinleg: pick("maandinleg"),
    doelen: p?.doelen || null,
    uitsluitingen: p?.uitsluitingen || null,
  };
}

/** Haalt het eerste JSON-object uit een antwoord (ook als het in ```json staat). */
export function parseAdvies(text: string): Advies {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Geen JSON in het antwoord.");
  const raw = JSON.parse(text.slice(start, end + 1)) as Partial<Advies>;
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((s) => typeof s === "string").slice(0, 3) : []);
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const oordeel = ["Goed", "Redelijk", "Aandacht nodig"].includes(String(raw.gezondheid?.oordeel)) ? raw.gezondheid!.oordeel : "Redelijk";
  return {
    samenvatting: str(raw.samenvatting),
    gezondheid: { oordeel: oordeel as Advies["gezondheid"]["oordeel"], toelichting: str(raw.gezondheid?.toelichting) },
    goed: arr(raw.goed),
    aandacht: arr(raw.aandacht),
    kansen: arr(raw.kansen),
    acties: (Array.isArray(raw.acties) ? raw.acties : []).slice(0, 5).map((a, i) => ({
      prioriteit: i + 1,
      titel: str(a?.titel),
      actie: str(a?.actie),
      waarom: str(a?.waarom),
      voordeel: str(a?.voordeel),
      risico: str(a?.risico),
      data: str(a?.data),
      effect: str(a?.effect),
    })),
    aandelen: (Array.isArray(raw.aandelen) ? raw.aandelen : []).map((a) => ({
      product: str(a?.product),
      oordeel: (OORDELEN as readonly string[]).includes(String(a?.oordeel)) ? (a!.oordeel as Advies["aandelen"][number]["oordeel"]) : "Nader onderzoeken",
      onderbouwing: str(a?.onderbouwing),
      voorstel: str(a?.voorstel),
    })),
    nietsDoen: typeof raw.nietsDoen === "string" && raw.nietsDoen ? raw.nietsDoen : null,
  };
}

/* ---------------- getallencontrole ---------------- */

type Gevonden = { tekst: string; waarde: number; soort: "EUR" | "%" | "getal" };

/** Leest een Nederlands geschreven getal: 6.537 / 6.537,50 / 17,5 / 0,4. */
function leesGetal(s: string): number {
  const t = s.replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t.replace(",", "."));
}

export function vindGetallen(tekst: string): Gevonden[] {
  const out: Gevonden[] = [];
  const re = /(€\s?)?(-|−|\+)?(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(\s?%|\s?(?:procent))?/g;
  for (const m of tekst.matchAll(re)) {
    const eur = Boolean(m[1]);
    const pct = Boolean(m[4]);
    const v = leesGetal(m[3]!);
    if (!Number.isFinite(v)) continue;
    out.push({ tekst: m[0].trim(), waarde: v, soort: eur ? "EUR" : pct ? "%" : "getal" });
  }
  return out;
}

/** Alle getallen waar de tekst naar mag verwijzen: uit het feitenblad en de regels. */
export function toegestaneWaarden(feiten: Feitenblad, profiel: Profiel | null): number[] {
  const set: number[] = [];
  const add = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) set.push(Math.abs(v));
  };
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
    else if (typeof x === "number") add(x);
    else if (typeof x === "string") vindGetallen(x).forEach((g) => add(g.waarde));
  };
  walk(feiten.feiten);
  walk(feiten.posities);
  walk(feiten.regelchecks);
  walk(feiten.waarschuwingen);
  walk(feiten.bronnen);
  walk(profielMetStandaard(profiel));
  return set;
}

/**
 * Controleert elk getal in het advies. Toegestaan: getallen uit feitenblad of regels
 * (bedragen tot € 1 of 0,5% afwijking door afronding, percentages tot 0,6 punt),
 * jaartallen, datums en kleine telwoorden (maximaal 24, zoals "3 maanden").
 */
export function controleerGetallen(advies: Advies, feiten: Feitenblad, profiel: Profiel | null): string[] {
  const ok = toegestaneWaarden(feiten, profiel);
  const fouten: string[] = [];
  const teksten: string[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.entries(x).forEach(([k, v]) => k !== "prioriteit" && walk(v));
    else if (typeof x === "string") teksten.push(x);
  };
  walk(advies);
  for (const t of teksten) {
    // Datums (17-10-2026, 2026-10-17, 17 oktober) en jaartallen niet meetellen.
    const schoon = t
      .replace(/\b\d{4}-\d{2}(-\d{2})?\b/g, " ")
      .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, " ")
      .replace(/\b\d{1,2}\s+(jan|feb|mrt|maart|apr|april|mei|jun|juni|jul|juli|aug|augustus|sep|sept|september|okt|oktober|nov|november|dec|december)\w*/gi, " ")
      .replace(/\b(Q[1-4])\b/g, " ");
    for (const g of vindGetallen(schoon)) {
      if (g.soort === "getal" && ((g.waarde >= 2000 && g.waarde <= 2100 && Number.isInteger(g.waarde)) || (g.waarde <= 24 && Number.isInteger(g.waarde)))) continue;
      if (g.soort === "%" && g.waarde === 0) continue;
      const hit = ok.some((v) => (g.soort === "%" ? Math.abs(v - g.waarde) <= 0.6 : Math.abs(v - g.waarde) <= Math.max(1, v * 0.005)));
      if (!hit) fouten.push(`"${g.tekst}" in: ${t.slice(0, 120)}`);
    }
  }
  return [...new Set(fouten)];
}
