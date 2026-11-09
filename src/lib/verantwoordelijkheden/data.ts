/**
 * Mijn verantwoordelijkheden: types en het voorstel waarmee de pagina start.
 *
 * Het voorstel komt uit de opdracht van Jarno (nov 2026), aangevuld met wat al
 * in het portaal vastligt: de Beslissingshulp (grenzen en bevoegdheden), de
 * vaste vervangingskoppels (Milou en Jiska vervangen elkaar) en de levertermijn
 * van 14 werkdagen. Tekst tussen [[...]] is een voorstel dat Jarno nog
 * bevestigt: het team ziet het als gewone tekst, de eigenaar ziet het gemarkeerd.
 *
 * Zodra Jarno in Beheer opslaat, staat de verdeling in app_settings en is dit
 * bestand alleen nog de terugvaloptie ("terug naar voorstel").
 */

export type Niveau = "zelf" | "overleg" | "escaleren";
export type Frequentie = "dagelijks" | "wekelijks" | "maandelijks";
/** Zelfde indeling als het werkoverzicht op Vandaag; "alle" = alles van die persoon. */
export type Categorie = "klantcontact" | "scripting" | "opname" | "editing" | "publicatie" | "intern" | "alle";

export type Koppeling = { href: string; label: string; categorie: Categorie | null };

export type Verantwoordelijkheid = {
  id: string;
  persoon: string;
  titel: string;
  wat: string;
  wanneer: string;
  verwachting: string;
  afgerond: string;
  betrokken: string[];
  bevoegdheden: string[];
  escalatie: string;
  vervanger: string | null;
  actief: boolean;
  koppeling: Koppeling | null;
};

export type Beslissing = { id: string; persoon: string; situatie: string; niveau: Niveau; actief: boolean };
export type Controle = { id: string; persoon: string; frequentie: Frequentie; titel: string; koppeling: Koppeling | null; actief: boolean };
export type Afwezigheid = { doorloopt: string[]; beslisser: string; vervanger: string | null };

export type Config = {
  versie: 1;
  status: "concept" | "goedgekeurd";
  goedgekeurdOp: string | null;
  bijgewerktOp: string | null;
  verantwoordelijkheden: Verantwoordelijkheid[];
  beslissingen: Beslissing[];
  controles: Controle[];
  afwezigheid: Record<string, Afwezigheid>;
  openPunten: string[];
};

export const MEDEWERKERS = [
  { email: "milou@shortclips.nl", naam: "Milou", functie: "Content Creative" },
  { email: "jiska@shortclips.nl", naam: "Jiska", functie: "Content Creative" },
  { email: "rutger@shortclips.nl", naam: "Rutger", functie: "Head of Content" },
  { email: "nynke@shortclips.nl", naam: "Nynke", functie: "Presentatrice" },
  { email: "quinn@shortclips.nl", naam: "Quinn", functie: "Short Video Creative" },
  { email: "fabian@shortclips.nl", naam: "Fabian", functie: "Short Video Creative" },
  { email: "sem@shortclips.nl", naam: "Sem", functie: "Short Video Creative" },
  { email: "max@shortclips.nl", naam: "Max", functie: "Brand Designer" },
] as const;

export const NIVEAUS: Record<Niveau, { label: string; kort: string; uitleg: string }> = {
  zelf: { label: "Zelf oplossen", kort: "Groen", uitleg: "Geen overleg nodig." },
  overleg: { label: "Overleggen met Jarno", kort: "Oranje", uitleg: "Alleen als het buiten je bevoegdheid valt. Kom met een voorstel." },
  escaleren: { label: "Direct escaleren", kort: "Rood", uitleg: "Urgent en met grote gevolgen. Bel Jarno direct." },
};

export const FREQUENTIES: { key: Frequentie; label: string }[] = [
  { key: "dagelijks", label: "Dagelijks" },
  { key: "wekelijks", label: "Wekelijks" },
  { key: "maandelijks", label: "Maandelijks" },
];

/** Pagina's in het portaal waar een verantwoordelijkheid of controle aan kan hangen. */
export const KOPPELINGEN: Koppeling[] = [
  { href: "/dashboard", label: "Vandaag", categorie: "alle" },
  { href: "/kwaliteit", label: "Aandachtspunten", categorie: "klantcontact" },
  { href: "/tasks", label: "Taken", categorie: "intern" },
  { href: "/clients", label: "Klanten", categorie: "klantcontact" },
  { href: "/planning", label: "Weekplanning", categorie: null },
  { href: "/scripting", label: "Scripting", categorie: "scripting" },
  { href: "/calendar", label: "Contentplanning", categorie: "publicatie" },
  { href: "/productions", label: "Opnames", categorie: "opname" },
  { href: "/videos", label: "Editing", categorie: "editing" },
  { href: "/analytics", label: "Resultaten", categorie: null },
  { href: "/analytics/maandrapportages", label: "Maandrapportages", categorie: null },
];
const K = (href: string): Koppeling => KOPPELINGEN.find((k) => k.href === href) ?? { href, label: href, categorie: null };

const MI = "milou@shortclips.nl";
const JI = "jiska@shortclips.nl";
const RU = "rutger@shortclips.nl";
const NY = "nynke@shortclips.nl";
const QU = "quinn@shortclips.nl";
const FA = "fabian@shortclips.nl";
const SE = "sem@shortclips.nl";
const MA = "max@shortclips.nl";

const v = (p: Omit<Verantwoordelijkheid, "actief">): Verantwoordelijkheid => ({ ...p, actief: true });

