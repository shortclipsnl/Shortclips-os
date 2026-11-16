/**
 * Onze visie: de enige bron voor missie, visie, positionering, de vijf
 * kernprincipes, de vertaling per functie, de klantbeloftes, de kwaliteitsvragen
 * en de meetpunten. Alles in het portaal dat hiernaar verwijst (Kennisbank ›
 * Onze visie, Vandaag, Mijn verantwoordelijkheden, Scripting, editorbriefing,
 * draaiboek, Teammeetings) leest uit deze ene plek.
 *
 * Inhoud: Shortclips Visie Voorstel (november 2026, 37 pagina's). Dat document
 * is een voorstel. Daarom start de visie met status "voorstel": alleen de
 * eigenaar ziet haar, tot hij in Beheer op "Vaststellen" klikt. Tekst tussen
 * [[...]] is een norm of aanname die nog bevestigd moet worden: het team ziet
 * gewone tekst, de eigenaar ziet het gemarkeerd.
 *
 * Zodra Jarno in Beheer opslaat, staat de visie in app_settings en is dit
 * bestand alleen nog de terugvaloptie ("terug naar voorstel").
 */

export type Functie = "content_creative" | "videograaf" | "editor" | "directie";

export type Principe = {
  nr: number;
  titel: string;
  uitleg: string;
  /** Eén concreet voorbeeld uit de praktijk. */
  praktijk: string;
  /** Gewenst gedrag. */
  wel: string;
  /** Ongewenst gedrag. */
  niet: string;
};

export type FunctieVisie = {
  label: string;
  titel: string;
  /** Waarom deze functie bestaat en wat de visie ervoor betekent. */
  betekenis: string;
  verantwoordelijkheid: string;
  standaard: string;
  bijdrage: string;
  proactief: string;
  wel: string;
  niet: string;
};

export type Meetpunt = {
  key: "voorgedaan" | "leerlus" | "eenkeergoed" | "ontzorgd" | "waarde";
  titel: string;
  soort: "wij_sturen" | "klant_merkt";
  vraag: string;
  meting: string;
  bron: string;
  norm: string;
  status: "bestaat" | "aanpassen" | "nieuw";
};

export type VerderDanDeTaak = { principe: number; tekst: string };

export type OpenBesluit = { id: string; vraag: string; voorstel: string; besloten: boolean };

export type Visie = {
  versie: 1;
  status: "voorstel" | "definitief";
  vastgesteldOp: string | null;
  bijgewerktOp: string | null;
  positionering: string;
  centraleGedachte: string;
  missie: string;
  visie: string;
  waarom: { titel: string; kaarten: { titel: string; tekst: string }[]; conclusie: string };
  principes: Principe[];
  functies: Record<Functie, FunctieVisie>;
  ondersteunend: { rol: string; tekst: string }[];
  situaties: { situatie: string; wel: string; niet: string }[];
  vergelijking: { onderwerp: string; leverancier: string; afdeling: string }[];
  beloftes: string[];
  klantDoet: string[];
  verwachtingen: string[];
  kwaliteitsvragen: { scripting: string[]; editing: string[]; opname: string[] };
  /** Per verantwoordelijkheid (sleutel = id zonder persoonsnaam, bv. "cc-scripts"). */
  verderDanDeTaak: Record<string, VerderDanDeTaak>;
  meetpunten: Meetpunt[];
  inwerken: { moment: string; vragen: string[] }[];
  klantVanDeWeek: string[];
  openBesluiten: OpenBesluit[];
};

export const FUNCTIES: Functie[] = ["content_creative", "videograaf", "editor", "directie"];

