/**
 * Mijn verantwoordelijkheden: types en de standaardverdeling per medewerker.
 *
 * Bron (nov 2026): Kennisbank › Team Shortclips (1.1 t/m 1.14), aangevuld met
 * de leidende afspraken uit Over Shortclips 1.0 (Vaste afspraken 2026),
 * Klanten + communicatie 1.4 (Wie doet wat) en 1.8 (Beslisrechten en de vier
 * escalatieniveaus) en Financiën & administratie 1.1 (Centrale facturatie-SOP).
 * Er staat niets in dat niet in de kennisbank is vastgelegd. Tekst tussen
 * [[...]] is nog niet door Jarno bevestigd: het team ziet het als gewone
 * tekst, de eigenaar ziet het gemarkeerd.
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
export type Kpi = { titel: string; norm: string };
export type Samenwerking = { met: string; wanneer: string };
/** Rol, KPI's en samenwerking per medewerker: de kop van de persoonlijke pagina. */
export type Profiel = { functie: string; doel: string; kpis: Kpi[]; samenwerking: Samenwerking[]; bron: string };

export type Config = {
  versie: 1;
  status: "concept" | "goedgekeurd";
  goedgekeurdOp: string | null;
  bijgewerktOp: string | null;
  verantwoordelijkheden: Verantwoordelijkheid[];
  beslissingen: Beslissing[];
  controles: Controle[];
  afwezigheid: Record<string, Afwezigheid>;
  profielen: Record<string, Profiel>;
  openPunten: string[];
};

/** Functienamen zoals in Kennisbank › Team Shortclips (organigram en KPI-lessen). */
export const MEDEWERKERS = [
  { email: "milou@shortclips.nl", naam: "Milou", functie: "Content Creative & Social Media Manager" },
  { email: "jiska@shortclips.nl", naam: "Jiska", functie: "Content Creative & Social Media Manager" },
  { email: "rutger@shortclips.nl", naam: "Rutger", functie: "Videograaf" },
  { email: "max@shortclips.nl", naam: "Max", functie: "Grafisch Vormgever" },
  { email: "nynke@shortclips.nl", naam: "Nynke", functie: "Freelance Video Presentator" },
  { email: "fabian@shortclips.nl", naam: "Fabian", functie: "Short Video Editor" },
  { email: "noah@shortclips.nl", naam: "Noah", functie: "Short Video Editor" },
  { email: "quinn@shortclips.nl", naam: "Quinn", functie: "Short Video Editor" },
  { email: "sem@shortclips.nl", naam: "Sem", functie: "Short Video Editor" },
  { email: "jarno@shortclips.nl", naam: "Jarno", functie: "Eigenaar - Head of Growth" },
] as const;

/** De cursus Team Shortclips in de kennisbank: de leidende bron voor deze pagina. */
export const KENNISBANK_TEAM = "/kennisbank/b5318393-4660-4d54-965b-50fad0068a61";

/** De vier escalatieniveaus uit Klanten + communicatie 1.8, in drie blokken. */
export const NIVEAUS: Record<Niveau, { label: string; kort: string; uitleg: string }> = {
  zelf: { label: "Zelf beslissen", kort: "Niveau 1 en 2", uitleg: "Niveau 1 en 2. Bij niveau 2 leg je het besluit direct vast in het portaal." },
  overleg: { label: "Eerst intern overleggen", kort: "Niveau 3", uitleg: "Niveau 3. Doe een voorstel en stem af. Nog geen toezegging aan de klant." },
  escaleren: { label: "Altijd naar Jarno", kort: "Niveau 4", uitleg: "Niveau 4. Jarno beslist. Kom altijd met een concreet voorstel." },
};

export const FREQUENTIES: { key: Frequentie; label: string }[] = [
  { key: "dagelijks", label: "Dagelijks" },
  { key: "wekelijks", label: "Wekelijks" },
  { key: "maandelijks", label: "Maandelijks" },
];

/** Pagina's in het portaal waar een verantwoordelijkheid of werkzaamheid aan kan hangen. */
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
const MA = "max@shortclips.nl";
const NY = "nynke@shortclips.nl";
const FA = "fabian@shortclips.nl";
const NO = "noah@shortclips.nl";
const QU = "quinn@shortclips.nl";
const SE = "sem@shortclips.nl";
const JA = "jarno@shortclips.nl";
const EDITORS = [FA, NO, QU, SE];

const v = (p: Omit<Verantwoordelijkheid, "actief">): Verantwoordelijkheid => ({ ...p, actief: true });
const kort = (p: string) => p.split("@")[0];

