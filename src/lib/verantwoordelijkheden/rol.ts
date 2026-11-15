/**
 * Mijn verantwoordelijkheden: vaste inhoud per rol (missie, kerntaak, resultaat,
 * signalen, scenario's en KPI-definities).
 *
 * Bron: opdracht van Jarno, 15 nov 2026. De bestaande verdeling uit de kennisbank
 * (data.ts en Beheer) blijft de bron voor de detailverantwoordelijkheden, de
 * beslisregels en de afwezigheidsregeling. Dit bestand voegt alleen de kop van de
 * pagina en de vaste rolinhoud toe. Onderdelen met `voorstel: true` zijn door
 * Claude uitgewerkt en nog niet door Jarno bevestigd: het team ziet ze gewoon,
 * de eigenaar ziet het label "Voorstel".
 */

export type RolKey = "cc" | "videograaf";

export type Scenario = {
  situatie: string;
  eigenaar: string;
  actie: string;
  voorkomen: string;
  niveau: string;
  voorstel: boolean;
};

export type KpiDef = {
  id: string;
  titel: string;
  /** De afspraak in gewone taal. */
  norm: string;
  /** Voorgestelde grenswaarden (nog goed te keuren door Jarno). */
  grenzen: string;
  /** Welke minimale registratie nodig is als er nog geen meting is. */
  registratie?: string;
};

export type Rol = {
  key: RolKey;
  /** Achter "Ik, Naam, ben verantwoordelijk voor ...". */
  verantwoordelijkVoor: string;
  missie: string;
  kerntaak: string;
  resultaat: string;
  /** "Wanneer is mijn werk klaar?" */
  klaarAls: string[];
  /** Vaste taken, per blok. */
  taken: { titel: string; punten: string[] }[];
  /** Wat je zelf moet herkennen, ook als het portaal het (nog) niet meldt. */
  signaleren: string[];
  scenarios: Scenario[];
  kpis: KpiDef[];
  /** Kop boven het linkerblok. */
  lijstTitel: string;
};