/** De drie Short Video Creatives (Quinn, Fabian, Sem) delen dezelfde rol:
 *  draaien, monteren en netjes aanleveren. Specifieke grenzen staan als voorstel. */
const svc = (p: string): Verantwoordelijkheid[] => {
  const k = p.split("@")[0];
  return [
    v({ id: `${k}-draaien`, persoon: p, titel: "Shorts draaien volgens het draaiplan",
      wat: "Op de opnamedag de shorts opnemen volgens script en draaiplan, met goede kwaliteit van beeld en geluid.",
      wanneer: "Op elke geplande opnamedag",
      verwachting: "Gemiddeld minimaal [[8 kwalitatieve shorts]] per opnamedag, bruikbaar voor de montage.",
      afgerond: "Alle geplande shorts en extra beelden zijn opgenomen en gecontroleerd.",
      betrokken: [RU], bevoegdheden: ["Scripts ter plekke klein aanpassen voor een beter resultaat", "[[Tot 1 uur]] uitlopen als de kwaliteit dat vraagt"],
      escalatie: "Een technisch probleem met grote gevolgen voor de klant.", vervanger: null, koppeling: K("/productions") }),
    v({ id: `${k}-monteren`, persoon: p, titel: "Shorts monteren en opleveren",
      wat: "Toegewezen shorts monteren volgens de Editing Guide van de klant en op tijd opleveren.",
      wanneer: "Video's binnen 14 werkdagen na de opname",
      verwachting: "Geen video gaat door die je zelf niet zou publiceren.",
      afgerond: "Video gemonteerd, gecontroleerd en klaar voor de interne goedkeuring.",
      betrokken: [RU, MI], bevoegdheden: ["Montagekeuzes maken binnen de Editing Guide", "[[Een revisie zelf verwerken]]"],
      escalatie: "Een deadline dreigt niet gehaald te worden.", vervanger: null, koppeling: K("/videos") }),
    v({ id: `${k}-aanleveren`, persoon: p, titel: "Materiaal en projectbestanden netjes aanleveren",
      wat: "Ruw materiaal en projectbestanden in de juiste map zetten zodat niets kwijtraakt.",
      wanneer: "Binnen [[1 werkdag]] na de opname of oplevering",
      verwachting: "Collega's kunnen altijd verder zonder iets na te vragen.",
      afgerond: "Materiaal en bestanden staan op de juiste plek in het portaal.",
      betrokken: [RU], bevoegdheden: ["Bepalen hoe je het materiaal ordent"],
      escalatie: "Materiaal is kwijt of beschadigd.", vervanger: null, koppeling: K("/videos") }),
  ];
};

