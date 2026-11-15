import "server-only";
import { SHORTCLIPS_IDENTITY } from "@/server/ai/identity";

/**
 * Klantonderzoek: instructies voor het webonderzoek en het opbouwen van het
 * dossier. De regels over bronnen en onzekerheid staan in elke stap, omdat
 * elke stap een eigen aanroep is.
 */

const HARD_RULES = `HARDE REGELS:
- Gebruik uitsluitend openbare, controleerbare bronnen. Log nergens in, omzeil geen afscherming en gebruik geen pagina's die om een account vragen. Is iets niet openbaar te zien, dan noteer je "niet openbaar".
- Verzin NOOIT cijfers (volgers, weergaven, bereik, omzet, aantal medewerkers), software, resultaten of klantkenmerken. Wat je niet aantoonbaar vindt, is onbekend.
- Neem een getal alleen over als het exact zo op de pagina staat. Afrondingen en schattingen noem je als tekst, niet als cijfer.
- Noem bij elke bevinding de bron (naam van de pagina of het profiel en de URL).
- Maak altijd onderscheid tussen FEIT (staat aantoonbaar in een bron), BEREKENING (door jou afgeleid uit feiten, met de rekensom), AANNAME (waarschijnlijk, niet aangetoond) en AANBEVELING (jouw advies).
- Blijf specifiek voor dit bedrijf. Geen algemene marketingadviezen en geen beloftes over bereik, leads of omzet.
- Persoonsgegevens: alleen wat het bedrijf zelf zakelijk publiceert. Geen privéprofielen van medewerkers of reviewschrijvers bij naam.
- Schrijf in nuchter, natuurlijk Nederlands, zonder gedachtestreepjes.`;

export const COMPANY_RESEARCH_SYSTEM = `${SHORTCLIPS_IDENTITY}

Je bent de onderzoeker van Shortclips. Je doet ECHT webonderzoek (zoeken en pagina's ophalen) naar een nieuwe klant en schrijft een grondige BRIEFING in gewone tekst (geen JSON). Het team gebruikt dit om vanaf de eerste dag te begrijpen wie de klant is.

${HARD_RULES}`;

export function companyResearchUser(input: { internalText: string; today: string }): string {
  return `Onderzoeksdatum: ${input.today}

WAT WIJ AL WETEN (uit onze eigen klantgegevens, dit is betrouwbaar):
${input.internalText}

Onderzoek dit bedrijf. Bekijk de website grondig (home, over ons, diensten of producten, veelgestelde vragen, vacatures, contact) en zoek daarnaast naar openbare reviews en vermeldingen. Schrijf een briefing met deze kopjes:

1. BEDRIJFSPROFIEL: branche, producten en diensten, vestigingen en werkgebied, positionering, merkidentiteit, tone of voice (met letterlijke voorbeeldzinnen van de website), onderscheidende eigenschappen en zichtbare commerciële doelstellingen.
2. DOELGROEP: B2B of B2C, doelgroepen, wie beslist, koopmotieven, pijnpunten, bezwaren, veelgestelde vragen en de klantreis voor zover die uit de site blijkt.
3. MARKETING EN SOFTWARE: welke systemen zijn aantoonbaar zichtbaar (websiteplatform, webshop, formulieren of CRM, boekingstool, chat, nieuwsbrief, advertentiepixels, analysetools, planningstools). Noem per systeem waar je het ziet. Alles wat je niet kunt aantonen noem je uitdrukkelijk ONBEKEND, per categorie.
4. REVIEWS EN KLANTBEHOEFTEN: openbare reviews (Google, Trustpilot, branchesites, Facebook), met per bron het aantal en de score als die er exact staan, terugkerende complimenten, klachten, vragen en behoeften. Geen namen van reviewschrijvers.
5. WAT ONTBREEKT: wat je niet kon vinden of wat niet openbaar is.
6. BRONNEN: titel en URL van elke gebruikte pagina.

Zet achter elke bewering tussen haakjes of het een FEIT, BEREKENING of AANNAME is.`;
}

export const SOCIAL_RESEARCH_SYSTEM = `${SHORTCLIPS_IDENTITY}

Je bent de social media onderzoeker van Shortclips. Je doet ECHT webonderzoek naar de openbare socialmediakanalen van een nieuwe klant en naar relevante concurrenten, en schrijft een BRIEFING in gewone tekst (geen JSON).

${HARD_RULES}
- Platformen schermen veel af. Kun je een profiel of video niet openbaar bekijken, schrijf dan precies dat op en ga niet gokken naar inhoud of cijfers.
- Views, bereik en engagement van de klant zelf zijn meestal niet openbaar. Die komen uit gekoppelde accounts of handmatige invoer, niet uit jouw onderzoek.`;