/* ------------------------------------------------------------------ */
/* Content Creative & Social Media Manager (Milou en Jiska)            */
/* Bron: 1.4 KPI's Content Creative, 1.11/1.12, K+C 1.4 en 1.8, 1.0.   */
/* Beide doen dezelfde functie voor hun eigen klanten.                  */
/* ------------------------------------------------------------------ */
const cc = (p: string, collega: string): Verantwoordelijkheid[] => {
  const k = kort(p);
  return [
    v({ id: `${k}-strategie`, persoon: p, titel: "Contentstrategie per klant",
      wat: "De contentstrategie per klant ontwikkelen en bewaken: formats, invalshoeken, contentpilaren en relevante trends.",
      wanneer: "Doorlopend; minimaal één keer per maand evalueren",
      verwachting: "Resultaten worden vertaald naar nieuwe content. Iedere maand nieuwe contentideeën per klant.",
      afgerond: "Strategie geëvalueerd en de nieuwe ideeën voor de volgende periode liggen klaar.",
      betrokken: [collega], bevoegdheden: ["Contentconcepten, formats en hooks bepalen"],
      escalatie: "", vervanger: collega, koppeling: K("/analytics") }),
    v({ id: `${k}-scripts`, persoon: p, titel: "Scripts schrijven en scriptmeetings",
      wat: "Strategieonderzoek doen, hooks en scripts schrijven, strategie- en scriptmeetings leiden en scriptfeedback verwerken.",
      wanneer: "Scripts uiterlijk 7 werkdagen vóór de draaidag gereed",
      verwachting: "Per script één gebundelde feedbackronde van de klant, via één contactpersoon.",
      afgerond: "Script goedgekeurd door de klant en de nieuwste versie staat in het portaal.",
      betrokken: [collega, RU], bevoegdheden: ["Scripts goedkeuren en versturen"],
      escalatie: "", vervanger: collega, koppeling: K("/scripting") }),
    v({ id: `${k}-planning`, persoon: p, titel: "Planning en opnamedagen",
      wat: "De contentplanning en opnamedagen beheren, deadlines en capaciteit bewaken en gaten in de planning voorkomen.",
      wanneer: "Doorlopend; bij iedere wijziging direct bijwerken in het portaal",
      verwachting: "Alle producties verlopen volgens planning.",
      afgerond: "De planning voor de komende weken is compleet en klopt.",
      betrokken: [collega, RU],
      bevoegdheden: ["Prioriteiten en interne planning aanpassen", "Een opnamedatum verplaatsen binnen de annuleringsregeling", "Een deadline maximaal twee werkdagen verplaatsen (vastleggen)"],
      escalatie: "Afwijken van de annuleringsregeling of een deadline meer dan twee werkdagen verschuiven.", vervanger: collega, koppeling: K("/planning") }),
    v({ id: `${k}-klantcontact`, persoon: p, titel: "Klantcontact en meetings",
      wat: "Eerste en vaste aanspreekpunt van je klanten via WhatsApp, e-mail en telefoon. Afspraken plannen en strategie-, script-, kwartaal- en evaluatiegesprekken voeren.",
      wanneer: "Reactie altijd binnen 1 werkdag, streven: dezelfde werkdag",
      verwachting: "Gemiddelde klanttevredenheid minimaal een 9. Verwijs klanten nooit direct door naar Jarno.",
      afgerond: "Geen openstaande klantvragen.",
      betrokken: [collega], bevoegdheden: ["Voortgangs- en statusvragen beantwoorden", "Een extra adviesgesprek tot 30 minuten"],
      escalatie: "De klant wil stoppen of de samenwerking komt ernstig onder druk.", vervanger: collega, koppeling: K("/clients") }),
    v({ id: `${k}-editing`, persoon: p, titel: "Editors aansturen en editingcontrole",
      wat: "Editors dagelijks aansturen, deadlines bewaken, vragen direct beantwoorden en 100% van de video's controleren vóór verzending. Samen met de andere Content Creative hoofdverantwoordelijk voor de editingcontrole.",
      wanneer: "Gedurende de hele werkdag",
      verwachting: "Editors halen minimaal 95% van hun deadlines. Interne correctierondes onder de 5%.",
      afgerond: "De video voldoet aan de kwaliteitsstandaard en de Editing Guide van de klant.",
      betrokken: [collega, RU], bevoegdheden: ["Editors opnieuw laten editen", "Een freelancer inzetten binnen de bestaande begroting"],
      escalatie: "Meer dan twee uur extra editwerk, of structureel een duurdere editor dan het budget toelaat.", vervanger: collega, koppeling: K("/videos") }),
    v({ id: `${k}-oplevering`, persoon: p, titel: "Oplevering en klantfeedback",
      wat: "Video's en contentplanning in één oplevermoment naar de klant sturen, feedback verwerken, correcties controleren en video's definitief afronden voor publicatie.",
      wanneer: "Eerste versie uiterlijk 14 werkdagen na de opnamedag; de klant heeft 3 werkdagen voor feedback",
      verwachting: "Per video één gebundelde feedbackronde. Geen reactie binnen 3 werkdagen geldt als akkoord.",
      afgerond: "Video's definitief goedgekeurd en klaar voor publicatie.",
      betrokken: [collega],
      bevoegdheden: ["Klanten herinneren aan openstaande feedback", "Eén extra feedbackronde per klant per kwartaal", "Coulance tot €250 (vastleggen)", "Eén extra korte video als de fout bij Shortclips ligt"],
      escalatie: "Coulance boven €250.", vervanger: collega, koppeling: K("/videos") }),
    v({ id: `${k}-publicatie`, persoon: p, titel: "Publicatie en community",
      wat: "Content op alle kanalen publiceren, captions, instellingen en planning controleren, Stories plaatsen waar nodig en reageren op reacties en berichten.",
      wanneer: "Volgens de contentplanning",
      verwachting: "100% van de content op tijd gepubliceerd, zonder fouten in captions of uploads.",
      afgerond: "Gepubliceerd en gecontroleerd; waardevolle inzichten teruggekoppeld aan het team.",
      betrokken: [collega], bevoegdheden: ["Captions en publicatiemomenten bepalen"],
      escalatie: "", vervanger: collega, koppeling: K("/calendar") }),
    v({ id: `${k}-rapportage`, persoon: p, titel: "Analyse en maandrapportage",
      wat: "Statistieken verzamelen, de prestaties van content analyseren en maandelijks de rapportage versturen.",
      wanneer: "Maandelijks",
      verwachting: "Statistieken worden vertaald naar concrete verbeterpunten voor de volgende contentperiode.",
      afgerond: "Rapportage verstuurd en verbeterpunten verwerkt in de strategie.",
      betrokken: [], bevoegdheden: ["Statistieken en rapportages zelf afhandelen"],
      escalatie: "", vervanger: collega, koppeling: K("/analytics/maandrapportages") }),
    v({ id: `${k}-verlenging`, persoon: p, titel: "Verlengingen van je eigen klanten",
      wat: "Eigenaar van het verlengingsproces van je eigen klanten: voorbereiding, voorstel, opvolging en verwerking. Een opzegging bevestig je; het opzeggesprek voert Jarno.",
      wanneer: "Volgens het verlengingsproces (Klanten + communicatie 8.1)",
      verwachting: "Geen klant loopt ongemerkt af.",
      afgerond: "Verlenging verwerkt of opzegging bevestigd en vastgelegd.",
      betrokken: [JA], bevoegdheden: ["Meerwerk verkopen volgens de tarievenkaart (vastleggen)", "Korting tot 5% (vastleggen)"],
      escalatie: "Korting boven 5%, een afwijkende prijs of een contractwijziging.", vervanger: collega, koppeling: K("/clients") }),
  ];
};