const CC: Rol = {
  key: "cc",
  verantwoordelijkVoor: "mijn klanten, hun content, planning, tevredenheid en resultaten",
  missie: "Mijn klanten blijven, groeien en bevelen Shortclips aan, omdat ik hun content, planning en resultaten volledig in handen heb.",
  kerntaak: "Ik ben eigenaar van mijn eigen klanten, van strategie en scripting tot publicatie, resultaten en rapportage. Iedere klant heeft één eindverantwoordelijke.",
  resultaat: "Klanten blijven tevreden en verlengen hun samenwerking.",
  klaarAls: [
    "Klanten ontvangen de afgesproken hoeveelheid content.",
    "De content wordt volgens planning geleverd.",
    "Scripts en video's voldoen aan de afgesproken kwaliteit.",
    "Klantvragen worden tijdig beantwoord.",
    "Resultaten worden structureel geanalyseerd.",
    "Slecht presterende content leidt tot concrete verbeteracties.",
    "Klanten weten wat Shortclips voor hen doet.",
    "Klanten blijven tevreden en verlengen hun samenwerking.",
  ],
  taken: [
    {
      titel: "Iedere dag",
      punten: [
        "Klantvragen dezelfde werkdag beantwoorden.",
        "De eigen klanten en hun voortgang controleren.",
        "Scripts en editingstatus bewaken.",
        "Video's controleren voordat deze naar klanten gaan.",
        "Publicaties en contentplanning controleren.",
        "Openstaande feedback opvolgen.",
        "De Vandaagpagina afwerken.",
        "Problemen zelfstandig oplossen of tijdig bespreken.",
      ],
    },
  ],
  signaleren: [
    "Een klant is langer dan tien werkdagen stil.",
    "Een editor loopt achter.",
    "Een opnamedag staat nog niet gepland.",
    "Een script of video dreigt te laat te komen.",
    "Klantresultaten dalen.",
    "Een klant toont weinig betrokkenheid.",
    "Een contract loopt binnen zestig dagen af.",
    "Een klant is mogelijk ontevreden.",
  ],
  scenarios: [
    {
      situatie: "Klantresultaten dalen twee maanden achter elkaar",
      eigenaar: "Content Creative van de klant",
      actie: "Resultaten analyseren, oorzaken onderzoeken, verbeterplan maken en bespreken met de klant.",
      voorkomen: "Automatische signalering bij structurele daling en een verplicht onderdeel 'Wat we veranderen' in de maandrapportage.",
      niveau: "Zelf oplossen en vastleggen. Intern overleggen als dat nodig is.",
      voorstel: false,
    },
    {
      situatie: "Een video dreigt te laat opgeleverd te worden",
      eigenaar: "Content Creative van de klant",
      actie: "Editor aanspreken, zo nodig een andere editor inzetten via de Editor database en de klant vooraf informeren.",
      voorkomen: "De statuscheck halverwege de editor deadline en dagelijks de Editingpagina nalopen.",
      niveau: "Zelf oplossen. Een deadline tot twee werkdagen verschuiven leg je vast. Meer dan twee werkdagen gaat naar Jarno.",
      voorstel: true,
    },
    {
      situatie: "Een video presteert duidelijk slechter dan normaal",
      eigenaar: "Content Creative van de klant",
      actie: "Oorzaak zoeken in Resultaten en het Contentgeheugen, de les vastleggen en de volgende scripts aanpassen.",
      voorkomen: "Bij ieder nieuw script het Contentgeheugen van de klant gebruiken.",
      niveau: "Zelf oplossen.",
      voorstel: true,
    },
    {
      situatie: "Een klant is (mogelijk) ontevreden",
      eigenaar: "Content Creative van de klant",
      actie: "Dezelfde werkdag contact opnemen, de oorzaak achterhalen, een oplossing voorstellen en dit vastleggen bij de klant.",
      voorkomen: "Vaste evaluatiegesprekken en feedback direct opvolgen.",
      niveau: "Zelf oplossen en vastleggen. Wil de klant stoppen of komt de samenwerking ernstig onder druk, dan naar Jarno met een eigen voorstel.",
      voorstel: true,
    },
    {
      situatie: "Een contract loopt binnen zestig dagen af",
      eigenaar: "Content Creative van de klant",
      actie: "Verlenging voorbereiden, voorstel doen en opvolgen volgens het verlengingsproces.",
      voorkomen: "De verlengingssignalen in Aandachtspunten direct oppakken.",
      niveau: "Zelf oplossen. Korting boven 5%, een afwijkende prijs of een contractwijziging gaat naar Jarno.",
      voorstel: true,
    },
    {
      situatie: "Een script is niet op tijd klaar voor de opnamedag",
      eigenaar: "Content Creative van de klant",
      actie: "Script afronden of de klant direct om akkoord vragen, en de videograaf informeren over de stand.",
      voorkomen: "Scripts uiterlijk 7 werkdagen vóór de draaidag gereed.",
      niveau: "Zelf oplossen. Een opnamedatum verplaatsen binnen de annuleringsregeling leg je vast.",
      voorstel: true,
    },
  ],
  kpis: [
    {
      id: "scripts",
      titel: "Scripts op tijd",
      norm: "Uiterlijk 7 werkdagen vóór de draaidag definitief",
      grenzen: "Groen: alle opnames binnen 7 werkdagen hebben een definitief script. Oranje: 1 zonder. Rood: 2 of meer zonder.",
    },
    {
      id: "klantvragen",
      titel: "Klantvragen binnen 1 werkdag",
      norm: "Reactie binnen 1 werkdag, streven dezelfde werkdag",
      grenzen: "Nog niet te bepalen: er is geen meting.",
      registratie: "Klantcontact loopt via WhatsApp en wordt niet in het portaal geregistreerd. Minimaal nodig: per klant de datum van het laatste contact bijhouden (het veld bestaat al op de klant, maar wordt nog niet gevuld).",
    },
    {
      id: "videos",
      titel: "Video's op tijd opgeleverd",
      norm: "Eerste versie uiterlijk 14 werkdagen na de opnamedag",
      grenzen: "Groen: 95% of meer op tijd. Oranje: 85 tot 95%. Rood: onder 85%. Gemeten over de laatste 30 dagen.",
    },
    {
      id: "publicaties",
      titel: "Publicaties buiten planning",
      norm: "Alles volgens de contentplanning gepubliceerd",
      grenzen: "Groen: 0 geplande publicaties niet geplaatst. Oranje: 1 of 2. Rood: 3 of meer. Gemeten over de laatste 30 dagen.",
    },
    {
      id: "rapportages",
      titel: "Maandrapportages te laat",
      norm: "Iedere maand op tijd gecontroleerd en verstuurd",
      grenzen: "Groen: 0 te laat. Oranje: 1 of 2. Rood: 3 of meer.",
    },
  ],
  lijstTitel: "Mijn klanten",
};