const PRINCIPES: Principe[] = [
  {
    nr: 1, titel: "Klaar is als het werkt",
    uitleg: "Een taak is pas af als die bijdraagt aan wat de klant ermee wil. Niet als het bestand verstuurd is.",
    praktijk: "De editor kijkt of de opening in twee seconden pakt, niet alleen of de montage klopt.",
    wel: "Het script ligt klaar en je vraagt nog één keer: waarom werkt dit voor deze doelgroep? Zo niet, dan herschrijf je.",
    niet: "Versturen omdat de taak af is.",
  },
  {
    nr: 2, titel: "Wij zijn de klant voor",
    uitleg: "De klant hoeft nooit te vragen hoe het ervoor staat. Wij melden eerst, met een voorstel.",
    praktijk: "[[Opnames staan drie maanden vooruit vast.]] Bij een probleem eerst een oplossing, dan het bericht.",
    wel: "De klant reageert drie dagen niet op scripts: je belt met één concreet voorstel.",
    niet: "Wachten, of iets opschuiven zonder het te melden.",
  },
  {
    nr: 3, titel: "Cijfers sturen de volgende video",
    uitleg: "Wat we leren uit resultaten komt terug in het volgende script. Elke maand een stap beter.",
    praktijk: "Elk script noemt één les uit het Contentgeheugen van die klant.",
    wel: "Een video presteert slecht: je benoemt het zelf in de maandrapportage, met wat we daardoor veranderen.",
    niet: "Het weglaten of wijten aan het algoritme.",
  },
  {
    nr: 4, titel: "Hun mensen, hun verhaal",
    uitleg: "We kennen het bedrijf beter dan een creator in loondienst. Echte mensen, eigen locatie, eigen toon.",
    praktijk: "Voor elk script: wat speelt er nu bij de klant? Nieuws, een vacature, een nieuw product.",
    wel: "Mensen op hun gemak stellen en een take overdoen als het beter kan.",
    niet: "Generieke content maken die bij elk bedrijf had kunnen staan.",
  },
  {
    nr: 5, titel: "Eén keer goed",
    uitleg: "De klant vindt geen fouten. [[Liever een dag later dan een correctieronde.]]",
    praktijk: "Eindcontrole op elke video. Eén gebundelde feedbackronde is de norm, geen uitzondering.",
    wel: "Je ziet bij de eindcontrole nog een fout en lost die op voordat de video naar de klant gaat.",
    niet: "Opleveren en de klant de fouten laten vinden.",
  },
];