const VERANTWOORDELIJKHEDEN: Verantwoordelijkheid[] = [
  // ---------------- Milou ----------------
  v({ id: "mi-voortgang", persoon: MI, titel: "Productievoortgang bewaken",
    wat: "Per klant bijhouden of scripts, opnames, edits en publicaties op schema lopen.",
    wanneer: "Elke werkdag bij de dagstart",
    verwachting: "Je ziet een vertraging voordat de klant hem merkt en lost hem zelf op.",
    afgerond: "Geen te late punten meer open op Vandaag en Aandachtspunten.",
    betrokken: [JI, RU], bevoegdheden: ["Planning en volgorde van werk aanpassen", "Werk tussen editors herverdelen"],
    escalatie: "Een vertraging raakt meerdere klanten tegelijk.", vervanger: JI, koppeling: K("/dashboard") }),
  v({ id: "mi-scripts", persoon: MI, titel: "Scripts en klantfeedback controleren",
    wat: "Scripts controleren voordat ze naar de klant gaan en feedback verwerken.",
    wanneer: "Zodra een script klaar is; feedback binnen [[1 werkdag]]",
    verwachting: "De klant krijgt alleen scripts die passen bij de strategie en de afspraken.",
    afgerond: "Script goedgekeurd door de klant en de nieuwste versie staat in het portaal.",
    betrokken: [JI], bevoegdheden: ["Scripts aanpassen, toevoegen of schrappen tot de opname", "Strategie per klant bijsturen"],
    escalatie: "De klant is het structureel oneens met de aanpak.", vervanger: JI, koppeling: K("/scripting") }),
  v({ id: "mi-deadlines", persoon: MI, titel: "Deadlines van scripts, video's en content",
    wat: "Bewaken dat elke deadline wordt gehaald, van script tot publicatie.",
    wanneer: "Dagelijks",
    verwachting: "Video's worden binnen 14 werkdagen na de opname geleverd.",
    afgerond: "Alles is op of voor de deadline bij de klant.",
    betrokken: [JI, RU], bevoegdheden: ["Een deadline tot [[2 werkdagen]] verschuiven", "Een deadline verschuiven door late aanlevering van de klant"],
    escalatie: "Een deadline schuift meer dan [[2 werkdagen]] en de klant wil compensatie.", vervanger: JI, koppeling: K("/videos") }),
  v({ id: "mi-afstemming", persoon: MI, titel: "Afstemming met editors en klanten",
    wat: "Editors briefen, vragen beantwoorden en klanten op de hoogte houden.",
    wanneer: "Doorlopend, vragen van editors binnen [[1 werkdag]]",
    verwachting: "Editors kunnen door zonder te wachten op informatie.",
    afgerond: "Geen open vragen van editors of klanten.",
    betrokken: [JI, RU], bevoegdheden: ["Een freelancer inzetten binnen de begroting", "Revisies inplannen en bundelen"],
    escalatie: "Extra kosten boven [[€250]] of buiten de begroting.", vervanger: JI, koppeling: K("/videos") }),
  v({ id: "mi-kwaliteit", persoon: MI, titel: "Kwaliteit van video's controleren",
    wat: "Controleren of video's voldoen aan de kwaliteitseisen en de Editing Guide van de klant.",
    wanneer: "Voordat een video naar de klant gaat",
    verwachting: "Geen video gaat naar de klant die je zelf niet zou publiceren.",
    afgerond: "Video goedgekeurd en klaar voor levering.",
    betrokken: [RU], bevoegdheden: ["Correcties aanvragen bij de editor", "[[1 extra feedbackronde per klant per kwartaal]]"],
    escalatie: "Een kwaliteitsprobleem komt bij dezelfde editor steeds terug.", vervanger: JI, koppeling: K("/videos") }),
  v({ id: "mi-planning", persoon: MI, titel: "Contentplanning en publicaties",
    wat: "Bewaken dat de contentplanning klopt en video's op tijd worden gepubliceerd.",
    wanneer: "Wekelijks",
    verwachting: "Er staat altijd een gevulde planning voor de komende weken.",
    afgerond: "Video's staan ingepland of gepubliceerd volgens afspraak.",
    betrokken: [JI], bevoegdheden: ["Publicatiedata aanpassen", "Video's binnen de looptijd doorschuiven, [[maximaal 1 maand]]"],
    escalatie: "Video's schuiven door tot na het einde van het contract.", vervanger: JI, koppeling: K("/calendar") }),
  v({ id: "mi-klantinfo", persoon: MI, titel: "Klanten tijdig informeren",
    wat: "Klanten vooraf laten weten wat er komt en wanneer, ook bij vertraging.",
    wanneer: "Bij elke stap in de flow en bij elke vertraging",
    verwachting: "Een klant hoeft nooit zelf te vragen waar iets blijft.",
    afgerond: "De klant weet wat de volgende stap is en wanneer.",
    betrokken: [JI], bevoegdheden: ["Klantvragen over status, resultaten en strategie beantwoorden", "Een extra adviesgesprek tot [[30 minuten]]"],
    escalatie: "Een ernstige klacht die je niet zelf oplost.", vervanger: JI, koppeling: K("/clients") }),

  // ---------------- Jiska ----------------
  v({ id: "ji-coordinatie", persoon: JI, titel: "Dagelijkse projectcoördinatie",
    wat: "Je eigen klanten dagelijks door de flow sturen: script, opname, edit, publicatie.",
    wanneer: "Elke werkdag bij de dagstart",
    verwachting: "Je weet bij elke klant wat de volgende stap is en wie hem zet.",
    afgerond: "Geen te late punten meer open op Vandaag.",
    betrokken: [MI, RU], bevoegdheden: ["Planning en deadlines binnen de looptijd verschuiven"],
    escalatie: "Een klantprobleem dat niet via het normale proces op te lossen is.", vervanger: MI, koppeling: K("/dashboard") }),
  v({ id: "ji-klantcommunicatie", persoon: JI, titel: "Klantcommunicatie opvolgen",
    wat: "Berichten en vragen van klanten beantwoorden en afspraken nakomen.",
    wanneer: "Klantberichten binnen [[1 werkdag]]",
    verwachting: "Elke klant krijgt snel een duidelijk antwoord in de Shortclips-stijl.",
    afgerond: "Geen onbeantwoorde klantvragen.",
    betrokken: [MI], bevoegdheden: ["Klantvragen over status, resultaten en strategie beantwoorden", "Een klant op oranje zetten"],
    escalatie: "Escalaties waarbij de bestaande afspraken niet voldoende zijn.", vervanger: MI, koppeling: K("/clients") }),
  v({ id: "ji-feedback", persoon: JI, titel: "Openstaande klantfeedback bewaken",
    wat: "Feedback op scripts en video's verzamelen, uitzetten en afronden.",
    wanneer: "Dagelijks",
    verwachting: "Feedback ligt nooit langer dan [[2 werkdagen]] stil.",
    afgerond: "Feedback verwerkt en de klant heeft de nieuwe versie.",
    betrokken: [MI], bevoegdheden: ["Correcties inplannen bij de editor", "Revisies bundelen"],
    escalatie: "De klant wil structureel meer feedbackrondes dan afgesproken.", vervanger: MI, koppeling: K("/kwaliteit") }),
  v({ id: "ji-planning", persoon: JI, titel: "Productie en contentplanning bijhouden",
    wat: "Opnames, edits en publicaties van je klanten actueel houden in het portaal.",
    wanneer: "Wekelijks en na elke wijziging",
    verwachting: "Wat in het portaal staat, klopt met wat er echt gebeurt.",
    afgerond: "Planning voor de komende weken is compleet.",
    betrokken: [MI, RU], bevoegdheden: ["Publicatiedata aanpassen", "Opnames verplaatsen zolang er geen kosten zijn gemaakt"],
    escalatie: "Grote afwijking van de afgesproken dienstverlening.", vervanger: MI, koppeling: K("/calendar") }),
  v({ id: "ji-afspraken", persoon: JI, titel: "Afspraken correct in het portaal",
    wat: "Controleren of pakket, aantallen, deadlines en contactpersonen kloppen.",
    wanneer: "Bij een nieuwe klant en daarna [[maandelijks]]",
    verwachting: "Iedereen kan op het portaal vertrouwen zonder het na te vragen.",
    afgerond: "Klantgegevens gecontroleerd en bijgewerkt.",
    betrokken: [MI], bevoegdheden: ["Klantgegevens en planning aanpassen"],
    escalatie: "Afspraken in het portaal wijken af van het contract.", vervanger: MI, koppeling: K("/clients") }),
  v({ id: "ji-levering", persoon: JI, titel: "Scripts en video's tijdig bij de klant",
    wat: "Zorgen dat scripts en video's op de afgesproken datum bij de klant zijn.",
    wanneer: "Video's binnen 14 werkdagen na de opname",
    verwachting: "Geen levering zonder dat de klant vooraf weet wanneer hij komt.",
    afgerond: "Klant heeft de scripts of video's ontvangen.",
    betrokken: [MI, RU], bevoegdheden: ["Een deadline tot [[2 werkdagen]] verschuiven"],
    escalatie: "De klant protesteert of wil compensatie.", vervanger: MI, koppeling: K("/scripting") }),
  v({ id: "ji-opvolgen", persoon: JI, titel: "Ontbrekende informatie en blijvende taken",
    wat: "Signaleren wat ontbreekt (briefing, materiaal, akkoord) en taken opvolgen die blijven liggen.",
    wanneer: "Dagelijks",
    verwachting: "Niets blijft liggen omdat iemand op informatie wacht.",
    afgerond: "Ontbrekende informatie is binnen en de taak is afgerond.",
    betrokken: [MI, RU], bevoegdheden: ["Taken toewijzen en herinneren"],
    escalatie: "Een klant levert structureel niet aan en de productie stopt.", vervanger: MI, koppeling: K("/tasks") }),

  // ---------------- Rutger ----------------
  v({ id: "ru-voorbereiding", persoon: RU, titel: "Voorbereiding van opnames",
    wat: "Scripts, shotlist, locatie en planning van de opnamedag rond hebben.",
    wanneer: "Uiterlijk [[2 werkdagen]] voor de opname",
    verwachting: "Je komt nooit onvoorbereid op locatie.",
    afgerond: "Draaiplan klaar en afgestemd met de Content Creative.",
    betrokken: [MI, JI], bevoegdheden: ["Volgorde en aanpak van de opname bepalen"],
    escalatie: "De opname kan niet volgens afspraak doorgaan en dat heeft grote gevolgen.", vervanger: null, koppeling: K("/productions") }),
  v({ id: "ru-apparatuur", persoon: RU, titel: "Camera, geluid, belichting en apparatuur",
    wat: "Apparatuur controleren, opladen en compleet meenemen.",
    wanneer: "De dag voor elke opname",
    verwachting: "Geen opname loopt vast op apparatuur.",
    afgerond: "Checklist apparatuur afgevinkt.",
    betrokken: [], bevoegdheden: ["Kleine vervanging of reparatie binnen de begroting"],
    escalatie: "Kostbare schade aan apparatuur.", vervanger: null, koppeling: K("/productions") }),
  v({ id: "ru-kwaliteit", persoon: RU, titel: "Kwaliteit tijdens de opname",
    wat: "Bewaken van beeld, geluid en licht en dat alle benodigde beelden er zijn.",
    wanneer: "Tijdens elke opname",
    verwachting: "Gemiddeld minimaal 8 kwalitatieve shorts per opnamedag.",
    afgerond: "Alle scripts en extra beelden zijn opgenomen en gecontroleerd.",
    betrokken: [MI, JI], bevoegdheden: ["Scripts ter plekke aanpassen", "Tot [[1 uur]] uitlopen", "Minder video's opnemen als de kwaliteit anders lijdt"],
    escalatie: "Een technisch probleem met grote gevolgen voor de klant.", vervanger: null, koppeling: K("/productions") }),
  v({ id: "ru-videografen", persoon: RU, titel: "Voorbereiding van de videografen",
    wat: "[[Andere videografen]] briefen over klant, script en werkwijze.",
    wanneer: "Voor elke opname die je niet zelf doet",
    verwachting: "Een andere videograaf levert dezelfde kwaliteit als jij.",
    afgerond: "Videograaf heeft draaiplan, scripts en aandachtspunten.",
    betrokken: [MI, JI], bevoegdheden: ["Bepalen welke instructies een videograaf meekrijgt"],
    escalatie: "Er is geen videograaf beschikbaar voor een geplande opname.", vervanger: null, koppeling: K("/productions") }),
  v({ id: "ru-proces", persoon: RU, titel: "Opnameproces organiseren en bewaken",
    wat: "De opnamedagen plannen, de dag leiden en problemen direct signaleren.",
    wanneer: "Wekelijks plannen, op de dag zelf leiden",
    verwachting: "Een opnamedag verloopt volgens plan, ook als er iets misgaat.",
    afgerond: "Opname afgerond en problemen gemeld in het portaal.",
    betrokken: [MI, JI], bevoegdheden: ["Een opname stoppen bij een onveilige situatie", "Een opname verplaatsen zolang er geen kosten zijn gemaakt"],
    escalatie: "Een extra draaidag of budget is nodig.", vervanger: null, koppeling: K("/planning") }),
  v({ id: "ru-technisch", persoon: RU, titel: "Technische kwaliteit van het materiaal",
    wat: "Controleren of het materiaal scherp, goed belicht en goed verstaanbaar is.",
    wanneer: "Direct na elke opname",
    verwachting: "Editors krijgen alleen bruikbaar materiaal.",
    afgerond: "Materiaal gecontroleerd en problemen opgelost of gemeld.",
    betrokken: [], bevoegdheden: ["Een korte heropname plannen binnen de afspraak"],
    escalatie: "Materiaal is onbruikbaar en een nieuwe opname kost geld.", vervanger: null, koppeling: K("/videos") }),
  v({ id: "ru-overdracht", persoon: RU, titel: "Overdracht van materiaal aan de editors",
    wat: "Materiaal in de juiste map zetten en de editor alles geven wat nodig is.",
    wanneer: "Binnen [[1 werkdag]] na de opname",
    verwachting: "De editor kan direct beginnen zonder iets na te vragen.",
    afgerond: "Materiaal staat klaar en het editingproject staat in het portaal.",
    betrokken: [MI, JI], bevoegdheden: ["Bepalen hoe materiaal wordt aangeleverd"],
    escalatie: "Materiaal is kwijt of beschadigd.", vervanger: null, koppeling: K("/videos") }),

  // ---------------- Nynke (Presentatrice) ----------------
  v({ id: "ny-presentatie", persoon: NY, titel: "Presentatie voor de camera",
    wat: "De video's presenteren met de juiste energie, toon en boodschap voor de klant.",
    wanneer: "Op elke opname waarop je presenteert",
    verwachting: "De boodschap komt helder en in de stijl van de klant over.",
    afgerond: "Alle scripts zijn overtuigend ingesproken en opgenomen.",
    betrokken: [RU], bevoegdheden: ["De tekst natuurlijker maken zolang de boodschap klopt", "Een extra take vragen voor een beter resultaat"],
    escalatie: "Het script past niet bij jou of de klant en dat raakt de kwaliteit.", vervanger: null, koppeling: K("/productions") }),
  v({ id: "ny-voorbereiding", persoon: NY, titel: "Voorbereiding op de opname",
    wat: "Vooraf het script, de klant en de boodschap doornemen zodat je klaarstaat.",
    wanneer: "Uiterlijk [[1 werkdag]] voor de opname",
    verwachting: "Je staat voorbereid voor de camera, zonder op locatie te hoeven inlezen.",
    afgerond: "Script en aandachtspunten doorgenomen en vragen gesteld.",
    betrokken: [RU, MI], bevoegdheden: ["Vooraf vragen stellen over script en klant"],
    escalatie: "Het script is te laat of onduidelijk om je goed voor te bereiden.", vervanger: null, koppeling: K("/scripting") }),
  v({ id: "ny-afstemming", persoon: NY, titel: "Afstemming met de videograaf",
    wat: "Bij de start van de opnamedag samen de aanpak en volgorde afstemmen.",
    wanneer: "Bij de start van elke opnamedag",
    verwachting: "Presentatie en opname lopen soepel in één lijn.",
    afgerond: "Aanpak afgestemd en de opname kan starten.",
    betrokken: [RU], bevoegdheden: ["De volgorde van opnemen mee bepalen"],
    escalatie: "Onduidelijkheid die de opnamedag ophoudt.", vervanger: null, koppeling: K("/productions") }),

  // ---------------- Max (Brand Designer) ----------------
  v({ id: "ma-huisstijl", persoon: MA, titel: "Visuele huisstijl bewaken",
    wat: "Covers, thumbnails en visuele elementen in de juiste merkstijl per klant maken.",
    wanneer: "Bij elke video- of designvraag",
    verwachting: "Alles wat de klant ziet is consistent en herkenbaar.",
    afgerond: "Design opgeleverd volgens de merkrichtlijnen van de klant.",
    betrokken: [MI, RU], bevoegdheden: ["Designkeuzes maken binnen de merkrichtlijnen", "Een cover of thumbnail laten aanpassen"],
    escalatie: "De gevraagde stijl botst met de merkrichtlijnen van de klant.", vervanger: null, koppeling: K("/videos") }),
  v({ id: "ma-levering", persoon: MA, titel: "Design-aanleveringen op tijd",
    wat: "Gevraagde designs (covers, templates, visuals) op tijd opleveren voor de productie.",
    wanneer: "Binnen de afgesproken deadline per aanvraag",
    verwachting: "De productie loopt nooit vast op ontbrekend design.",
    afgerond: "Design staat klaar op de juiste plek in het portaal.",
    betrokken: [MI], bevoegdheden: ["Volgorde van designaanvragen bepalen binnen de deadlines"],
    escalatie: "Meerdere deadlines botsen en niet alles kan op tijd.", vervanger: null, koppeling: K("/calendar") }),
  v({ id: "ma-richtlijnen", persoon: MA, titel: "Merkrichtlijnen per klant toepassen",
    wat: "De merkrichtlijnen per klant actueel houden en toepassen in alle visuals.",
    wanneer: "Bij een nieuwe klant en bij elke wijziging",
    verwachting: "Iedereen werkt met de juiste, actuele merkstijl.",
    afgerond: "Merkrichtlijnen vastgelegd en toegepast.",
    betrokken: [MI, RU], bevoegdheden: ["Merkrichtlijnen per klant vastleggen en bijwerken"],
    escalatie: "Een klant wil structureel afwijken van de eigen merkrichtlijnen.", vervanger: null, koppeling: K("/clients") }),

  // ---------------- Short Video Creatives (Quinn, Fabian, Sem) ----------------
  ...svc(QU), ...svc(FA), ...svc(SE),
];