const VERANTWOORDELIJKHEDEN: Verantwoordelijkheid[] = [
  ...cc(MI, JI),
  v({ id: "milou-facturatie", persoon: MI, titel: "Facturatie (eigenaar)",
    wat: "De maandronde en de weekronde uitvoeren in DigiBoox: per klant controleren, factureren, openstaande facturen nalopen en herinneringen versturen.",
    wanneer: "Maandronde op de 25e, weekronde iedere vrijdag",
    verwachting: "Iedere actieve klant heeft een factuur of een vastgelegde reden waarom niet. Eén factuur houdt nooit de hele ronde tegen.",
    afgerond: "Facturen verstuurd en factuurdatum en bedrag vastgelegd.",
    betrokken: [JI], bevoegdheden: ["Een factuur tegenhouden als iets niet aantoonbaar klopt (reden vastleggen)"],
    escalatie: "Creditfacturen, uitstel van betaling, factuurgeschillen, afwijkingen boven €250 of facturen ouder dan 60 dagen.", vervanger: JI, koppeling: null }),
  ...cc(JI, MI),
  v({ id: "jiska-facturatie", persoon: JI, titel: "Facturatie: verzendcontrole en vervanging",
    wat: "Na iedere maandronde controleren of iedere actieve klant een factuur heeft. Bij afwezigheid van Milou neem je de volledige facturatieronde automatisch over.",
    wanneer: "Na de maandronde van de 25e, en bij afwezigheid van Milou",
    verwachting: "Ontbreekt een factuur, dan gaat die dezelfde dag alsnog de deur uit.",
    afgerond: "Verzendcontrole gedaan; ontbrekende facturen verstuurd.",
    betrokken: [MI], bevoegdheden: [],
    escalatie: "Creditfacturen, uitstel van betaling, factuurgeschillen of afwijkingen boven €250.", vervanger: null, koppeling: null }),

  // ---------------- Rutger: Videograaf (1.5 en 1.13) ----------------
  v({ id: "ru-voorbereiding", persoon: RU, titel: "Draaidag voorbereiden",
    wat: "Iedere draaidag volledig voorbereiden: scripts, planning van de dag, locatie en apparatuur.",
    wanneer: "Voor iedere draaidag",
    verwachting: "Je komt nooit onvoorbereid op locatie.",
    afgerond: "Planning van de dag rond en apparatuur compleet.",
    betrokken: [MI, JI], bevoegdheden: ["De beste opnameplek kiezen", "De volgorde en het tempo van de opnamedag bepalen"],
    escalatie: "", vervanger: null, koppeling: K("/productions") }),
  v({ id: "ru-productie", persoon: RU, titel: "Opnamedag leiden en filmen",
    wat: "Zelfstandig filmen bij klanten, de opnameflow en het tempo sturen, de presentator begeleiden en tijdens de opname controleren dat er geen shots ontbreken.",
    wanneer: "Op iedere draaidag",
    verwachting: "100% van de geplande video's wordt opgenomen.",
    afgerond: "Alle geplande video's en benodigde beelden zijn opgenomen.",
    betrokken: [NY], bevoegdheden: ["Kleine tekstwijzigingen tijdens de opname", "Scènes opnieuw opnemen als de kwaliteit daardoor verbetert", "Extra B-roll opnemen", "De presentator begeleiden"],
    escalatie: "Een toezegging over extra video's of een extra draaidag.", vervanger: null, koppeling: K("/productions") }),
  v({ id: "ru-kwaliteit", persoon: RU, titel: "Beeld, audio en apparatuur",
    wat: "Verantwoordelijk voor camera-instellingen, licht, audio en apparatuur. Scherp, stabiel en goed belicht beeld volgens de Shortclips-standaard.",
    wanneer: "Tijdens iedere opname; apparatuur compleet en onderhouden",
    verwachting: "Minder dan 2% technische fouten in beeld of audio.",
    afgerond: "Beelden gecontroleerd; bij onvoldoende kwaliteit opnieuw opgenomen.",
    betrokken: [], bevoegdheden: ["Camera-, licht- en audio-instellingen", "Lenskeuze en beeldcompositie"],
    escalatie: "Grote schade aan of diefstal van apparatuur: direct melden.", vervanger: null, koppeling: K("/productions") }),
  v({ id: "ru-selectie", persoon: RU, titel: "Beelden selecteren en structureren",
    wat: "De juiste beelden per video selecteren, bestanden volgens de Shortclips-structuur ordenen en controleren dat niets ontbreekt.",
    wanneer: "Direct na iedere draaidag",
    verwachting: "Bij het selecteren denk je al vooruit richting de montage.",
    afgerond: "Beelden compleet en logisch geordend.",
    betrokken: [], bevoegdheden: ["Bepalen hoe beelden worden geselecteerd en geordend"],
    escalatie: "", vervanger: null, koppeling: K("/videos") }),
  v({ id: "ru-briefing", persoon: RU, titel: "Editorbriefings (eindverantwoordelijk)",
    wat: "Eindverantwoordelijk voor de editorbriefings van alle klanten: per video de opbouw, structuur, hook, pacing en verhaallijn.",
    wanneer: "Bij iedere overdracht naar de editor",
    verwachting: "Iedere video heeft een complete briefing; de editor kan zonder vragen aan de slag.",
    afgerond: "Briefing compleet en gecontroleerd.",
    betrokken: [MI, JI], bevoegdheden: ["Opbouw, hook en pacing in de briefing bepalen"],
    escalatie: "", vervanger: null, koppeling: K("/videos") }),
  v({ id: "ru-overdracht", persoon: RU, titel: "Overdracht en afstemming met editors",
    wat: "Alle bestanden correct uploaden, controleren of beelden en briefing compleet zijn en vragen van editors tijdens de montage beantwoorden.",
    wanneer: "Binnen 24 uur na de draaidag",
    verwachting: "Vragen van editors door een onduidelijke overdracht blijven onder de 5%.",
    afgerond: "Beelden en briefing staan klaar en de editor kan beginnen.",
    betrokken: [MI, JI], bevoegdheden: [],
    escalatie: "", vervanger: null, koppeling: K("/videos") }),

  // ---------------- Max: Grafisch Vormgever (1.7) ----------------
  v({ id: "ma-social", persoon: MA, titel: "Social media designs",
    wat: "Social media posts, campagnevisuals en templates voor social media ontwerpen.",
    wanneer: "Volgens de afgesproken planning",
    verwachting: "Een consistente uitstraling op alle kanalen.",
    afgerond: "Ontwerp overzichtelijk en volgens planning aangeleverd.",
    betrokken: [MI, JI], bevoegdheden: ["Ontwerpkeuzes binnen de huisstijl"], escalatie: "", vervanger: null, koppeling: null }),
  v({ id: "ma-branding", persoon: MA, titel: "Branding Shortclips",
    wat: "De huisstijl van Shortclips bewaken en nieuwe branding-uitingen, logo's, iconen en visuele elementen ontwikkelen.",
    wanneer: "Doorlopend",
    verwachting: "Een professionele en herkenbare uitstraling.",
    afgerond: "Uiting past bij de huisstijl van Shortclips.",
    betrokken: [JA], bevoegdheden: [], escalatie: "", vervanger: null, koppeling: null }),
  v({ id: "ma-uitingen", persoon: MA, titel: "Grafische uitingen",
    wat: "Presentaties, documenten, drukwerk, promotiemateriaal, kantooruitingen en merchandise ontwerpen.",
    wanneer: "Volgens de afgesproken planning",
    verwachting: "Correcte bestanden, weinig correctierondes.",
    afgerond: "Bestanden aangeleverd volgens planning.",
    betrokken: [], bevoegdheden: [], escalatie: "", vervanger: null, koppeling: null }),
  v({ id: "ma-klantbranding", persoon: MA, titel: "Klantbranding",
    wat: "Grafische bestanden voor klanten ontwerpen en de huisstijl van klantaccounts bewaken op websites, social media en campagnes.",
    wanneer: "Bij iedere designvraag voor een klant",
    verwachting: "Een consistente uitstraling over alle kanalen van de klant.",
    afgerond: "Ontwerp past bij de huisstijl van de klant.",
    betrokken: [MI, JI], bevoegdheden: [], escalatie: "", vervanger: null, koppeling: K("/clients") }),

  // ---------------- Nynke: Freelance Video Presentator (1.9) ----------------
  v({ id: "ny-presentatie", persoon: NY, titel: "Presenteren voor de camera",
    wat: "Scripts duidelijk, natuurlijk en foutloos presenteren met energie, en de tone of voice afstemmen op klant en doelgroep.",
    wanneer: "Op iedere opnamedag waarop je presenteert",
    verwachting: "Scripts komen geloofwaardig tot leven, consistent gedurende de hele dag.",
    afgerond: "Alle scripts overtuigend opgenomen.",
    betrokken: [RU], bevoegdheden: ["Tone of voice afstemmen op klant en doelgroep", "Een scène opnieuw opnemen wanneer nodig"],
    escalatie: "", vervanger: null, koppeling: K("/productions") }),
  v({ id: "ny-opname", persoon: NY, titel: "Voorbereiding en uitvoering op de set",
    wat: "Goed voorbereid naar iedere opnamedag komen, de aanwijzingen van het productieteam volgen en efficiënt werken.",
    wanneer: "Voor en tijdens iedere opnamedag",
    verwachting: "Op tijd aanwezig, weinig takes nodig, flexibel tijdens de opnames.",
    afgerond: "Opnamedag verlopen volgens planning.",
    betrokken: [RU], bevoegdheden: [], escalatie: "", vervanger: null, koppeling: K("/productions") }),

  // ---------------- Editors (1.6) ----------------
  ...EDITORS.flatMap((p): Verantwoordelijkheid[] => {
    const k = kort(p);
    return [
      v({ id: `${k}-monteren`, persoon: p, titel: "Video's monteren",
        wat: "Video's monteren volgens de briefing en de Shortclips-standaard, met een sterke hook, opbouw en pacing.",
        wanneer: "Volgens je editor deadline",
        verwachting: "Video's op tijd opgeleverd, technisch goed en in een consistente huisstijl.",
        afgerond: "Video volledig gemonteerd en zelf gecontroleerd.",
        betrokken: [RU, MI, JI], bevoegdheden: ["Creatieve keuzes binnen de briefing en de Shortclips-stijl (pacing, beelden, effecten, overgangen, muziek)"],
        escalatie: "", vervanger: null, koppeling: K("/videos") }),
      v({ id: `${k}-kwaliteit`, persoon: p, titel: "Kwaliteit en feedback",
        wat: "Audio en muziek correct toepassen, captions volgens de huisstijl verwerken en feedback nauwkeurig verwerken. Na iedere wijziging de video opnieuw controleren.",
        wanneer: "Voor iedere oplevering en na iedere feedbackronde",
        verwachting: "Zo min mogelijk correctierondes; correcte ondertiteling.",
        afgerond: "Feedback verwerkt en video opnieuw gecontroleerd.",
        betrokken: [MI, JI], bevoegdheden: [], escalatie: "", vervanger: null, koppeling: K("/videos") }),
      v({ id: `${k}-opleveren`, persoon: p, titel: "Opleveren in Frame.io",
        wat: "Iedere video in de juiste map in Frame.io (Next Frame) uploaden en controleren of alles correct is geüpload.",
        wanneer: "Bij iedere oplevering",
        verwachting: "Correcte exports; Frame.io tijdig bijgewerkt.",
        afgerond: "Video staat klaar voor de eindcontrole.",
        betrokken: [MI, JI], bevoegdheden: [], escalatie: "", vervanger: null, koppeling: K("/videos") }),
    ];
  }),

  // ---------------- Jarno: Eigenaar (1.3 en 1.14) ----------------
  v({ id: "ja-strategie", persoon: JA, titel: "Strategie, groei en positionering",
    wat: "Visie en strategie bepalen, sturen op groei en schaalbaarheid, nieuwe diensten ontwikkelen en de marktpositie en het merk Shortclips versterken.",
    wanneer: "Doorlopend",
    verwachting: "Je werkt aan het bedrijf, niet in het bedrijf.",
    afgerond: "Strategische keuzes gemaakt en vertaald naar het team.",
    betrokken: [], bevoegdheden: ["Strategische keuzes voor de toekomst"], escalatie: "", vervanger: null, koppeling: null }),
  v({ id: "ja-sales", persoon: JA, titel: "Sales, van lead tot handtekening",
    wat: "Leads kwalificeren, kennismakings- en salesgesprekken voeren, strategische samenwerkingen bouwen en het opzeggesprek voeren.",
    wanneer: "Doorlopend",
    verwachting: "Stuurt op omzet en winstgevendheid.",
    afgerond: "Offerte getekend en de klant overgedragen aan de Content Creative.",
    betrokken: [MI, JI], bevoegdheden: ["Tarieven, kortingen boven 5% en contractwijzigingen"], escalatie: "", vervanger: null, koppeling: K("/clients") }),
  v({ id: "ja-systemen", persoon: JA, titel: "Processen, SOP's, systemen en AI",
    wat: "Werkprocessen, SOP's, dashboards en automatiseringen ontwikkelen en verbeteren, en AI implementeren in de werkwijze.",
    wanneer: "Doorlopend",
    verwachting: "Komt een vraag terug, dan verbeter je de SOP in plaats van de vraag zelf op te lossen.",
    afgerond: "SOP of systeem bijgewerkt en het team weet waar het staat.",
    betrokken: [], bevoegdheden: [], escalatie: "", vervanger: null, koppeling: null }),
  v({ id: "ja-team", persoon: JA, titel: "Teamontwikkeling en kwaliteitsstandaard",
    wat: "Bouwen aan een zelfstandig team, functies en verantwoordelijkheden verbeteren, de kwaliteitsstandaard bepalen en niveau 4-beslissingen nemen.",
    wanneer: "Bij niveau 4-aanvragen en doorlopend",
    verwachting: "Het team bereidt voor en komt met een voorstel; jij beslist.",
    afgerond: "Besluit genomen en teruggekoppeld.",
    betrokken: [MI, JI, RU], bevoegdheden: ["Niveau 4-beslissingen"], escalatie: "", vervanger: null, koppeling: null }),
  v({ id: "ja-financien", persoon: JA, titel: "Financiële beslissingen",
    wat: "Beslissen over tarieven, marges en omzet, en over creditfacturen, uitstel van betaling en factuurgeschillen. Je voert zelf geen facturatie uit.",
    wanneer: "Bij escalaties en maandelijks een steekproef op de facturatie",
    verwachting: "Facturatie loopt zonder jou, behalve bij uitzonderingen.",
    afgerond: "Escalatie besloten en steekproef gedaan.",
    betrokken: [MI], bevoegdheden: [], escalatie: "", vervanger: null, koppeling: null }),
];