const FUNCTIE_VISIE: Record<Functie, FunctieVisie> = {
  content_creative: {
    label: "Content Creative",
    titel: "Jij bent voor jouw klanten de afdeling",
    betekenis: "De klant ervaart Shortclips via jou. Als jij het overzicht hebt, voelt de klant zich ontzorgd. Projectmanager, scriptschrijver en strateeg zijn bij ons één persoon.",
    verantwoordelijkheid: "De onderdelen op Mijn verantwoordelijkheden, van contentstrategie tot verlenging. Daarbovenop: per klant weten wat de content deze maand opleverde.",
    standaard: "Script klaar 7 werkdagen voor de draaidag en gebouwd op een les uit eigen data. Elke maandrapportage bevat minstens één verandering voor de volgende maand.",
    bijdrage: "Jij bepaalt wat er gemaakt wordt. Dat is de grootste hefboom op het resultaat.",
    proactief: "Bij elke oplevering één observatie meesturen. Klantnieuws zelf omzetten in een idee.",
    wel: "De klant bellen voordat hij moet vragen hoe het staat.",
    niet: "\"Ik wacht nog op de klant\" zonder herinnering, deadline of alternatief.",
  },
  videograaf: {
    label: "Videograaf",
    titel: "Het enige moment dat we bij de klant zijn",
    betekenis: "Op de opnamedag ben jij de afdeling. Hoe de mensen van de klant zich voelen voor de camera, bepaalt hoe echt de video wordt.",
    verantwoordelijkheid: "Draaiboek doornemen, alle scripts van de dag opnemen, B-roll per video, notities inspreken en het materiaal naar de editor.",
    standaard: "Elk script opgenomen met een bruikbare eerste twee seconden en minimaal één alternatieve take van de hook. Materiaal binnen 24 uur overgedragen.",
    bijdrage: "Een hook werkt alleen als beeld en energie kloppen. Een goed opgenomen opening voorkomt een correctieronde en een zwakke video.",
    proactief: "Op locatie een sterker moment zien (een product, een collega met humor) en dat extra opnemen, met een ingesproken notitie voor de Content Creative.",
    wel: "Mensen op hun gemak stellen en een take overdoen als het beter kan.",
    niet: "Alleen afvinken wat in het draaiboek staat en weg zijn.",
  },
  editor: {
    label: "Editor",
    titel: "Jij beslist of iemand blijft kijken",
    betekenis: "Montage is waar kijkersbehoud ontstaat. Je monteert niet een script, je maakt een video waar iemand niet van wegscrollt.",
    verantwoordelijkheid: "Monteren volgens script, Editing Guide en briefing, binnen je editor deadline, met de statuscheck halverwege.",
    standaard: "Opening zonder geluid te begrijpen. Ondertitels nooit over gezichten of producten. Geen interne correctieronde nodig.",
    bijdrage: "De eerste twee seconden en het tempo bepalen de kijkduur. Kijkduur bepaalt of een video verder komt dan de bestaande volgers.",
    proactief: "Voelt een opening zwak? Lever een alternatieve opening mee als tweede versie, of een korte notitie waarom.",
    wel: "Een betere versie voorstellen dan het script vraagt, en dat melden.",
    niet: "Leveren wat gevraagd is terwijl je ziet dat het beter kan.",
  },
  directie: {
    label: "Directie en sales",
    titel: "De visie bewaken, niet elke taak",
    betekenis: "De directie bewaakt de standaard en controleert niet de uitvoering. Jarno is nooit de standaardverantwoordelijke voor een klanttaak.",
    verantwoordelijkheid: "Richting en positionering, kwaliteit van het aanbod, sales en offertes, besluiten op niveau 4 en maandelijks de vijf meetpunten bespreken.",
    standaard: "Elke offerte en elk salesgesprek verkoopt een afdeling. Nooit een prijs per video, nooit een belofte over groei die we niet beheersen.",
    bijdrage: "Klanten die passen. Een verkeerde klant kost het team meer dan hij oplevert.",
    proactief: "Bij elke escalatie terugvragen: welk principe speelt hier, en wat stel jij voor?",
    wel: "Een vraag terugleggen bij het team met \"wat stel je voor?\".",
    niet: "Het zelf oplossen omdat het sneller gaat.",
  },
};

const VERDER: Record<string, VerderDanDeTaak> = {
  "cc-strategie": { principe: 3, tekst: "Elk idee noemt waarom het voor deze klant gaat werken, met een les uit het Contentgeheugen." },
  "cc-scripts": { principe: 1, tekst: "Niet alleen scripts schrijven en versturen. Voor je verstuurt nog één keer: pakt de eerste zin binnen twee seconden, en waarom werkt dit voor deze doelgroep?" },
  "cc-planning": { principe: 2, tekst: "De klant hoeft nooit te vragen wanneer de volgende opname is. Die staat al vast." },
  "cc-klantcontact": { principe: 2, tekst: "Niet alleen berichten beantwoorden. Informeer de klant voordat die ergens naar moet vragen." },
  "cc-editing": { principe: 5, tekst: "Kijk niet alleen of de montage klopt, maar of de opening sterk genoeg is om de aandacht vast te houden." },
  "cc-oplevering": { principe: 2, tekst: "Stuur bij elke oplevering één observatie mee, zodat de klant ziet dat we meedenken." },
  "cc-publicatie": { principe: 3, tekst: "Gepubliceerd is niet klaar. Kijk wat de video deed en neem dat mee naar het volgende script." },
  "cc-rapportage": { principe: 3, tekst: "Elke rapportage bevat minstens één verandering voor de volgende maand, ook als een video tegenviel." },
  "cc-verlenging": { principe: 2, tekst: "Wacht niet op het verlengmoment. Laat de hele looptijd zien wat de samenwerking oplevert." },
  "ru-voorbereiding": { principe: 4, tekst: "Weet voor de opname wat er nu speelt bij de klant en wie er voor de camera staat." },
  "ru-productie": { principe: 4, tekst: "Stel mensen op hun gemak en neem van elke hook minimaal één alternatieve take op." },
  "ru-kwaliteit": { principe: 5, tekst: "Een goed opgenomen opening voorkomt een correctieronde en een zwakke video." },
  "ru-selectie": { principe: 1, tekst: "Zag je op locatie een sterker moment? Neem het extra op en spreek een notitie in voor de Content Creative." },
  "ru-briefing": { principe: 1, tekst: "De briefing zegt niet alleen hoe de video gemonteerd wordt, maar ook waarom hij moet werken." },
  "ru-overdracht": { principe: 5, tekst: "De editor kan beginnen zonder één vraag te stellen." },
};