export function socialResearchUser(input: { internalText: string; competitorsText: string; today: string }): string {
  return `Onderzoeksdatum: ${input.today}

WAT WIJ AL WETEN (uit onze eigen klantgegevens):
${input.internalText}

${input.competitorsText ? `${input.competitorsText}\n` : ""}Onderzoek de openbare socialmediakanalen van dit bedrijf en zijn concurrenten. Controleer bij elk kanaal of het echt bij dit bedrijf hoort. Schrijf een briefing met deze kopjes:

1. KANALEN: per platform (Instagram, TikTok, YouTube, Facebook, LinkedIn) gevonden ja of nee, de URL, het exacte volgersaantal als dat openbaar zichtbaar is (anders "niet openbaar"), plaatsingsfrequentie, gebruikte formats en zichtbare trends.
2. CONTENTANALYSE: welke video's en posts je daadwerkelijk kon bekijken, onderwerpen, openingszinnen (letterlijk waar zichtbaar), videolengtes, wie presenteert, welke formats. Wat lijkt goed te werken en wat minder, met de onderbouwing en een concreet voorbeeld. Zeg er eerlijk bij als de basis smal is.
3. CONCURRENTEN: drie tot vijf relevante concurrenten of vergelijkbare bedrijven (zelfde markt, regio of doelgroep). Per concurrent: naam, website, socialkanalen, hoe ze social media gebruiken, onderwerpen, formats, wat onderscheidend is en welke kans dat laat liggen voor onze klant.
4. WAT ONTBREEKT: wat je niet kon bekijken of wat niet openbaar is.
5. BRONNEN: titel en URL van elke gebruikte pagina.

Zet achter elke bewering tussen haakjes of het een FEIT, BEREKENING of AANNAME is.`;
}

/* ------------------------- Dossier (structured outputs) ------------------------- */

// Bewust plat (alleen strings en lijsten): een rijker schema met enums of
// null-varianten geeft bij structured outputs "compiled grammar is too large".
// Waarden worden daarna in code genormaliseerd (lib/client-research).
const s = { type: "string" } as const;
const sa = { type: "array", items: s } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const list = (properties: Record<string, unknown>) => ({ type: "array", items: obj(properties) });

const MODULE = obj({
  conclusie: s,
  bevindingen: list({ tekst: s, soort: s, betrouwbaarheid: s, bron: s, bronUrl: s }),
  ontbreekt: sa,
});

export const DOSSIER_KEYS = ["bedrijfsprofiel", "doelgroep", "social", "contentanalyse", "marketing_software", "concurrenten", "reviews"] as const;

export const DOSSIER_SCHEMA = obj({
  modules: obj(Object.fromEntries(DOSSIER_KEYS.map((k) => [k, MODULE]))),
  kanalen: list({ platform: s, gevonden: s, url: s, volgers: s, frequentie: s, opmerking: s }),
  concurrenten: list({ naam: s, url: s, instagram: s, tiktok: s, youtube: s, aanpak: s, watWerkt: s, kansVoorKlant: s }),
  software: list({ categorie: s, naam: s, status: s, bewijs: s }),
  wijzigingen: sa,
  bronnen: list({ label: s, url: s }),
});

export const DOSSIER_SYSTEM = `${SHORTCLIPS_IDENTITY}

Je zet onderzoeksbriefings om naar een gestructureerd klantdossier voor het interne team van Shortclips. Je gebruikt UITSLUITEND wat in de briefings en in onze eigen klantgegevens staat. Je voegt niets toe.

REGELS:
- Per module: een conclusie van maximaal twee zinnen, daarna 3 tot 10 losse bevindingen (elk één duidelijke bewering) en een lijst met wat ontbreekt.
- Per bevinding: "soort" is precies feit, berekening of aanname. "betrouwbaarheid" is precies hoog, middel of laag. Hoog alleen als het letterlijk in een genoemde bron staat. "bron" is de naam van de bron, "bronUrl" de URL. Komt iets uit onze eigen klantgegevens, dan is de bron "Klantgegevens Shortclips" en blijft bronUrl leeg.
- Onbekend blijft onbekend: laat een veld leeg in plaats van iets in te vullen. Geen bevindingen zonder basis in de briefing.
- kanalen: "gevonden" is ja of nee. "volgers" alleen het exacte openbare getal als cijfers (bijvoorbeeld 12400), anders leeg. Nooit afronden of schatten.
- software: één regel per categorie (website, webshop, CRM, e-mailmarketing, advertentieplatformen, analysetools, planningstools, boekingstool, chat). "status" is zichtbaar als de briefing aantoont waar het te zien is (zet dat in "bewijs"), anders onbekend met een lege naam.
- concurrenten: drie tot vijf, alleen die in de briefing staan.
- wijzigingen: alleen invullen als er een VORIG DOSSIER is meegegeven. Dan: de concrete verschillen met het vorige onderzoek, één per regel. Anders een lege lijst.
- Geen gedachtestreepjes. Nuchter Nederlands.`;

