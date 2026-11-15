/**
 * Shortclips Edit Standaard: de algemene montagestandaard voor editors.
 *
 * Bewust een eigen, op zichzelf staande tekst: editors hebben geen toegang tot
 * de interne kennisbank, dus alles wat ze moeten weten staat hier uitgeschreven
 * (geen verwijzingen naar interne werkinstructies). Wijzigt een norm in de
 * kennisbank (Short Video Editor, hoofdstuk 3), pas hem dan ook hier aan.
 */
export type EditStandaardSection = {
  id: string;
  title: string;
  /** Eén regel voor het scanblok bovenaan. */
  scan: string;
  /** Zo doe je het. */
  rules: string[];
  /** Hierdoor komt een video terug voor feedback. */
  avoid: string[];
};

export const EDIT_STANDAARD: EditStandaardSection[] = [
  {
    id: "hook",
    title: "Hook",
    scan: "Raak in de eerste 3 seconden. Geen aanloop.",
    rules: [
      "De video begint direct met de hook. Geen aanloop voordat de eerste zin start.",
      "Stiltes en ademhalingen aan het begin zijn eruit geknipt.",
      "Het eerste beeld laat zien waar de zin over gaat, niet alleen wie hem zegt.",
      "Wissel de opening af binnen een opnamesessie: niet elke video hetzelfde kader en dezelfde tekstkaart.",
    ],
    avoid: ["Een stille of trage eerste seconde.", "Een hook die pas na de introductie komt."],
  },
  {
    id: "tempo",
    title: "Tempo en opbouw",
    scan: "15 tot 40 seconden. Alle stiltes eruit.",
    rules: [
      "Lengte 15 tot 40 seconden, tenzij de Editing Guide van de klant iets anders zegt.",
      "Opbouw: hook, daarna de uitleg of het product, daarna een duidelijke call to action.",
      "Geen pauze tussen twee zinnen en geen aanloop voor een zin.",
      "De call to action staat goed leesbaar in beeld voordat de video naar zwart gaat.",
      "Wissel van beeld als het iets toevoegt: een nieuw punt, een bedrag, een product.",
    ],
    avoid: ["Stiltes tussen zinnen.", "Twee keer bijna hetzelfde shot achter elkaar.", "Een einde zonder call to action."],
  },
  {
    id: "ondertiteling",
    title: "Ondertiteling",
    scan: "Eén regel, in klantkleur, foutloos.",
    rules: [
      "Gebruik het font van de klant. Past dat niet, kies dan een strak en goed leesbaar font.",
      "Tekstblok in de huisstijlkleur van de klant. Tekst meestal wit, zwart alleen als dat beter leest.",
      "Tekst staat net onder het midden, op één regel en volledig in beeld.",
      "Rustige animatie (fade-in, pop of swipe) die gelijk loopt met de stem.",
      "Elke tekst staat lang genoeg in beeld om te lezen. Liever iets te lang dan te kort.",
      "Controleer alle tekst in twee volledige rondes op spelling, grammatica en het script.",
      "Bekijk de export op je telefoon: staat alles binnen de veilige marges?",
    ],
    avoid: [
      "Spelfouten of tekst die afwijkt van het script.",
      "Tekst over een gezicht, auto of product.",
      "Losse woorden of knipperende tekst.",
      "Een kleur die niet bij de klant hoort.",
    ],
  },
  {
    id: "beeld",
    title: "Beeld en kleur",
    scan: "Natuurlijke huid, elk shot dezelfde kleur.",
    rules: [
      "Start met de Shortclips LUT en pas daarna aan tot het beeld natuurlijk is.",
      "Huidtinten kloppen. Geen groene of oranje zweem.",
      "Alle shots hebben dezelfde kleur en helderheid.",
      "Helder beeld, zonder uitgebeten lichte delen.",
      "Alle shots zijn stabiel. Haal schokken en trillingen weg.",
      "Verticaal 9:16, zonder zwarte randen.",
    ],
    avoid: ["Een shot dat duidelijk donkerder is dan de rest.", "Overbelichte of te verzadigde beelden."],
  },
  {
    id: "audio",
    title: "Audio en muziek",
    scan: "Stem voorop, muziek eronder.",
    rules: [
      "Verbeter de stem met Enhance Speech in Adobe Podcast en zet hem op ongeveer 70% in de mix. Klinkt het robotachtig, zet hem lager.",
      "De stem is altijd verstaanbaar: geen ruis, geen pieken, overal hetzelfde volume.",
      "Muziek komt uit het Shortclips account van Envato Elements. Altijd met licentie.",
      "Kies muziek die past: advertentie commercieel, organisch energiek, luxe klant rustig, makelaar warm en ingetogen.",
      "Muziek eindigt met een fade-out.",
      "Sound effects zijn subtiel en altijd zachter dan stem en muziek.",
    ],
    avoid: ["Muziek die de stem overstemt.", "Muziek die abrupt stopt.", "Kinderachtige of overdreven geluidseffecten."],
  },
  {
    id: "effecten",
    title: "Effecten en logo",
    scan: "Harde cuts. Een effect moet iets toevoegen.",
    rules: [
      "Monteer vooral met harde cuts. Een whoosh of fade alleen waar het past.",
      "Elke video eindigt met een rustige fade naar zwart.",
      "Logo alleen als het bij de opdracht hoort. Dan midden onderin, volledig zichtbaar en niet storend.",
      "Grafische elementen passen bij de klant.",
    ],
    avoid: ["Overdreven zooms.", "Goedkope of onnodige animaties.", "Overgangen zonder reden."],
  },
  {
    id: "broll",
    title: "B-roll en afwisseling",
    scan: "Beeld past bij wat er gezegd wordt.",
    rules: [
      "Wissel de spreker en B-roll steeds af, zodat het beeld blijft veranderen.",
      "Bij productuitleg: beeld van het product. Bij een verhaal: passende sfeerbeelden.",
      "Gebruik alleen beeld dat aansluit op wat er op dat moment gezegd wordt.",
      "Gebruik close-ups en details waar ze er zijn.",
      "Bouw niet elke video in dezelfde volgorde op.",
    ],
    avoid: ["Lange stukken met alleen de spreker in beeld.", "B-roll die iets anders toont dan er gezegd wordt."],
  },
  {
    id: "originaliteit",
    title: "Originaliteit",
    scan: "Klantstijl vast, de rest varieer je.",
    rules: [
      "Vast is wat in de Editing Guide van de klant staat: kleur, font, tekststijl en toon. Alles daarbuiten is jouw ruimte.",
      "Kies per video één onderdeel dat je anders doet dan in de vorige: de opening, de B-roll, een overgang of de manier waarop je iets laat zien.",
      "Laat informatie zien in plaats van alleen te ondertitelen. Een bedrag, een stappenlijst of een vergelijking krijgt een eigen beeld.",
      "Bekijk de laatste video's van de klant voordat je begint, zodat je niet dezelfde opbouw herhaalt.",
      "Vergelijk je edit met de Shortclips voorbeelden op kleur, tempo en sfeer.",
    ],
    avoid: ["Zes video's uit één sessie die allemaal hetzelfde beginnen.", "Steeds dezelfde standaardeffecten."],
  },
  {
    id: "export",
    title: "Export en oplevering",
    scan: "1080 × 1920, 50 fps, H.265.",
    rules: [
      "Formaat HEVC H.265 (.mp4), 1080 × 1920, verticaal 9:16.",
      "Framerate 50 fps. Kleurruimte Rec. 709.",
      "Bitrate variabel met target 35 Mbps. Hardware encoding aan.",
      "Audio AAC, 320 kbps, 48 kHz, stereo.",
      "Open het bestand na de export en kijk het volledig terug.",
      "Upload de nieuwste versie in de juiste klantmap in Next Frame.",
    ],
    avoid: ["Zwarte randen of een verkeerde verhouding.", "Uploaden zonder de export te hebben teruggekeken."],
  },
];

/** De eindcheck die een editor per video doorloopt voordat hij uploadt. */
export const EDIT_EINDCHECK: string[] = [
  "Export volledig teruggekeken, van begin tot eind",
  "Sterke hook, hoog tempo, stiltes eruit",
  "Call to action staat erin en is goed leesbaar",
  "Tekst leesbaar, juiste font en kleur van de klant",
  "Tekst in twee rondes gecontroleerd en foutloos",
  "Kleur natuurlijk, huidtinten kloppen, shots gelijk",
  "Stem verstaanbaar, muziek eronder, geen pieken",
  "Spreker en B-roll wisselen af, shots stabiel",
  "Logo goed geplaatst, als de klant dat vraagt",
  "Eindigt met fade naar zwart en fade-out van de muziek",
  "Op telefoon bekeken, alles binnen de veilige marges",
  "Editing Guide van de klant nagelopen",
  "Geëxporteerd met de vaste instellingen",
];

export const SHORTCLIPS_VOORBEELDEN_URL = "https://www.youtube.com/@shortclips.shortvideo/shorts";