const MEETPUNTEN: Meetpunt[] = [
  { key: "voorgedaan", titel: "Voorgedaan", soort: "wij_sturen", vraag: "Doen we zelf verbetervoorstellen?", meting: "Klanten met minstens één eigen verbetervoorstel per maand", bron: "Verbeterpunten in de maandrapportage", norm: "[[100%]]", status: "bestaat" },
  { key: "leerlus", titel: "Leerlus", soort: "wij_sturen", vraag: "Gebruiken we resultaten voor nieuwe content?", meting: "Scripts die aantoonbaar voortbouwen op eigen klantdata", bron: "Script Engine en Contentgeheugen", norm: "[[80%]]", status: "aanpassen" },
  { key: "eenkeergoed", titel: "Eén keer goed", soort: "wij_sturen", vraag: "Leveren we op met zo min mogelijk correctierondes?", meting: "Video's goedgekeurd binnen één feedbackronde", bron: "Kolom Feedbackrondes op Editing", norm: "[[90%]]", status: "bestaat" },
  { key: "ontzorgd", titel: "Ontzorgd", soort: "klant_merkt", vraag: "Ervaren klanten daadwerkelijk minder werk?", meting: "Eén vraag per kwartaal: hoe vaak moest je zelf achter iets aan? (1 tot 10)", bron: "[[Kwartaalreview of klantportaal, nog in te richten]]", norm: "[[8 of hoger]]", status: "nieuw" },
  { key: "waarde", titel: "Aantoonbare waarde", soort: "klant_merkt", vraag: "Kunnen we laten zien welke ontwikkeling we realiseren?", meting: "Trend over drie maanden in weergaven en kijkduur ten opzichte van het eigen startpunt, plus looptijd", bron: "Resultaten en Contracten", norm: "[[Stijgend]]", status: "bestaat" },
];

const OPEN_BESLUITEN: OpenBesluit[] = [
  { id: "richting", vraag: "Missie, visie en positionering: richting A (de afdeling) akkoord?", voorstel: "Ja. Sluit aan op wat al op de site staat en het team herkent zichzelf erin.", besloten: false },
  { id: "afdeling", vraag: "Overal \"externe short video afdeling\" in plaats van contentafdeling?", voorstel: "Ja. Contentafdeling belooft meer dan short video. In de klantpresentatie en de AI-context van het portaal staat nu nog contentafdeling; die pas ik aan na jouw akkoord.", besloten: false },
  { id: "inrichtingen", vraag: "Extern één afdeling met drie inrichtingen, intern de drie afdelingen (Organisch, Advertentie, Compleet)?", voorstel: "Ja.", besloten: false },
  { id: "snelheid", vraag: "Snelheid uit de waarden halen en als leverbelofte (14 werkdagen) behouden?", voorstel: "Ja. Als waarde botst snelheid met structureel en met eerst goed.", besloten: false },
  { id: "lessen", vraag: "Mogen de kennisbanklessen 1.4, 1.5, 2.1 en 2.3 vervallen en verwijzen naar Onze visie?", voorstel: "Ja, na controle dat er geen afspraken verloren gaan. Tot dan blijven de lessen staan met een verwijzing erboven.", besloten: false },
  { id: "normen", vraag: "Zijn de normen van de vijf meetpunten akkoord (100%, 80%, 90%, 8 of hoger, stijgend)?", voorstel: "Eerst één kwartaal meten zonder norm, daarna vastleggen.", besloten: false },
  { id: "driemaanden", vraag: "Opnames drie maanden vooruit vastleggen en \"liever een dag later dan een correctieronde\": gelden die als vaste afspraak?", voorstel: "Te bevestigen. De 14 werkdagen blijven leidend voor de oplevering.", besloten: false },
];