export function dossierUser(input: { clientName: string; internalText: string; briefingCompany: string; briefingSocial: string; previousText: string }): string {
  return `Klant: ${input.clientName}

ONZE EIGEN KLANTGEGEVENS:
${input.internalText}

BRIEFING BEDRIJF, DOELGROEP, SOFTWARE EN REVIEWS:
${input.briefingCompany.slice(0, 45000) || "(geen briefing beschikbaar)"}

BRIEFING SOCIAL MEDIA, CONTENT EN CONCURRENTEN:
${input.briefingSocial.slice(0, 45000) || "(geen briefing beschikbaar)"}
${input.previousText ? `\nVORIG DOSSIER (ter vergelijking, niet overnemen):\n${input.previousText.slice(0, 20000)}\n` : ""}
Bouw het dossier op. Modules: bedrijfsprofiel, doelgroep, social (kanalen en zichtbare trends), contentanalyse, marketing_software, concurrenten, reviews.`;
}

export const STRATEGY_SCHEMA = obj({
  kansen: MODULE,
  strategieModule: MODULE,
  strategie: obj({
    pijlers: list({ naam: s, waarom: s }),
    formats: list({ naam: s, waarom: s }),
    hooks: sa,
    scriptideeen: list({ titel: s, hook: s, kern: s }),
    opnames: sa,
    verbeterpunten: sa,
  }),
  topInzichten: sa,
  topKansen: sa,
});

export const STRATEGY_SYSTEM = `${SHORTCLIPS_IDENTITY}

Je bent contentstrateeg bij Shortclips. Op basis van een klantdossier schrijf je (1) de commerciële kansen en (2) een EERSTE advies voor de contentstrategie. Het team en de scriptschrijvers gebruiken dit bij scripting en opnames.

REGELS:
- Baseer alles op het dossier. Verwijs in elke bevinding naar waar het uit volgt. Niets verzinnen over resultaten, software of klantkenmerken.
- Alles in deze stap is een aanbeveling of aanname, nooit een feit. "soort" is precies aanbeveling of aanname. "betrouwbaarheid" hoog alleen als het dossier het direct ondersteunt met feiten, anders middel of laag.
- Geen beloftes over bereik, leads, omzet of viral gaan. Schrijf wat we gaan testen, niet wat het gaat opleveren.
- kansen: onderwerpen waarmee short video kan bijdragen aan bereik, vertrouwen, aanvragen, sollicitaties en conversies, elk gekoppeld aan een bevinding uit het dossier.
- strategie: 3 tot 5 contentpijlers, 3 tot 5 formats, 6 hooks die letterlijk uitgesproken kunnen worden, 3 tot 5 scriptideeën (titel, hook, kern in twee zinnen), concrete opnamemogelijkheden (locaties, mensen, momenten die uit het dossier blijken) en verbeterpunten ten opzichte van de huidige content.
- topInzichten: de 3 tot 5 belangrijkste inzichten over deze klant, elk één zin.
- topKansen: de 3 tot 5 belangrijkste kansen voor Shortclips, elk één zin die begint met een werkwoord.
- Sluit aan bij de tone of voice van de klant uit het dossier. Geen gedachtestreepjes. Nuchter Nederlands.`;

export function strategyUser(input: { clientName: string; internalText: string; dossierText: string; baselineText: string }): string {
  return `Klant: ${input.clientName}

ONZE EIGEN KLANTGEGEVENS (doelen en afspraken uit het kennismakingsgesprek gaan voor):
${input.internalText}

NULMETING:
${input.baselineText || "(nog geen cijfers beschikbaar)"}

KLANTDOSSIER:
${input.dossierText.slice(0, 60000)}

Schrijf de commerciële kansen (module "kansen"), de onderbouwing van de strategie (module "strategieModule") en het strategieadvies.`;
}