let n = 0;
const b = (persoon: string, situatie: string, niveau: Niveau): Beslissing => ({ id: `b${++n}`, persoon, situatie, niveau, actief: true });

/** Content Creative: 1.11/1.12 (afbeeldingen), K+C 1.8 en Over Shortclips 1.0. */
const MATRIX_CC: [string, Niveau][] = [
  ["Voortgangs- en statusvragen van klanten", "zelf"],
  ["Planning, beschikbaarheid en opnamedata verzetten binnen de annuleringsregeling", "zelf"],
  ["Scripts, hooks, contentconcepten en formats", "zelf"],
  ["Kwaliteitsvragen binnen de afgesproken feedbackronde", "zelf"],
  ["Editors aansturen of opnieuw laten editen", "zelf"],
  ["Captions, contentplanning en publicatiemomenten", "zelf"],
  ["Statistieken en rapportages", "zelf"],
  ["Deadline maximaal twee werkdagen verplaatsen (vastleggen)", "zelf"],
  ["Korting tot 5% of coulance tot €250 (vastleggen)", "zelf"],
  ["Meerwerk volgens de tarievenkaart (vastleggen)", "zelf"],
  ["Grotere of complexere situatie waarover je twijfelt", "overleg"],
  ["Korting boven 5% of een structurele korting", "escaleren"],
  ["Coulance boven €250", "escaleren"],
  ["Deadline meer dan twee werkdagen verschuiven", "escaleren"],
  ["Afwijken van de annuleringsregeling", "escaleren"],
  ["Contractwijziging: duur, prijs, scope of voorwaarden", "escaleren"],
  ["Klant wil stoppen, of nieuwe afspraken die afwijken van de standaard", "escaleren"],
  ["Meer dan twee uur extra editwerk of structureel een duurdere editor", "escaleren"],
  ["Risico op omzetverlies, reputatieschade of een zeer ontevreden klant", "escaleren"],
  ["Creditfactuur, uitstel van betaling of factuurgeschil", "escaleren"],
];
/** Videograaf: 1.13 (afbeeldingen en tekst). */
const MATRIX_RU: [string, Niveau][] = [
  ["Opnameplek, volgorde en tempo van de opnamedag", "zelf"],
  ["Camera, lens, licht en audio", "zelf"],
  ["Kleine tekstwijzigingen, scènes opnieuw opnemen en extra B-roll", "zelf"],
  ["Klant is ontevreden over de opname: luisteren, samen een oplossing zoeken en de regie houden", "zelf"],
  ["Locatie ongeschikt of planning niet haalbaar: zelf de beste oplossing kiezen en dit duidelijk communiceren", "zelf"],
  ["Klant wil andere of extra video's of een extra draaidag: regie houden, nog niets toezeggen", "zelf"],
  ["Klant verwacht kosteloos extra werk: uitleggen dat dit meerwerk is", "zelf"],
  ["Schade aan apparatuur: schadeprotocol volgen en intern melden", "zelf"],
  ["Klant wil de samenwerking beëindigen", "overleg"],
  ["Grote financiële impact", "overleg"],
  ["Probleem dat je ondanks meerdere oplossingen niet oplost", "overleg"],
  ["De relatie met de klant komt ernstig onder druk", "overleg"],
  ["Toezegging over extra video's of een extra draaidag", "escaleren"],
  ["Ernstig ongeval of een onveilige situatie", "escaleren"],
  ["Diefstal van of grote schade aan apparatuur", "escaleren"],
  ["Juridische of aansprakelijkheidskwestie", "escaleren"],
  ["Situatie raakt de continuïteit van de samenwerking", "escaleren"],
];
/** Editor: K+C 1.8 (Editing) en 1.6. */
const MATRIX_ED: [string, Niveau][] = [
  ["Creatieve keuzes binnen de briefing en de Shortclips-stijl", "zelf"],
  ["Briefing is niet duidelijk: vraag de Content Creative om verduidelijking", "overleg"],
  ["Je loopt vast of je deadline komt in gevaar: meld het direct in de WhatsApp-groep of bel", "overleg"],
];