export function standaardVisie(): Visie {
  return {
    versie: 1,
    status: "voorstel",
    vastgesteldOp: null,
    bijgewerktOp: null,
    positionering: "Shortclips is de externe short video afdeling van marketingteams.",
    centraleGedachte: "Je koopt geen losse video's. Je krijgt een short video afdeling die elke week voor je draait, meet wat werkt en het de maand erna beter doet.",
    missie: "Wij nemen short video volledig over voor bedrijven die serieus met marketing bezig zijn. Elke week zichtbaar, met hun eigen mensen in beeld, en elke maand een stap beter dan de maand ervoor.",
    visie: "Short video hoort bij een marketingteam zoals een website: altijd aan, nooit een losse actie. Wij willen de afdeling zijn die een marketingmanager belt in plaats van een creator aan te nemen.",
    waarom: {
      titel: "Marketingteams doen alles, behalve short video volhouden",
      kaarten: [
        { titel: "Het wordt intern geprobeerd", tekst: "Iemand pakt het erbij, naast SEO, de website en fotografie. Short video vraagt strategie, scripts, opnames, montage en bijsturing tegelijk." },
        { titel: "De consistentie ontbreekt", tekst: "Een paar weken vol gas, dan een drukke maand en het kanaal ligt stil. Of er komt één creator, zonder team en zonder vervanging." },
        { titel: "Niemand weet wat werkt", tekst: "Er wordt gepost zonder plan. Niemand kijkt wat een video deed, dus de volgende wordt niet beter." },
      ],
      conclusie: "Daarom bestaan wij. Een team van specialisten dat short video overneemt, elke week levert en elke maand leert. De klant regelt een opnamedag en een akkoord. De rest loopt.",
    },
    principes: PRINCIPES.map((p) => ({ ...p })),
    functies: Object.fromEntries(FUNCTIES.map((f) => [f, { ...FUNCTIE_VISIE[f] }])) as Record<Functie, FunctieVisie>,
    ondersteunend: [
      { rol: "Freelance videograaf", tekst: "Werkt met dezelfde draaiboekstandaard als de vaste videograaf en heeft één vast aanspreekpunt binnen Shortclips." },
      { rol: "Brand designer", tekst: "Elk document dat de deur uitgaat ziet eruit als een afdeling, niet als een freelancer. Principe 5: de klant vindt geen fouten." },
      { rol: "Presentator", tekst: "Zet de mensen van de klant op hun gemak. Principe 4: hun mensen, hun verhaal." },
    ],
    situaties: [
      { situatie: "Klant reageert 3 dagen niet op scripts", wel: "Bellen met één concreet voorstel: \"Zal ik ze zo goedkeuren, of plannen we 10 minuten?\"", niet: "Wachten, of het opschuiven zonder melding." },
      { situatie: "Video's zijn goedgekeurd", wel: "Meteen met de contentplanning in één bericht naar de klant, met één observatie erbij.", niet: "Losse berichten, of \"zie bijlage\"." },
      { situatie: "Een video presteert slecht", wel: "Zelf benoemen in de maandrapportage, met wat we daardoor veranderen.", niet: "Weglaten of wijten aan het algoritme." },
      { situatie: "Script ligt klaar, deadline gehaald", wel: "Nog één keer: waarom werkt dit voor deze doelgroep? Zo niet, herschrijven.", niet: "Versturen omdat de taak af is." },
      { situatie: "Editor levert te laat", wel: "Zelf een oplossing regelen (back-up editor) en de klant pas informeren als het oplevermoment raakt.", niet: "Direct naar Jarno met het probleem." },
      { situatie: "Klant vraagt \"wat kost één video?\"", wel: "\"Wij verkopen geen losse video's maar een afdeling\" en uitleggen wat erbij hoort.", niet: "Een prijs per video noemen of narekenen." },
    ],
    vergelijking: [
      { onderwerp: "Het begint met", leverancier: "\"Wat wil je laten maken?\"", afdeling: "\"Wat moet het opleveren?\"" },
      { onderwerp: "Initiatief", leverancier: "De klant vraagt", afdeling: "Wij stellen voor, de klant keurt goed" },
      { onderwerp: "Scripts", leverancier: "Op basis van wat de klant aanlevert", afdeling: "Op basis van data en kennis van het bedrijf" },
      { onderwerp: "Planning", leverancier: "Per opdracht", afdeling: "[[Drie opnames vooruit vastgelegd]]" },
      { onderwerp: "Na de levering", leverancier: "Klaar", afdeling: "We kijken wat het deed" },
      { onderwerp: "Cijfers", leverancier: "Niet ons probleem", afdeling: "Sturen de volgende maand" },
      { onderwerp: "Als het tegenvalt", leverancier: "Uitleggen waarom het niet aan ons lag", afdeling: "Zelf melden, met een plan" },
      { onderwerp: "Succes is", leverancier: "Video's geleverd", afdeling: "De klant wordt beter zichtbaar en hoeft niet achter ons aan" },
    ],
    beloftes: [
      "Je hoeft nooit te vragen hoe het ervoor staat. Wij melden eerst.",
      "Je content staat volgens planning online, in een vast ritme.",
      "Elke maand hoor je wat het opleverde en wat we daarom anders doen.",
      "Jouw mensen en jouw verhaal, nooit generieke content.",
      "Wat we opleveren is gecontroleerd. Je hoeft geen fouten te zoeken.",
    ],
    klantDoet: [
      "Eén vaste contactpersoon die beslist",
      "Opnamedagen vastleggen",
      "Scripts en video's akkoord geven, gebundeld binnen 72 uur",
      "Nieuws, acties en vacatures met ons delen",
    ],
    verwachtingen: [
      "Voor elke taak de vraag: werkt dit voor de klant?",
      "Eerst melden, dan de klant laten vragen. Nooit andersom.",
      "Bij elk probleem een eigen voorstel (Beslissingshulp).",
      "Elke maand één verandering die uit de cijfers komt.",
      "Weten wat er speelt bij je klant, ook buiten de content.",
    ],
    kwaliteitsvragen: {
      scripting: [
        "Waarom gaat deze video werken voor deze specifieke doelgroep?",
        "Welke les of welk resultaat uit het Contentgeheugen van deze klant gebruik ik?",
        "Is de opening sterk genoeg om binnen twee seconden aandacht te trekken?",
      ],
      editing: [
        "Is de opening zonder geluid te begrijpen?",
        "Staat er nergens tekst over een gezicht of product?",
        "Zou je zelf doorkijken na drie seconden?",
      ],
      opname: [
        "Neem van elke hook minimaal één alternatieve take op.",
        "Zie je een sterker moment dan in het script staat? Neem het extra op.",
        "Spreek verbeterpunten in als notitie voor de Content Creative.",
      ],
    },
    verderDanDeTaak: Object.fromEntries(Object.entries(VERDER).map(([k, v]) => [k, { ...v }])),
    meetpunten: MEETPUNTEN.map((m) => ({ ...m })),
    inwerken: [
      { moment: "Na 30 dagen", vragen: ["Kun je uitleggen waarom klanten voor Shortclips kiezen?", "Weet je waarvoor jij verantwoordelijk bent?"] },
      { moment: "Na 60 dagen", vragen: ["Kun je uitleggen wat proactief werken in jouw functie betekent?", "Kun je daar twee voorbeelden van geven uit je eigen werk?"] },
      { moment: "Na 90 dagen", vragen: ["Weet je hoe jouw werk bijdraagt aan het resultaat van de klant?", "Welk principe gaat je goed af, en welk nog niet?"] },
    ],
    klantVanDeWeek: [
      "Wat hebben we deze week voor deze klant bereikt?",
      "Wat hebben we geleerd?",
      "Wat kunnen we verbeteren?",
      "Welk kernprincipe zien we hierin terug?",
    ],
    openBesluiten: OPEN_BESLUITEN.map((b) => ({ ...b })),
  };
}