let n = 0;
const b = (persoon: string, situatie: string, niveau: Niveau): Beslissing => ({ id: `b${++n}`, persoon, situatie, niveau, actief: true });

const MATRIX_CC: [string, Niveau][] = [
  ["Normale klantvraag", "zelf"],
  ["Kleine wijziging in de planning", "zelf"],
  ["Editor heeft aanvullende informatie nodig", "zelf"],
  ["Video heeft correcties nodig", "zelf"],
  ["Deadline dreigt te verlopen", "zelf"],
  ["Klant heeft een kleine klacht", "zelf"],
  ["Klant wil korting of een andere prijs", "overleg"],
  ["Grote wijziging in contractafspraken", "overleg"],
  ["Beslissing met kosten boven [[€250]]", "overleg"],
  ["Klant wil het contract beëindigen", "overleg"],
  ["Ernstige klacht die je niet zelf oplost", "overleg"],
  ["Ernstige reputatieschade dreigt", "escaleren"],
  ["Datalek of juridisch risico", "escaleren"],
];
const MATRIX_MILOU_EXTRA: [string, Niveau][] = [["Probleem raakt meerdere klanten tegelijk", "overleg"]];
const MATRIX_RU: [string, Niveau][] = [
  ["Opname loopt uit, tot [[1 uur]]", "zelf"],
  ["Script blijkt op locatie niet uitvoerbaar", "zelf"],
  ["Klant is niet klaar bij aankomst", "zelf"],
  ["Apparatuur valt uit, vervanging mogelijk", "zelf"],
  ["Editor mist materiaal", "zelf"],
  ["Onveilige situatie op locatie: opname stoppen", "zelf"],
  ["Extra draaidag of extra budget nodig", "overleg"],
  ["Kostbare schade aan apparatuur", "overleg"],
  ["Technisch probleem met grote gevolgen voor de klant", "overleg"],
  ["Opname kan niet doorgaan en de klant loopt grote schade op", "escaleren"],
  ["Ongeval of letsel tijdens een opname", "escaleren"],
];
const MATRIX_SVC: [string, Niveau][] = [
  ["Script ter plekke klein aanpassen", "zelf"],
  ["Opname loopt uit, [[tot 1 uur]]", "zelf"],
  ["Een revisie zelf verwerken", "zelf"],
  ["Montagekeuze binnen de Editing Guide", "zelf"],
  ["Materiaal mist, heropname op dezelfde dag", "zelf"],
  ["Deadline dreigt niet gehaald te worden", "overleg"],
  ["Extra draaitijd of extra budget nodig", "overleg"],
  ["Klant wil structureel een andere aanpak", "overleg"],
  ["Onveilige situatie op locatie", "escaleren"],
  ["Kostbare schade of onbruikbaar materiaal", "escaleren"],
];
const MATRIX_NY: [string, Niveau][] = [
  ["Tekst natuurlijker maken, boodschap blijft gelijk", "zelf"],
  ["Een extra take vragen", "zelf"],
  ["Kleine aanpassing in de volgorde op de dag", "zelf"],
  ["Script past niet bij de klant of de boodschap", "overleg"],
  ["Script is te laat om je voor te bereiden", "overleg"],
  ["Een afspraak kan niet doorgaan met grote gevolgen", "escaleren"],
];
const MATRIX_MA: [string, Niveau][] = [
  ["Designkeuze binnen de merkrichtlijnen", "zelf"],
  ["Een cover of thumbnail aanpassen", "zelf"],
  ["Volgorde van designaanvragen bepalen", "zelf"],
  ["Meerdere deadlines botsen", "overleg"],
  ["Klant wil afwijken van de merkrichtlijnen", "overleg"],
  ["Een merkbeslissing met grote gevolgen voor de klant", "escaleren"],
];