const BESLISSINGEN: Beslissing[] = [
  ...MATRIX_CC.map(([s, nv]) => b(MI, s, nv)),
  ...MATRIX_CC.map(([s, nv]) => b(JI, s, nv)),
  ...MATRIX_RU.map(([s, nv]) => b(RU, s, nv)),
  ...EDITORS.flatMap((p) => MATRIX_ED.map(([s, nv]) => b(p, s, nv))),
];

let c = 0;
const ctl = (persoon: string, frequentie: Frequentie, titel: string, href: string | null): Controle =>
  ({ id: `c${++c}`, persoon, frequentie, titel, koppeling: href ? K(href) : null, actief: true });

const ccControles = (p: string): Controle[] => [
  ctl(p, "dagelijks", "Dagstart: wat is te laat of moet vandaag af", "/dashboard"),
  ctl(p, "dagelijks", "Klantberichten beantwoorden (binnen 1 werkdag)", "/clients"),
  ctl(p, "dagelijks", "Edits controleren en vragen van editors direct beantwoorden", "/videos"),
  ctl(p, "dagelijks", "Publicaties van vandaag gecontroleerd", "/calendar"),
  ctl(p, "wekelijks", "Maandag: relatieronde, welke klanten hebben aandacht nodig", "/kwaliteit"),
  ctl(p, "wekelijks", "Scripts klaar 7 werkdagen vóór de draaidag", "/scripting"),
  ctl(p, "wekelijks", "Contentplanning komende weken gevuld", "/calendar"),
  ctl(p, "wekelijks", "Weekplanning opnames en editing", "/planning"),
  ctl(p, "maandelijks", "Maandrapportages versturen", "/analytics/maandrapportages"),
  ctl(p, "maandelijks", "Contentstrategie per klant evalueren", "/analytics"),
  ctl(p, "maandelijks", "Nieuwe contentideeën per klant", "/scripting"),
];