/** Haalt de voorstel-markering weg: wat het team ziet. */
export const kaal = (t: string) => t.replace(/\[\[(.+?)\]\]/g, "$1");

/** Sleutel voor "Verder dan de taak": de Content Creatives delen één set. */
export function verderSleutel(verantwoordelijkheidId: string): string {
  return verantwoordelijkheidId.replace(/^(milou|jiska)-/, "cc-");
}

/** De functie binnen de visie die bij een portaalrol hoort. */
export function functieVoorRol(primaryRole: string, isEditor: boolean): Functie {
  if (primaryRole === "owner" || primaryRole === "admin") return "directie";
  if (primaryRole === "videographer") return "videograaf";
  if (isEditor || primaryRole === "editor") return "editor";
  return "content_creative";
}

/** ISO-weeknummer (Amsterdam maakt hier geen verschil: we rekenen op de datum). */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dag);
  const jaarStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - jaarStart.getTime()) / 86400000 + 1) / 7);
}

/** Het principe van de week: wisselt automatisch op maandag. */
export function principeVanDeWeek(v: Visie, d = new Date()): Principe | null {
  if (v.principes.length === 0) return null;
  return v.principes[isoWeek(d) % v.principes.length];
}

/* ------------------------------------------------------------------ */
/* Controle bij opslaan: alleen bekende velden, begrensde lengtes.      */
/* ------------------------------------------------------------------ */