const BESLISSINGEN: Beslissing[] = [
  ...[...MATRIX_CC.slice(0, 11), ...MATRIX_MILOU_EXTRA, ...MATRIX_CC.slice(11)].map(([s, nv]) => b(MI, s, nv)),
  ...MATRIX_CC.map(([s, nv]) => b(JI, s, nv)),
  ...MATRIX_RU.map(([s, nv]) => b(RU, s, nv)),
  ...MATRIX_NY.map(([s, nv]) => b(NY, s, nv)),
  ...MATRIX_MA.map(([s, nv]) => b(MA, s, nv)),
  ...[QU, FA, SE].flatMap((p) => MATRIX_SVC.map(([s, nv]) => b(p, s, nv))),
];

let c = 0;
const ctl = (persoon: string, frequentie: Frequentie, titel: string, href: string | null): Controle =>
  ({ id: `c${++c}`, persoon, frequentie, titel, koppeling: href ? K(href) : null, actief: true });

const CONTROLES: Controle[] = [
  ctl(MI, "dagelijks", "Dagstart: wat is te laat of vandaag af", "/dashboard"),
  ctl(MI, "dagelijks", "Editing: deadlines en correcties", "/videos"),
  ctl(MI, "wekelijks", "Scriptingstatus per klant", "/scripting"),
  ctl(MI, "wekelijks", "Contentplanning komende weken", "/calendar"),
  ctl(MI, "wekelijks", "Weekplanning opnames en editing", "/planning"),
  ctl(MI, "maandelijks", "Maandrapportages klaar en verstuurd", "/analytics/maandrapportages"),
  ctl(MI, "maandelijks", "Resultaten per klant", "/analytics"),

  ctl(JI, "dagelijks", "Dagstart: wat is te laat of vandaag af", "/dashboard"),
  ctl(JI, "dagelijks", "Openstaande klantfeedback", "/kwaliteit"),
  ctl(JI, "wekelijks", "Contentplanning komende weken", "/calendar"),
  ctl(JI, "wekelijks", "Taken die blijven liggen", "/tasks"),
  ctl(JI, "maandelijks", "Klantafspraken in het portaal", "/clients"),
  ctl(JI, "maandelijks", "Maandrapportages klaar en verstuurd", "/analytics/maandrapportages"),

  ctl(RU, "dagelijks", "Opnames van de komende dagen", "/productions"),
  ctl(RU, "wekelijks", "Weekplanning opnames", "/planning"),
  ctl(RU, "wekelijks", "Apparatuur compleet en opgeladen", null),
  ctl(RU, "wekelijks", "Overdracht materiaal aan editors", "/videos"),
  ctl(RU, "maandelijks", "Gemiddeld aantal shorts per opnamedag", "/productions"),

  ctl(NY, "wekelijks", "Opnames waarop je presenteert", "/productions"),

  ctl(MA, "wekelijks", "Openstaande designaanvragen", "/calendar"),
  ctl(MA, "maandelijks", "Merkrichtlijnen per klant actueel", "/clients"),

  ...[QU, FA, SE].flatMap((p) => [
    ctl(p, "dagelijks", "Opnames en montages van vandaag", "/videos"),
    ctl(p, "wekelijks", "Deadlines van je shorts", "/videos"),
  ]),
];