const CONTROLES: Controle[] = [
  ...ccControles(MI),
  ctl(MI, "wekelijks", "Vrijdag: weekronde openstaande facturen en herinneringen", null),
  ctl(MI, "maandelijks", "25e: maandronde facturatie", null),
  ...ccControles(JI),
  ctl(JI, "maandelijks", "Na de 25e: verzendcontrole facturatie", null),

  ctl(RU, "dagelijks", "Opnames van de komende dagen voorbereiden", "/productions"),
  ctl(RU, "dagelijks", "Na een draaidag: beelden en briefing binnen 24 uur overdragen", "/videos"),
  ctl(RU, "dagelijks", "Vragen van editors beantwoorden", "/videos"),
  ctl(RU, "wekelijks", "Weekplanning opnames", "/planning"),
  ctl(RU, "wekelijks", "Apparatuur compleet en onderhouden", null),
  ctl(RU, "maandelijks", "Eén procesverbetering aandragen", null),

  ctl(MA, "wekelijks", "Ontwerpen volgens planning opleveren", null),

  ctl(NY, "wekelijks", "Opnamedagen waarop je presenteert voorbereiden", "/productions"),

  ...EDITORS.flatMap((p) => [
    ctl(p, "dagelijks", "Je montages en openstaande feedback", "/videos"),
    ctl(p, "wekelijks", "Je editor deadlines van deze week", "/videos"),
  ]),

  ctl(JA, "wekelijks", "Niveau 4-aanvragen beslissen", null),
  ctl(JA, "maandelijks", "Steekproef facturatie", null),
  ctl(JA, "maandelijks", "SOP's verbeteren waar vragen terugkomen", null),
];

const AFWEZIGHEID: Record<string, Afwezigheid> = {
  [MI]: {
    doorloopt: [
      "Alle dagelijkse productie, planning, scripts en oplevering van je klanten",
      "Klantcontact, feedback en de aansturing van editors",
      "Facturatie: jij voert de rondes uit, Jarno beslist alleen bij uitzonderingen",
    ],
    beslisser: "Niveau 1 en 2 beslis je zelf. [[Wie beslist over niveau 4 als Jarno afwezig is, is nog niet vastgelegd in de kennisbank.]]",
    vervanger: JI,
  },
  [JI]: {
    doorloopt: [
      "Alle dagelijkse productie, planning, scripts en oplevering van je klanten",
      "Klantcontact, feedback en de aansturing van editors",
      "Facturatie: bij afwezigheid van Milou neem jij de ronde over",
    ],
    beslisser: "Niveau 1 en 2 beslis je zelf. [[Wie beslist over niveau 4 als Jarno afwezig is, is nog niet vastgelegd in de kennisbank.]]",
    vervanger: MI,
  },
  [RU]: {
    doorloopt: ["Alle geplande opnamedagen en de voorbereiding daarvan", "Editorbriefings en overdracht aan de editors"],
    beslisser: "Op locatie beslis je zelf. Veiligheidssituaties meld je altijd direct. [[Wie beslist over niveau 4 als Jarno afwezig is, is nog niet vastgelegd.]]",
    vervanger: null,
  },
  [MA]: { doorloopt: [], beslisser: "", vervanger: null },
  [NY]: { doorloopt: [], beslisser: "", vervanger: null },
  [FA]: { doorloopt: [], beslisser: "", vervanger: null },
  [NO]: { doorloopt: [], beslisser: "", vervanger: null },
  [QU]: { doorloopt: [], beslisser: "", vervanger: null },
  [SE]: { doorloopt: [], beslisser: "", vervanger: null },
  [JA]: { doorloopt: [], beslisser: "", vervanger: null },
};

const CC_KPIS: Kpi[] = [
  { titel: "Scripts op tijd", norm: "Uiterlijk 7 werkdagen vóór de draaidag gereed" },
  { titel: "Reactietijd naar klanten", norm: "Binnen 1 werkdag, streven: dezelfde werkdag" },
  { titel: "Klanttevredenheid", norm: "Gemiddeld minimaal een 9" },
  { titel: "Opleveringen op tijd", norm: "Eerste versie uiterlijk 14 werkdagen na de opnamedag" },
  { titel: "Deadlines editors", norm: "Minimaal 95% gehaald" },
  { titel: "Eindcontrole video's", norm: "100% gecontroleerd vóór verzending" },
  { titel: "Interne correctierondes", norm: "Onder de 5%" },
  { titel: "Publicaties volgens planning", norm: "100% op tijd" },
  { titel: "Openstaande klantvragen", norm: "Zo laag mogelijk" },
  { titel: "Procesverbeteringen", norm: "Minimaal twee per kwartaal" },
];