const str = (x: unknown, max = 500) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const lijst = (x: unknown, basis: string[], max = 12): string[] => {
  if (!Array.isArray(x)) return [...basis];
  return x.map((y) => str(y)).filter(Boolean).slice(0, max);
};

export function normaliseer(input: unknown): Visie {
  const i = (input ?? {}) as Partial<Visie>;
  const b = standaardVisie();
  const of = (x: unknown, terugval: string, max = 500) => str(x, max) || terugval;

  const principes: Principe[] = (Array.isArray(i.principes) && i.principes.length > 0 ? i.principes : b.principes).slice(0, 7).flatMap((p, idx): Principe[] => {
    const titel = str(p?.titel, 80);
    if (!titel) return [];
    return [{ nr: idx + 1, titel, uitleg: str(p?.uitleg), praktijk: str(p?.praktijk), wel: str(p?.wel), niet: str(p?.niet) }];
  });

  const functies = {} as Record<Functie, FunctieVisie>;
  for (const f of FUNCTIES) {
    const x = (i.functies?.[f] ?? {}) as Partial<FunctieVisie>;
    const s = b.functies[f];
    functies[f] = {
      label: s.label,
      titel: of(x.titel, s.titel, 120), betekenis: of(x.betekenis, s.betekenis), verantwoordelijkheid: of(x.verantwoordelijkheid, s.verantwoordelijkheid),
      standaard: of(x.standaard, s.standaard), bijdrage: of(x.bijdrage, s.bijdrage), proactief: of(x.proactief, s.proactief),
      wel: of(x.wel, s.wel), niet: of(x.niet, s.niet),
    };
  }

  const verderDanDeTaak: Record<string, VerderDanDeTaak> = {};
  const vd = (i.verderDanDeTaak && typeof i.verderDanDeTaak === "object" ? i.verderDanDeTaak : b.verderDanDeTaak) as Record<string, Partial<VerderDanDeTaak>>;
  for (const [k, v] of Object.entries(vd).slice(0, 80)) {
    const tekst = str(v?.tekst, 300);
    const sleutel = str(k, 60);
    if (!tekst || !sleutel) continue;
    const nr = Math.round(Number(v?.principe));
    verderDanDeTaak[sleutel] = { principe: nr >= 1 && nr <= principes.length ? nr : 1, tekst };
  }

  const meetpunten: Meetpunt[] = b.meetpunten.map((s) => {
    const x = (Array.isArray(i.meetpunten) ? i.meetpunten.find((m) => m?.key === s.key) : null) as Partial<Meetpunt> | null | undefined;
    return { ...s, vraag: of(x?.vraag, s.vraag, 200), meting: of(x?.meting, s.meting, 240), bron: of(x?.bron, s.bron, 200), norm: of(x?.norm, s.norm, 60) };
  });

  const paren = <T extends Record<string, string>>(x: unknown, basis: T[], keys: (keyof T & string)[], max: number): T[] => {
    if (!Array.isArray(x)) return basis.map((r) => ({ ...r }));
    return x.slice(0, max).flatMap((y): T[] => {
      const r = (y ?? {}) as Record<string, unknown>;
      const uit = Object.fromEntries(keys.map((k) => [k, str(r[k])])) as T;
      return uit[keys[0]] ? [uit] : [];
    });
  };

  const openBesluiten: OpenBesluit[] = (Array.isArray(i.openBesluiten) ? i.openBesluiten : b.openBesluiten).slice(0, 20).flatMap((o): OpenBesluit[] => {
    const vraag = str(o?.vraag, 300);
    if (!vraag) return [];
    return [{ id: str(o?.id, 40) || `b${Math.random().toString(36).slice(2, 8)}`, vraag, voorstel: str(o?.voorstel, 400), besloten: o?.besloten === true }];
  });

  return {
    versie: 1,
    status: i.status === "definitief" ? "definitief" : "voorstel",
    vastgesteldOp: typeof i.vastgesteldOp === "string" ? i.vastgesteldOp : null,
    bijgewerktOp: typeof i.bijgewerktOp === "string" ? i.bijgewerktOp : null,
    positionering: of(i.positionering, b.positionering, 240),
    centraleGedachte: of(i.centraleGedachte, b.centraleGedachte, 400),
    missie: of(i.missie, b.missie, 600),
    visie: of(i.visie, b.visie, 600),
    waarom: {
      titel: of(i.waarom?.titel, b.waarom.titel, 160),
      kaarten: paren(i.waarom?.kaarten, b.waarom.kaarten, ["titel", "tekst"], 4),
      conclusie: of(i.waarom?.conclusie, b.waarom.conclusie, 500),
    },
    principes,
    functies,
    ondersteunend: paren(i.ondersteunend, b.ondersteunend, ["rol", "tekst"], 8),
    situaties: paren(i.situaties, b.situaties, ["situatie", "wel", "niet"], 12),
    vergelijking: paren(i.vergelijking, b.vergelijking, ["onderwerp", "leverancier", "afdeling"], 12),
    beloftes: lijst(i.beloftes, b.beloftes, 8),
    klantDoet: lijst(i.klantDoet, b.klantDoet, 8),
    verwachtingen: lijst(i.verwachtingen, b.verwachtingen, 8),
    kwaliteitsvragen: {
      scripting: lijst(i.kwaliteitsvragen?.scripting, b.kwaliteitsvragen.scripting, 5),
      editing: lijst(i.kwaliteitsvragen?.editing, b.kwaliteitsvragen.editing, 5),
      opname: lijst(i.kwaliteitsvragen?.opname, b.kwaliteitsvragen.opname, 5),
    },
    verderDanDeTaak,
    meetpunten,
    inwerken: (Array.isArray(i.inwerken) ? i.inwerken : b.inwerken).slice(0, 4).flatMap((m) => {
      const moment = str(m?.moment, 40);
      return moment ? [{ moment, vragen: lijst(m?.vragen, [], 5) }] : [];
    }),
    klantVanDeWeek: lijst(i.klantVanDeWeek, b.klantVanDeWeek, 6),
    openBesluiten,
  };
}