const VIDEOGRAAF: Rol = {
  key: "videograaf",
  verantwoordelijkVoor: "mijn opnamedagen, de voorbereiding, de beeldkwaliteit en de overdracht naar de editor",
  missie: "Elke opnamedag levert alles op wat de editor nodig heeft voor sterke video's, zonder herstelwerk en zonder dat Jarno op locatie nodig is.",
  kerntaak: "Ik ben eigenaar van de volledige opnamedag, inclusief productievoorbereiding, regie, beeldkwaliteit en overdracht.",
  resultaat: "Alle geplande video's zijn opgenomen en de editor krijgt een complete overdracht.",
  klaarAls: [
    "Alle geplande video's zijn opgenomen.",
    "Er zijn voldoende bruikbare beelden gemaakt.",
    "Geluid, belichting en compositie zijn goed.",
    "De scripts zijn volledig uitgevoerd.",
    "Er is voldoende aanvullend beeldmateriaal.",
    "De editor heeft een complete en duidelijke overdracht.",
    "Heropnames door vermijdbare productiefouten zijn voorkomen.",
  ],
  taken: [
    {
      titel: "Voor de opnamedag",
      punten: [
        "Het draaiboek tijdig doornemen.",
        "Scripts en benodigde beelden controleren.",
        "Apparatuur controleren.",
        "Locatie en planning beoordelen.",
        "Ontbrekende informatie tijdig signaleren.",
      ],
    },
    {
      titel: "Tijdens de opnamedag",
      punten: [
        "Zelfstandig de regie nemen.",
        "Presentatoren begeleiden.",
        "Beeldkwaliteit en geluid controleren.",
        "Creatief meedenken over sterkere shots.",
        "Alle benodigde beelden opnemen.",
        "Zelfstandig problemen oplossen.",
      ],
    },
    {
      titel: "Na de opnamedag",
      punten: [
        "Beeldmateriaal correct overdragen.",
        "Beste takes en bijzonderheden aangeven.",
        "Editors voorzien van voldoende context.",
        "De opnamedag administratief afronden.",
      ],
    },
  ],
  signaleren: [
    "Een script is onduidelijk.",
    "Een locatie is ongeschikt.",
    "Een presentator is niet voorbereid.",
    "Er ontbreekt informatie voor de opnamedag.",
  ],
  scenarios: [
    {
      situatie: "Een script is onduidelijk vóór de opnamedag",
      eigenaar: "Videograaf signaleert, de Content Creative van de klant lost het op",
      actie: "Direct melden bij de Content Creative, met wat er onduidelijk is en wat je nodig hebt.",
      voorkomen: "Het draaiboek tijdig doornemen, niet pas op locatie.",
      niveau: "Intern overleggen.",
      voorstel: true,
    },
    {
      situatie: "Na de opnamedag blijken beelden te ontbreken",
      eigenaar: "Videograaf",
      actie: "Direct melden bij de Content Creative en een oplossing voorstellen: bestaand materiaal, een alternatief shot of een heropname.",
      voorkomen: "Het draaiboek op locatie per video afvinken voordat je vertrekt.",
      niveau: "Intern overleggen. Een toezegging over een extra draaidag gaat naar Jarno.",
      voorstel: true,
    },
    {
      situatie: "De locatie is ongeschikt of de presentator is niet voorbereid",
      eigenaar: "Videograaf",
      actie: "Op locatie zelf oplossen: andere plek, andere volgorde of de presentator kort voorbereiden. Daarna melden wat er speelde.",
      voorkomen: "Locatie en planning vooraf beoordelen en ontbrekende informatie tijdig signaleren.",
      niveau: "Zelf oplossen en vastleggen.",
      voorstel: true,
    },
    {
      situatie: "Technisch probleem met beeld, geluid of apparatuur",
      eigenaar: "Videograaf",
      actie: "Op locatie oplossen met reserveapparatuur of een andere opzet. Is materiaal onbruikbaar, direct melden.",
      voorkomen: "Apparatuur vóór iedere opnamedag controleren.",
      niveau: "Zelf oplossen. Grote schade aan of diefstal van apparatuur direct melden bij Jarno.",
      voorstel: true,
    },
  ],
  kpis: [
    {
      id: "draaiboeken",
      titel: "Scripts compleet vóór de opnamedag",
      norm: "Iedere opname heeft vooraf een definitief script",
      grenzen: "Groen: alle opnames binnen 7 werkdagen hebben een definitief script. Oranje: 1 zonder. Rood: 2 of meer zonder.",
    },
    {
      id: "afgerond",
      titel: "Opnamedagen volledig afgerond",
      norm: "Alle geplande video's opgenomen",
      grenzen: "Groen: 100% volledig afgerond. Oranje: 90 tot 100%. Rood: onder 90%. Gemeten over de laatste 30 dagen.",
      registratie: "Wordt gemeten via het Videograaf Draaiboek (afgerond of afgerond met open punten). Er zijn nog geen draaiboeken afgerond, dus er is nog geen meting.",
    },
    {
      id: "overdracht",
      titel: "Overdracht op tijd",
      norm: "Binnen 24 uur na de draaidag, compleet",
      grenzen: "Nog niet te bepalen: er is geen meting.",
      registratie: "Het moment van overdracht wordt niet geregistreerd. Minimaal nodig: één knop 'Beeldmateriaal overgedragen' per opname.",
    },
    {
      id: "heropnames",
      titel: "Heropnames door technische fouten",
      norm: "Zo weinig mogelijk",
      grenzen: "Nog niet te bepalen: er is geen meting.",
      registratie: "Heropnames worden niet geregistreerd. Minimaal nodig: per opname een keuze 'Heropname' met reden.",
    },
    {
      id: "ontbrekend",
      titel: "Ontbrekende beelden gemeld door editors",
      norm: "Zo weinig mogelijk",
      grenzen: "Nog niet te bepalen: er is geen meting.",
      registratie: "Editors kunnen ontbrekende beelden nog niet melden. Minimaal nodig: één keuzeknop per opname op de Editingpagina.",
    },
  ],
  lijstTitel: "Mijn opnamedagen",
};