const ccSamen = (collega: string, facturatie: string): Samenwerking[] => [
  { met: naamVanIntern(collega), wanneer: `Andere Content Creative: jullie vervangen elkaar en delen de editingcontrole. ${facturatie}` },
  { met: "Rutger", wanneer: "Script klaar: draag over voor de draaidag. Rutger maakt de editorbriefing en draagt de beelden binnen 24 uur over." },
  { met: "Editors", wanneer: "Je stuurt ze dagelijks aan, beantwoordt vragen direct en geeft feedback op iedere versie." },
  { met: "Jarno", wanneer: "Alleen bij niveau 4, en voor sales en het opzeggesprek. Kom altijd met een voorstel." },
];

function naamVanIntern(email: string): string {
  return MEDEWERKERS.find((m) => m.email === email)?.naam ?? email;
}

const EDITOR_PROFIEL: Profiel = {
  functie: "Short Video Editor",
  doel: "Je monteert short video content volgens de kwaliteitsstandaard van Shortclips en levert iedere video volledig gemonteerd op in Frame.io, klaar voor de eindcontrole.",
  kpis: [
    { titel: "Video's op tijd opleveren", norm: "Volgens je editor deadline" },
    { titel: "Revisierondes", norm: "Zo weinig mogelijk" },
    { titel: "Technische kwaliteit en huisstijl", norm: "Volgens de Shortclips-standaard en de Editing Guide" },
    { titel: "Ondertiteling en exports", norm: "Correct" },
    { titel: "Frame.io", norm: "Tijdig bijgewerkt" },
    { titel: "Feedback", norm: "Nauwkeurig en snel verwerkt" },
  ],
  samenwerking: [
    { met: "Rutger", wanneer: "Je krijgt van hem de beelden en de briefing. Vragen over de opname stel je aan hem." },
    { met: "Milou of Jiska", wanneer: "Zij controleren je video's en geven feedback. Houd ze op de hoogte van vertraging." },
  ],
  bron: "Team Shortclips · 1.6 KPI's Short video editor",
};

const PROFIELEN: Record<string, Profiel> = {
  [MI]: {
    functie: "Content Creative & Social Media Manager",
    doel: "Je bent verantwoordelijk voor de volledige contentflow van je eigen klanten: van strategie en scripts tot klantcontact, kwaliteitscontrole, publicatie en rapportage. Daarnaast ben je eigenaar van de facturatie.",
    kpis: [...CC_KPIS, { titel: "Facturatie", norm: "Maandronde op de 25e en weekronde op vrijdag uitgevoerd" }],
    samenwerking: ccSamen(JI, "Facturatie: Jiska doet na iedere maandronde de verzendcontrole en neemt over bij je afwezigheid."),
    bron: "Team Shortclips · 1.4 KPI's Content Creative en 1.11 Beslissingsbevoegdheid Milou",
  },
  [JI]: {
    functie: "Content Creative & Social Media Manager",
    doel: "Je bent verantwoordelijk voor de volledige contentflow van je eigen klanten: van strategie en scripts tot klantcontact, kwaliteitscontrole, publicatie en rapportage. Je bent vaste vervanger voor de facturatie.",
    kpis: [...CC_KPIS, { titel: "Verzendcontrole facturatie", norm: "Iedere actieve klant heeft een factuur of een vastgelegde reden" }],
    samenwerking: ccSamen(MI, "Facturatie: na de maandronde doe jij de verzendcontrole; bij afwezigheid van Milou neem jij de ronde over."),
    bron: "Team Shortclips · 1.4 KPI's Content Creative en 1.12 Beslissingsbevoegdheid Jiska",
  },
  [RU]: {
    functie: "Videograaf",
    doel: "Je bent verantwoordelijk voor de volledige productie: van de voorbereiding van de draaidag tot en met de overdracht naar de editor, inclusief de editorbriefings. Tijdens de opnamedag heb jij de leiding.",
    kpis: [
      { titel: "Opnames volgens planning", norm: "100% van de geplande video's opgenomen" },
      { titel: "Technische kwaliteit beeld en audio", norm: "Minder dan 2% technische fouten" },
      { titel: "Overdracht naar editors", norm: "Binnen 24 uur na de draaidag, compleet" },
      { titel: "Editorbriefings", norm: "Iedere video een complete briefing" },
      { titel: "Vragen door onduidelijke overdracht", norm: "Onder de 5%" },
      { titel: "Heropnames", norm: "Zo weinig mogelijk" },
      { titel: "Apparatuur", norm: "Compleet en onderhouden" },
      { titel: "Procesverbeteringen", norm: "Minimaal één per maand" },
    ],
    samenwerking: [
      { met: "Milou en Jiska", wanneer: "Zij leveren de scripts aan (7 werkdagen vóór de draaidag) en doen het klantcontact over planning. Houd ze op de hoogte van bijzonderheden." },
      { met: "Presentator", wanneer: "Op de set begeleid jij de presentator." },
      { met: "Editors", wanneer: "Binnen 24 uur na de draaidag draag je beelden en briefing over; daarna beantwoord je hun vragen." },
      { met: "Jarno", wanneer: "Bij een toezegging over extra video's of een draaidag, en direct bij ongeval, diefstal of grote schade." },
    ],
    bron: "Team Shortclips · 1.5 KPI's Videograaf en 1.13 Beslissingsbevoegdheid Rutger",
  },
  [MA]: {
    functie: "Grafisch Vormgever",
    doel: "Je bent verantwoordelijk voor alle grafische en visuele uitingen van Shortclips en haar klanten, met een sterke en consistente huisstijl, online en offline.",
    kpis: [
      { titel: "Ontwerpen volgens huisstijl", norm: "Altijd" },
      { titel: "Deadlines", norm: "Behaald volgens de afgesproken planning" },
      { titel: "Bestanden", norm: "Correct en overzichtelijk aangeleverd" },
      { titel: "Creatieve kwaliteit en consistente branding", norm: "Volgens de Shortclips-standaard" },
      { titel: "Correctierondes", norm: "Zo weinig mogelijk" },
    ],
    samenwerking: [
      { met: "Milou en Jiska", wanneer: "Bij ontwerpen voor klanten en social media." },
      { met: "Jarno", wanneer: "Bij branding en de uitstraling van Shortclips zelf." },
    ],
    bron: "Team Shortclips · 1.7 KPI's Grafisch designer",
  },
  [NY]: {
    functie: "Freelance Video Presentator",
    doel: "Je presenteert short video content voor klanten van Shortclips, met een natuurlijke presentatie, sterke energie en een overtuigende delivery voor de camera.",
    kpis: [
      { titel: "Natuurlijke presentatie en energie", norm: "Op iedere opname" },
      { titel: "Foutloze delivery", norm: "Weinig takes nodig" },
      { titel: "Op tijd aanwezig", norm: "Altijd" },
      { titel: "Samenwerking en flexibiliteit op de set", norm: "Professioneel" },
    ],
    samenwerking: [
      { met: "Rutger", wanneer: "Op de set volg je zijn aanwijzingen en stem je de aanpak af." },
    ],
    bron: "Team Shortclips · 1.9 KPI's Video presentator",
  },
  [FA]: EDITOR_PROFIEL,
  [NO]: EDITOR_PROFIEL,
  [QU]: EDITOR_PROFIEL,
  [SE]: EDITOR_PROFIEL,
  [JA]: {
    functie: "Eigenaar - Head of Growth",
    doel: "Je bent eindverantwoordelijk voor koers, groei en toekomst van Shortclips: strategie, sales, financiën, kwaliteitsstandaard, systemen en team. De dagelijkse uitvoering ligt bij het team.",
    kpis: [
      { titel: "Omzetgroei", norm: "Jaarlijks" },
      { titel: "Winstgevendheid", norm: "Van het bedrijf" },
      { titel: "Nieuwe klanten", norm: "Per maand" },
      { titel: "Systemen, SOP's en AI", norm: "Doorlopend ontwikkelen en implementeren" },
      { titel: "Merk en personal brand", norm: "Groei" },
      { titel: "Zelfstandig team", norm: "Steeds minder afhankelijk van jou" },
    ],
    samenwerking: [
      { met: "Milou en Jiska", wanneer: "Na een getekende offerte draag je de klant over. Zij komen alleen bij niveau 4 met een voorstel." },
      { met: "Rutger", wanneer: "Bij toezeggingen over extra werk op locatie en bij veiligheidssituaties." },
    ],
    bron: "Team Shortclips · 1.3 KPI's Eigenaar en 1.14 Beslissingsbevoegdheid Jarno",
  },
};