const AFWEZIGHEID: Record<string, Afwezigheid> = {
  [MI]: {
    doorloopt: [
      "Alle dagelijkse productie, planning, scripts en levering",
      "Feedback, revisies en afstemming met editors",
      "Klantcommunicatie, ook over vertragingen",
      "Facturatie: jij bent de vervanger van Jarno",
    ],
    beslisser: "Jij beslist over oranje zaken voor het hele team [[tot €250]]. Rode zaken gaan naar [[Christian]].",
    vervanger: JI,
  },
  [JI]: {
    doorloopt: [
      "Alle dagelijkse coördinatie van je klanten",
      "Klantcommunicatie en feedback",
      "Planning en levering van scripts en video's",
    ],
    beslisser: "Oranje zaken leg je voor aan Milou. Rode zaken gaan naar [[Christian]].",
    vervanger: MI,
  },
  [RU]: {
    doorloopt: [
      "Alle geplande opnames en de voorbereiding daarvan",
      "Overdracht van materiaal aan de editors",
      "Kleine reparaties en vervanging van apparatuur binnen de begroting",
    ],
    beslisser: "Oranje zaken leg je voor aan Milou. Rode zaken gaan naar [[Christian]].",
    vervanger: null,
  },
  [NY]: {
    doorloopt: ["De geplande opnames waarop je presenteert"],
    beslisser: "Oranje zaken leg je voor aan Rutger. Rode zaken gaan naar [[Christian]].",
    vervanger: null,
  },
  [MA]: {
    doorloopt: ["Lopende designaanvragen en de merkrichtlijnen per klant"],
    beslisser: "Oranje zaken leg je voor aan Milou. Rode zaken gaan naar [[Christian]].",
    vervanger: null,
  },
  [QU]: {
    doorloopt: ["Je geplande opnames en montages", "Overdracht van je materiaal aan collega's"],
    beslisser: "Oranje zaken leg je voor aan Rutger. Rode zaken gaan naar [[Christian]].",
    vervanger: null,
  },
  [FA]: {
    doorloopt: ["Je geplande opnames en montages", "Overdracht van je materiaal aan collega's"],
    beslisser: "Oranje zaken leg je voor aan Rutger. Rode zaken gaan naar [[Christian]].",
    vervanger: null,
  },
  [SE]: {
    doorloopt: ["Je geplande opnames en montages", "Overdracht van je materiaal aan collega's"],
    beslisser: "Oranje zaken leg je voor aan Rutger. Rode zaken gaan naar [[Christian]].",
    vervanger: null,
  },
};