const PER_EMAIL: Record<string, Rol> = {
  "milou@shortclips.nl": CC,
  "jiska@shortclips.nl": CC,
  "rutger@shortclips.nl": VIDEOGRAAF,
};

export function rolVoor(email: string | null | undefined): Rol | null {
  return PER_EMAIL[(email ?? "").toLowerCase()] ?? null;
}

/** De vier niveaus van verantwoordelijkheid, in vaste volgorde. */
export type NiveauKey = "zelf" | "vastleggen" | "overleg" | "jarno";
export const VIER_NIVEAUS: { key: NiveauKey; titel: string; uitleg: string; kleur: "groen" | "oranje" | "rood" }[] = [
  { key: "zelf", titel: "Zelf oplossen", uitleg: "Dit handel je zelfstandig af binnen de gemaakte afspraken.", kleur: "groen" },
  { key: "vastleggen", titel: "Zelf oplossen en vastleggen", uitleg: "Je lost het zelf op en legt de actie of beslissing vast in het portaal.", kleur: "groen" },
  { key: "overleg", titel: "Intern overleggen", uitleg: "Stem af met een collega of de verantwoordelijke in het team. Nog geen toezegging aan de klant.", kleur: "oranje" },
  { key: "jarno", titel: "Naar Jarno", uitleg: "Alleen als er echt een beslissing van Jarno nodig is. Kom met een eigen voorstel.", kleur: "rood" },
];

const VASTLEGGEN = /\s*\((?:reden\s+)?vastleggen\)\s*$/i;
/** Hoort een bevoegdheid bij "zelf oplossen en vastleggen"? (Kennisbank: niveau 2.) */
export const moetVastleggen = (tekst: string): boolean => VASTLEGGEN.test(tekst.replace(/\[\[|\]\]/g, ""));
/** De bevoegdheid zonder het achtervoegsel "(vastleggen)". */
export const zonderVastleggen = (tekst: string): string => tekst.replace(/\s*\((?:reden\s+)?vastleggen\)(\]\])?\s*$/i, "$1");