const OPEN_PUNTEN = [
  "Functies: Rutger is Videograaf (bevestigd, nu overal aangepast). Voor Max en Nynke gebruikt de kennisbank Grafisch Vormgever en Freelance Video Presentator, de website Brand Designer en Presentatrice. De pagina volgt de kennisbank; welke is juist?",
  "Editors: les 1.6 noemt Sem, Fabian en Noah; het organigram ook Quinn. In het portaal is ook Senna actief als editor. Quinn staat er nu bij als editor, Senna niet. Klopt dat?",
  "Editors zien de pagina niet: zij hebben alleen de compacte editorweergave. Hun verantwoordelijkheden staan er voor jouw overzicht. Wil je ze in het editorportaal tonen?",
  "Rutger: de afbeelding 'Los je altijd zelf op' (les 1.13) zegt dat hij extra video's of een extra draaidag zelf afhandelt, de tekst eronder dat een toezegging daarover niveau 4 is. De pagina volgt de tekst: regie houden, toezeggen via Jarno.",
  "Verwijzing: lessen 1.10 t/m 1.14 en Klanten + communicatie 1.4 verwijzen naar 'SOP 1.10 Beslisrechten', maar die les heet nu 1.8.",
  "Monday: de kennisbank zegt nog 'leg vast in Monday' en de relatieronde draait op een Monday-scan. Op de pagina staat 'vastleggen in het portaal' en de relatieronde gekoppeld aan Aandachtspunten.",
  "Afwezigheid Jarno: in de kennisbank staat niet wie over niveau 4 beslist als jij afwezig bent. Eerder stond hier Christian en 'Milou beslist tot €250 voor het hele team'; dat is weggehaald omdat het nergens is vastgelegd.",
  "Vervangers: voor Rutger, Max, Nynke en de editors is in de kennisbank geen vervanger vastgelegd.",
  "Joy (Freelance Video Presentator in les 1.9) heeft geen account in het portaal en staat daarom niet op de pagina.",
  "Beslisrechten voor Max en Nynke staan niet in de kennisbank; er staan voor hen daarom geen beslisregels op de pagina.",
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
    profielen: Object.fromEntries(Object.entries(PROFIELEN).map(([k, p]) => [k, {
      ...p, kpis: p.kpis.map((x) => ({ ...x })), samenwerking: p.samenwerking.map((x) => ({ ...x })),
    }])),
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
        betrokken: lijst(r.betrokken, 5).map((e) => e.toLowerCase()).filter((e) => EMAILS.has(e)),
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
  const profielen: Record<string, Profiel> = {};
  for (const m of MEDEWERKERS) {
    const pr = (i.profielen?.[m.email] ?? basis.profielen[m.email]) as Partial<Profiel> | undefined;
    const paren = <T,>(x: unknown, a: keyof T & string, b2: keyof T & string, max: number): T[] =>
      (Array.isArray(x) ? x : []).slice(0, max).flatMap((y) => {
        const r = (y ?? {}) as Record<string, unknown>;
        const l = str(r[a], 160); const rr = str(r[b2], 300);
        return l ? [{ [a]: l, [b2]: rr } as T] : [];
      });
    profielen[m.email] = {
      functie: str(pr?.functie, 120) || m.functie,
      doel: str(pr?.doel, 600),
      kpis: paren<Kpi>(pr?.kpis, "titel", "norm", 20),
      samenwerking: paren<Samenwerking>(pr?.samenwerking, "met", "wanneer", 12),
      bron: str(pr?.bron, 200),
    };
  }
  return {
    versie: 1,
    status: i.status === "goedgekeurd" ? "goedgekeurd" : "concept",
    goedgekeurdOp: typeof i.goedgekeurdOp === "string" ? i.goedgekeurdOp : null,
    bijgewerktOp: typeof i.bijgewerktOp === "string" ? i.bijgewerktOp : null,
    verantwoordelijkheden, beslissingen, controles, afwezigheid, profielen,
    openPunten: Array.isArray(i.openPunten) ? lijst(i.openPunten, 30) : basis.openPunten,
  };
}