const OPEN_PUNTEN = [
  "Naam: in de opdracht staat Jeska, in het portaal en haar e-mailadres Jiska. De pagina gebruikt Jiska.",
  "Kleuren: in de Beslissingshulp betekent oranje 'zelf oplossen en vastleggen', hier 'overleggen met Jarno' zoals de opdracht vraagt. Kies één betekenis, anders verwart het team.",
  "Rolverdeling: de opdracht maakt Milou projectmanager en Jiska coördinator. In het portaal beheren ze allebei een eigen klantenportfolio en vervangen ze elkaar. Klopt dat Jiska zelfstandig haar eigen klanten houdt?",
  "Korting: de opdracht stuurt alleen een grote prijsaanpassing naar Jarno, de Beslissingshulp elke korting. Hier staat elke korting of prijsafwijking op overleggen.",
  "Rutger: welke videografen bereidt hij voor (Quinn, Fabian, Sam of freelancers)? En wie vervangt Rutger bij afwezigheid? Daar is in het portaal nog niemand voor vastgelegd.",
  "Afwezigheid Jarno: wie beslist dan over rode zaken? Voorstel: Christian. En wie neemt jouw eigen klanten (365werk, Benz Collector, Luxewagen, Marco van Beek, SHADES) waar?",
  "Nieuw team toegevoegd (Nynke, Quinn, Fabian, Sem, Max): hun verantwoordelijkheden zijn een voorstel op basis van de functie. Loop ze na en bevestig of pas aan in Beheer.",
  "Vervangers nieuw team: voor Nynke, Quinn, Fabian, Sem en Max is nog geen vaste vervanger vastgelegd. Wie neemt bij afwezigheid waar?",
  "Alle gele termijnen en bedragen zijn voorstellen. Bevestig of pas aan in Beheer.",
];

