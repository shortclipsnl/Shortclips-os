/**
 * De teamhandleiding van de Shortclips AI Editor. Eén bron voor de uitklapbare
 * uitleg in de editor en het artikel in de Shortclips Kennisbank
 * (scripts/ai-editor-kb.ts), zodat ze niet uit elkaar lopen.
 *
 * Bewust zonder "server-only": wordt in de client-component en in een script
 * gebruikt.
 */

export type GuideSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  /** Voorbeeldberichten voor de chat (worden als code getoond). */
  examples?: string[];
};

export const AI_EDITOR_GUIDE_TITLE = "Zo maak je een advertentievideo met de AI Editor";

export const AI_EDITOR_GUIDE: GuideSection[] = [
  {
    title: "In het kort",
    paragraphs: [
      "Je zet de ruwe camerabestanden van de opnamedag in een project, eventueel met het script, en klikt op Genereer. De AI Editor kiest per zin de beste take, knipt verspreking en stiltes eruit, zet ondertitels, kaarten, zooms, kleur, muziek en geluid in de Shortclips Ads Style en controleert het resultaat. Daarna geef je in de chat aan wat er anders moet, tot de video goed is. Dan exporteer je in volle kwaliteit.",
      "De AI verzint nooit tekst. Alles wat in beeld staat, komt uit wat er gezegd is of uit het script.",
    ],
  },
  {
    title: "1. Opnemen: hier wordt de montage beter van",
    bullets: [
      "Begin bij een verspreking de hele zin opnieuw, niet halverwege. Laat even een korte stilte vallen voor je opnieuw begint: dan herkent de AI de takes het best.",
      "Neem het script mee naar de opname en houd de volgorde aan. Afwijken mag, maar dan moet je vaker zelf een take kiezen.",
      "B-roll mag in aparte bestanden. Bij twijfel zet je de rol van een bestand zelf op Spreker of B-roll.",
      "Log-beeld is prima. Staat er een camera-LUT in Stijlbeheer, dan wordt die gebruikt; anders een generieke omzetting (de QC meldt dat).",
      "Neem geluid op met een losse microfoon als het kan. Muziek en ruis wegpoetsen kan de editor niet.",
    ],
  },
  {
    title: "2. Bestanden toevoegen",
    bullets: [
      "Bestanden tot 50 MB kun je direct uploaden met Bestanden uploaden.",
      "Grotere camerabestanden zet je in een Google Drive-map en plak je de link van de map of het bestand. De verwerk-server haalt de originelen zelf op; jouw browser hoeft niets te uploaden.",
      "Script plakken is optioneel. Met script komt de video in de bedoelde volgorde en worden namen en woorden in de ondertitels gespeld zoals in het script.",
    ],
  },
  {
    title: "3. Genereren",
    paragraphs: [
      "Klik op Genereer advertentievideo. Je ziet live in welke fase de editor zit. De eerste keer per bestand duurt het langst, omdat alles getranscribeerd wordt; die transcriptie wordt daarna hergebruikt. Hoe lang het precies duurt, hangt af van de hoeveelheid ruw materiaal.",
      "De verwerking draait op de verwerk-server (de Mac op kantoor). Staat een project lang in de wachtrij, dan draait die server waarschijnlijk niet: start op die Mac AI Editor starten.command.",
    ],
  },
  {
    title: "4. Takes kiezen",
    paragraphs: [
      "Onder Takes per zin zie je per zin welke opname gebruikt is. Oranje zinnen hebben twee vergelijkbare takes: daar kies jij. Klik op Deze take gebruiken of kies een andere en de preview wordt bijgewerkt. Exporteren kan pas als alle oranje zinnen gekozen zijn.",
    ],
  },
  {
    title: "5. Feedback geven in de chat",
    paragraphs: [
      "Naast de preview staat de chat. Schrijf in gewone taal wat er anders moet. Meerdere punten in één bericht mag: zet ze op losse regels. De editor antwoordt per punt wat er is aangepast, of stelt een vraag als iets niet duidelijk is.",
      "Gaat het over een moment in de video? Pauzeer de preview en typ je bericht: het tijdstip gaat automatisch mee, bijvoorbeeld [0:12]. Met de klokknop zet je het tijdstip midden in je bericht, handig bij meerdere punten.",
      "Na je bericht wordt alleen het gewijzigde deel opnieuw gerenderd. Er wordt niet opnieuw gemonteerd.",
    ],
    examples: [
      "[0:12] zoom eruit",
      "De eerste 3 seconden moeten strakker",
      "Zin 4 mag eruit",
      "Zin 5 naar het begin",
      "Gebruik de tweede take voor de laatste zin",
      "[0:08] begint te vroeg, 0,3 s later beginnen",
      "\"shortclip\" moet \"Shortclips\"",
      "[0:15] andere b-roll",
      "[0:20] zet de drie stappen die hij noemt in een kaart",
      "Muziek iets zachter",
      "Gebruik de track \"Upbeat Corporate\"",
      "Ondertiteling iets kleiner en hoger",
      "Beeld is te warm",
    ],
  },
  {
    title: "6. Wat de editor niet doet",
    bullets: [
      "Nieuwe tekst bedenken: geen nieuwe zinnen, claims of woorden in kaarten en ondertitels. Een spellingcorrectie van een gesproken woord kan wel.",
      "Iets laten zeggen wat niet is opgenomen. Dan is een nieuwe opname nodig.",
      "Zonder AI-sleutel herkent de chat alleen vaste formuleringen, zoals de voorbeelden hierboven.",
    ],
  },
  {
    title: "7. Versies en terugzetten",
    paragraphs: [
      "Elke aanpassing wordt een nieuwe versie. Onder Versies kun je een eerdere versie bekijken en met één klik terugzetten. Terugzetten rendert niets opnieuw en is zelf ook weer terug te draaien.",
    ],
  },
  {
    title: "8. Kwaliteitscontrole",
    bullets: [
      "Rood (technisch) blokkeert de export: bijvoorbeeld verkeerde resolutie, te hard of te zacht geluid, zwart beeld, ondertitels buiten beeld of een zin die ontbreekt.",
      "Oranje (creatief advies) blokkeert niets: tempo, hook, shotlengte. Jij beslist.",
    ],
  },
  {
    title: "9. Exporteren",
    paragraphs: [
      "Kies het formaat (standaard 9:16, 1080×1920) en klik op Exporteer in volle kwaliteit. De export wordt opnieuw uit de originele bestanden gemaakt en daarna nog een keer gecontroleerd. Is de video een goed voorbeeld van onze stijl, klik dan op Gebruik deze video als stijlreferentie; Stijlbeheer doet dan een voorstel, dat pas na goedkeuring wordt overgenomen.",
      "Onder Kosten van deze video zie je wat AI, renderen en opslag hebben gekost.",
    ],
  },
];