export function standaardConfig(): Config {
  return {
    versie: 1,
    status: "concept",
    goedgekeurdOp: null,
    bijgewerktOp: null,
    verantwoordelijkheden: VERANTWOORDELIJKHEDEN.map((x) => ({ ...x, betrokken: [...x.betrokken], bevoegdheden: [...x.bevoegdheden] })),
    beslissingen: BESLISSINGEN.map((x) => ({ ...x })),
    controles: CONTROLES.map((x) => ({ ...x })),
    afwezigheid: Object.fromEntries(Object.entries(AFWEZIGHEID).map(([k, a]) => [k, { ...a, doorloopt: [...a.doorloopt] }])),
    openPunten: [...OPEN_PUNTEN],
  };
}

export const naamVan = (email: string | null | undefined): string =>
  MEDEWERKERS.find((m) => m.email === email)?.naam ?? (email === "jarno@shortclips.nl" ? "Jarno" : email ?? "");

/** Haalt de voorstel-markering weg: wat het team ziet. */
export const kaal = (t: string) => t.replace(/\[\[(.+?)\]\]/g, "$1");

/* ------------------------------------------------------------------ */
/* Controle bij opslaan: alleen bekende velden, begrensde lengtes.      */
/* ------------------------------------------------------------------ */

const str = (x: unknown, max = 400) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const lijst = (x: unknown, max = 20) => (Array.isArray(x) ? x.map((y) => str(y)).filter(Boolean).slice(0, max) : []);
const EMAILS = new Set<string>(MEDEWERKERS.map((m) => m.email));
const persoon = (x: unknown) => { const e = str(x, 120).toLowerCase(); return EMAILS.has(e) ? e : null; };
const CATS = new Set(["klantcontact", "scripting", "opname", "editing", "publicatie", "intern", "alle"]);
const koppeling = (x: unknown): Koppeling | null => {
  const k = x as Partial<Koppeling> | null;
  if (!k || typeof k.href !== "string" || !k.href.startsWith("/")) return null;
  const bekend = KOPPELINGEN.find((y) => y.href === k.href);
  return bekend ?? { href: str(k.href, 120), label: str(k.label, 60) || k.href, categorie: CATS.has(String(k.categorie)) ? (k.categorie as Categorie) : null };
};
const id = (x: unknown, prefix: string) => str(x, 40) || `${prefix}${Math.random().toString(36).slice(2, 9)}`;

export function normaliseer(input: unknown): Config {
  const i = (input ?? {}) as Partial<Config>;
  const basis = standaardConfig();
  const verantwoordelijkheden = (Array.isArray(i.verantwoordelijkheden) ? i.verantwoordelijkheden : basis.verantwoordelijkheden)
    .slice(0, 120)
    .flatMap((r): Verantwoordelijkheid[] => {
      const p = persoon(r.persoon);
      const titel = str(r.titel, 120);
      if (!p || !titel) return [];
      return [{
        id: id(r.id, "v"), persoon: p, titel,
        wat: str(r.wat), wanneer: str(r.wanneer, 200), verwachting: str(r.verwachting), afgerond: str(r.afgerond),
        betrokken: lijst(r.betrokken, 5).map((e) => e.toLowerCase()).filter((e) => EMAILS.has(e) || e === "jarno@shortclips.nl"),
        bevoegdheden: lijst(r.bevoegdheden), escalatie: str(r.escalatie),
        vervanger: persoon(r.vervanger), actief: r.actief !== false, koppeling: koppeling(r.koppeling),
      }];
    });
  const beslissingen = (Array.isArray(i.beslissingen) ? i.beslissingen : basis.beslissingen).slice(0, 200).flatMap((r): Beslissing[] => {
    const p = persoon(r.persoon); const s = str(r.situatie, 160);
    if (!p || !s) return [];
    const nv: Niveau = r.niveau === "overleg" || r.niveau === "escaleren" ? r.niveau : "zelf";
    return [{ id: id(r.id, "b"), persoon: p, situatie: s, niveau: nv, actief: r.actief !== false }];
  });
  const controles = (Array.isArray(i.controles) ? i.controles : basis.controles).slice(0, 120).flatMap((r): Controle[] => {
    const p = persoon(r.persoon); const t = str(r.titel, 120);
    if (!p || !t) return [];
    const f: Frequentie = r.frequentie === "wekelijks" || r.frequentie === "maandelijks" ? r.frequentie : "dagelijks";
    return [{ id: id(r.id, "c"), persoon: p, frequentie: f, titel: t, koppeling: koppeling(r.koppeling), actief: r.actief !== false }];
  });
  const afwezigheid: Record<string, Afwezigheid> = {};
  for (const m of MEDEWERKERS) {
    const a = (i.afwezigheid?.[m.email] ?? basis.afwezigheid[m.email]) as Partial<Afwezigheid> | undefined;
    afwezigheid[m.email] = { doorloopt: lijst(a?.doorloopt), beslisser: str(a?.beslisser, 400), vervanger: persoon(a?.vervanger) };
  }
  return {
    versie: 1,
    status: i.status === "goedgekeurd" ? "goedgekeurd" : "concept",
    goedgekeurdOp: typeof i.goedgekeurdOp === "string" ? i.goedgekeurdOp : null,
    bijgewerktOp: typeof i.bijgewerktOp === "string" ? i.bijgewerktOp : null,
    verantwoordelijkheden, beslissingen, controles, afwezigheid,
    openPunten: Array.isArray(i.openPunten) ? lijst(i.openPunten, 30) : basis.openPunten,
  };
}
