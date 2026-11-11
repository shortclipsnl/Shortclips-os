/**
 * Interne prijslijst 2027: centrale databron.
 *
 * Bron: "Shortclips interne prijslijst 2027" versie 1.0 definitief (PDF).
 * Alle bedragen exclusief btw. Wijzig een bedrag alleen hier: de hele pagina
 * (prijzen, tabellen, klantvragen, snelle prijsgids en zoekfunctie) leest uit
 * dit bestand. Niet delen met klanten.
 */

export type Spoor = "org" | "ads";

export const VERSIE = "1.0";

/** Alle bedragen op één plek. */
export const TARIEF = {
  org6: 2325,
  org8: 2950,
  ads6: 2490,
  ads8: 3320,
  feedback: 75,
  reshoot: 95,
  annul7: 395,
  extraOrg: 375,
  extraAds: 450,
  hook: 45,
  spoed: 95,
  km: 0.35,
  reisuur: 50,
  raw: 450,
  coulance: 250,
} as const;

export type TariefKey = keyof typeof TARIEF;

export const eur = (n: number) =>
  "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/** Vervangt {sleutel} door het bedrag uit TARIEF. */
export const vul = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => (k in TARIEF ? eur(TARIEF[k as TariefKey]) : `{${k}}`));

export type Pakket = {
  id: TariefKey; spoor: Spoor; naam: string; eenheid: string;
  n1: string; l1: string; n2?: string; l2?: string; advies?: boolean;
};

export const PAKKETTEN: Pakket[] = [
  { id: "org6", spoor: "org", naam: "Organisch 6", eenheid: "per maand", n1: "6", l1: "shorts per maand" },
  { id: "org8", spoor: "org", naam: "Organisch 8", eenheid: "per maand", n1: "8", l1: "shorts per maand", advies: true },
  { id: "ads6", spoor: "ads", naam: "Ads 6", eenheid: "6 video's x 3 hooks", n1: "6", l1: "basisvideo's", n2: "18", l2: "varianten" },
  { id: "ads8", spoor: "ads", naam: "Ads 8", eenheid: "8 video's x 3 hooks", n1: "8", l1: "basisvideo's", n2: "24", l2: "varianten" },
];

/** Splitsing bovenaan: dezelfde labels in dezelfde volgorde voor beide soorten. */
export const SPLITSING: Record<Spoor, { naam: string; doel: string; kern: string; feiten: { k: string; v: string; nooit?: boolean; open?: boolean }[] }> = {
  org: {
    naam: "Organisch", doel: "Voor bekendheid",
    kern: "Wij maken shorts en publiceren ze zelf op de kanalen van de klant.",
    feiten: [
      { k: "Je levert", v: "Shorts, klaar voor de eigen kanalen" },
      { k: "Wie publiceert", v: "Altijd wij, op onze kalender" },
      { k: "Kanalen", v: "TikTok, Instagram Reels, YouTube Shorts, Facebook" },
      { k: "Prijs", v: "Per maand" },
      { k: "Looptijd", v: "Minimaal 3 maanden, daarna maandelijks opzegbaar" },
      { k: "Nooit erbij", v: "Advertenties en recruitmentcampagnes", nooit: true },
    ],
  },
  ads: {
    naam: "Advertenties", doel: "Voor leads en aanvragen",
    kern: "Wij maken advertentiecreatives. De media buyer van de klant zet ze live.",
    feiten: [
      { k: "Je levert", v: "Basisvideo's met elk 3 hooks, als varianten om te testen" },
      { k: "Wie publiceert", v: "Niet wij. De media buyer van de klant zet live" },
      { k: "Kanalen", v: "Export voor Meta en TikTok Ads" },
      { k: "Prijs", v: "Per maand of per ronde: nog niet vastgesteld", open: true },
      { k: "Looptijd", v: "Minimaal 3 maanden" },
      { k: "Nooit erbij", v: "Live zetten, account, budget, targeting, optimalisatie, mediabudget, organisch publiceren", nooit: true },
    ],
  },
};

/** Niet verwarren: [vraag, organisch, advertenties]. Bij `beide` geldt één antwoord. */
export const VERWARRING: { vraag: string; org: string; ads?: string; beide?: boolean }[] = [
  { vraag: "Wat betekent \"6\" of \"8\"?", org: "**6 of 8 shorts** per maand", ads: "**6 of 8 basisvideo's** x 3 hooks = **18 of 24 varianten**" },
  { vraag: "Wie zet het online?", org: "**Wij publiceren**, altijd, op onze kalender", ads: "**Niet wij.** De media buyer van de klant zet live" },
  { vraag: "Prijs per...?", org: "**Per maand** · Org 6 {org6} · Org 8 {org8}", ads: "**Nog niet vastgesteld** (maand of ronde), vraag het na · Ads 6 {ads6} · Ads 8 {ads8}" },
  { vraag: "Extra video", org: "**{extraOrg}** per video, op een geplande opnamedag", ads: "**{extraAds}** per video, inclusief 3 hooks · extra hook **{hook}**" },
  { vraag: "Feedbackronde inbegrepen", org: "**1 per video**", ads: "**1 per creative**" },
  { vraag: "Montage", org: "Montage, ondertiteling, **kleur en geluid**", ads: "Montage en ondertiteling" },
  { vraag: "Wat lever je na montage?", org: "**Captions, contentkalender en publiceren**", ads: "**Export Meta en TikTok Ads**, afstemming media buyer" },
  { vraag: "Rapportage", org: "**Maandrapport en kwartaalanalyse**", ads: "**Analyse resultaten**" },
  { vraag: "Klant heeft geen media buyer", org: "_Niet van toepassing_", ads: "Eerst **organisch adviseren**, of doorverwijzen" },
  { vraag: "Klant wil allebei", org: "Er is nog geen combinatiepakket: offreer **twee losse pakketten**", beide: true },
];

export type Regel = { t: string; s?: string };
export const INHOUD: Record<Spoor, { ja: Regel[]; nee: Regel[]; weten: { k: string; v: string }[] }> = {
  org: {
    ja: [
      { t: "Strategie en onderwerpen" }, { t: "Hooks en scripts" }, { t: "Scriptmeeting", s: "15 tot 30 min" },
      { t: "1 opnamedag per maand", s: "4 tot 7 uur" }, { t: "Regie op locatie" }, { t: "Montage, ondertiteling, kleur en geluid" },
      { t: "1 feedbackronde per video" }, { t: "Captions en contentkalender" }, { t: "Publiceren" },
      { t: "Maandrapport en kwartaalanalyse" }, { t: "Vast aanspreekpunt en klantportaal" },
    ],
    nee: [
      { t: "Communitymanagement" }, { t: "Advertenties en recruitmentcampagnes" }, { t: "Fotografie en thumbnails" },
      { t: "Bio's en highlights" }, { t: "Raw footage", s: "los mogelijk, {raw} per opnamedag" }, { t: "Montagebestanden" },
    ],
    weten: [
      { k: "Video's niet gebruikt", v: "Inhalen binnen 2 maanden, daarna vervallen" },
      { k: "Reiskosten", v: "Apart, {km} per km" },
    ],
  },
  ads: {
    ja: [
      { t: "Creative strategie en invalshoeken" }, { t: "Scripts" }, { t: "3 hooks per video" }, { t: "Opnamedag en regie" },
      { t: "Montage en ondertiteling" }, { t: "1 feedbackronde per creative" }, { t: "Export Meta en TikTok Ads" },
      { t: "Afstemming media buyer" }, { t: "Analyse resultaten" },
    ],
    nee: [
      { t: "Live zetten" }, { t: "Advertentieaccount beheren" }, { t: "Budgetten en targeting" },
      { t: "Optimalisatie" }, { t: "Mediabudget" }, { t: "Organisch publiceren" },
    ],
    weten: [
      { k: "Per maand of per ronde?", v: "Nog niet vastgesteld, vraag het na" },
      { k: "Combinatie met organisch", v: "Nog geen pakket: offreer twee losse pakketten" },
      { k: "Geen media buyer?", v: "Eerst organisch adviseren, of doorverwijzen" },
    ],
  },
};

/** Extra kosten in een stap: tarief is een TariefKey of een vaste tekst met stijl. */
export type ExtraPost = { wat: string; tarief: TariefKey | { tekst: string; stijl?: "gratis" | "volledig" | "neutraal" | "niet" }; toelichting?: string };

export type Stap = { titel: string; termijn: string; bron: string; opnamedag?: boolean; inbegrepen: string[]; extra: ExtraPost[]; letop: string[] };

/** [ORG] en [ADS] in teksten worden als label getoond. */
export const STAPPEN: Stap[] = [
  { titel: "Offerte", termijn: "30 dagen geldig", bron: "Art. 3.1", inbegrepen: [], extra: [],
    letop: ["Afwijkend tarief? Eerst intern afstemmen", "Ads + organisch: twee losse pakketten offreren"] },
  { titel: "Akkoord en factuur", termijn: "Facturatie vooraf · betaaltermijn 14 dagen", bron: "Art. 7.2 · 7.3", inbegrepen: [], extra: [],
    letop: ["Eerste maand betaald vóór de eerste opname", "Altijd betaald vóór de opnamedag", "Minimaal 3 maanden, niet tussentijds op te zeggen"] },
  { titel: "Kickoff", termijn: "45 minuten · binnen 10 werkdagen", bron: "SOP", inbegrepen: ["Kickoffgesprek"], extra: [], letop: [] },
  { titel: "Strategie", termijn: "14 werkdagen na akkoord", bron: "Offerte",
    inbegrepen: ["Strategie en onderwerpen [ORG]", "Creative strategie en invalshoeken [ADS]"], extra: [], letop: [] },
  { titel: "Scripts", termijn: "Klaar 7 werkdagen vóór opnamedag · goedgekeurd uiterlijk 3 werkdagen vóór", bron: "Offerte · art. 5.3",
    inbegrepen: ["Hooks en scripts", "Scriptmeeting 15 tot 30 min [ORG]", "3 hooks per video [ADS]"],
    extra: [{ wat: "Script na goedkeuring toch anders", tarief: "reshoot", toelichting: "per video opnieuw opnemen" }],
    letop: ["Kleine woordwijzigingen doen we altijd"] },
  { titel: "Opnamedag", opnamedag: true, termijn: "4 tot 7 uur · max 8 uur inclusief pauze", bron: "Art. 6.2",
    inbegrepen: ["1 opnamedag per maand met regie [ORG]", "Opnamedag en regie [ADS]"],
    extra: [
      { wat: "Extra organische video", tarief: "extraOrg", toelichting: "op een geplande opnamedag" },
      { wat: "Extra advertentievideo", tarief: "extraAds", toelichting: "inclusief 3 hooks" },
      { wat: "Reiskosten", tarief: "km", toelichting: "per km, altijd" },
      { wat: "Extra reisuur", tarief: "reisuur", toelichting: "boven 100 km enkele reis" },
      { wat: "Annuleren tot 7 werkdagen vooraf", tarief: { tekst: "€ 0", stijl: "gratis" } },
      { wat: "Annuleren binnen 7 werkdagen", tarief: "annul7" },
      { wat: "Annuleren binnen 24 uur of niet aanwezig", tarief: { tekst: "100%", stijl: "volledig" } },
    ],
    letop: ["Verzetten? Vraag direct welke nieuwe datum past", "Geen tijd? Inhalen binnen 2 maanden, terugbetalen kan niet"] },
  { titel: "Montage en eerste versie", termijn: "Binnen 14 werkdagen na de opname", bron: "Art. 4.2",
    inbegrepen: ["Montage en ondertiteling", "Kleur en geluid [ORG]"],
    extra: [{ wat: "Spoedlevering", tarief: "spoed", toelichting: "per video, binnen 5 werkdagen" }, { wat: "Extra hook", tarief: "hook", toelichting: "per variant" }],
    letop: [] },
  { titel: "Feedback", termijn: "Klant 3 werkdagen, gebundeld · wij verwerken binnen 5 werkdagen", bron: "Art. 11.2 · offerte",
    inbegrepen: ["1 feedbackronde per video [ORG]", "1 feedbackronde per creative [ADS]"],
    extra: [{ wat: "Extra feedbackronde", tarief: "feedback", toelichting: "per ronde, na de inbegrepen ronde" }],
    letop: ["5 werkdagen stil = akkoord", "Vraag om alles in één keer te sturen", "Zelf: 1 gratis extra ronde per klant per kwartaal"] },
  { titel: "Publiceren of export", termijn: "Organisch: door ons, op onze kalender · Ads: export", bron: "Prijslijst",
    inbegrepen: ["Captions, contentkalender en publiceren [ORG]", "Export Meta en TikTok Ads, afstemming media buyer [ADS]"], extra: [],
    letop: ["Ads zetten wij niet live", "Video's niet gebruikt: inhalen binnen 2 maanden, daarna vervallen"] },
  { titel: "Rapport en materiaal", termijn: "Maandelijks en per kwartaal", bron: "Art. 13.5 · 13.6",
    inbegrepen: ["Maandrapport en kwartaalanalyse [ORG]", "Analyse resultaten [ADS]"],
    extra: [
      { wat: "Raw footage", tarief: "raw", toelichting: "per opnamedag, binnen 90 dagen" },
      { wat: "Licenties en beeldrechten", tarief: { tekst: "kostprijs", stijl: "neutraal" }, toelichting: "muziek, locatie, merk" },
      { wat: "Montagebestanden", tarief: { tekst: "Niet inbegrepen", stijl: "niet" }, toelichting: "altijd naar Jarno" },
    ],
    letop: ["Raw footage en montagebestanden: eerst naar Jarno", "Eindvideo's 12 maanden bewaard"] },
];

export type ExtraRegel = { wat: string; tarief: ExtraPost["tarief"]; wanneer: string; spoor?: Spoor };
export const EXTRA_KOSTEN: { categorie: string; stap: string; regels: ExtraRegel[] }[] = [
  { categorie: "Extra content", stap: "Opnamedag · montage", regels: [
    { wat: "Extra organische video", tarief: "extraOrg", wanneer: "Per video, op een geplande opnamedag", spoor: "org" },
    { wat: "Extra advertentievideo", tarief: "extraAds", wanneer: "Per video, inclusief 3 hooks", spoor: "ads" },
    { wat: "Extra hook", tarief: "hook", wanneer: "Per variant", spoor: "ads" },
    { wat: "Spoedlevering", tarief: "spoed", wanneer: "Per video, binnen 5 werkdagen" },
  ] },
  { categorie: "Feedback en wijzigingen", stap: "Scripts · feedback", regels: [
    { wat: "Extra feedbackronde", tarief: "feedback", wanneer: "Per ronde, na de inbegrepen ronde" },
    { wat: "Opnieuw opnemen", tarief: "reshoot", wanneer: "Per video, klant wijzigt goedgekeurd script" },
  ] },
  { categorie: "Opnamedag annuleren of verzetten", stap: "Opnamedag", regels: [
    { wat: "Tot 7 werkdagen vooraf", tarief: { tekst: "€ 0", stijl: "gratis" }, wanneer: "Kosteloos" },
    { wat: "Binnen 7 werkdagen", tarief: "annul7", wanneer: "Vast bedrag" },
    { wat: "Binnen 24 uur of klant niet aanwezig", tarief: { tekst: "100%", stijl: "volledig" }, wanneer: "Volledig" },
  ] },
  { categorie: "Reizen en materiaal", stap: "Opnamedag · na oplevering", regels: [
    { wat: "Reiskosten", tarief: "km", wanneer: "Per km, altijd" },
    { wat: "Extra reisuur", tarief: "reisuur", wanneer: "Boven 100 km enkele reis" },
    { wat: "Raw footage", tarief: "raw", wanneer: "Per opnamedag, binnen 90 dagen" },
    { wat: "Licenties en beeldrechten", tarief: { tekst: "kostprijs", stijl: "neutraal" }, wanneer: "Muziek, locatie, merk" },
    { wat: "Montagebestanden", tarief: { tekst: "Niet inbegrepen", stijl: "niet" }, wanneer: "Nooit standaard, altijd naar Jarno" },
  ] },
];

export const KLANT_STAPPEN = ["Bedank de klant voor de vraag.", "Noem de afspraak en het bedrag uit deze lijst.", "Sluit af met een voorstel.", "Akkoord? Altijd per mail vastleggen."];

export const KLANTVRAGEN: { vraag: string; tarief?: TariefKey; eenheid?: string; tarief2?: TariefKey; eenheid2?: string; tekst?: string; actie: string; spoor?: Spoor }[] = [
  { vraag: "Nog een paar aanpassingen?", tarief: "feedback", eenheid: "per extra ronde, 1 ronde zit erin", actie: "Vraag om alles in één keer te sturen" },
  { vraag: "We willen de opnamedag verzetten.", tarief: "annul7", eenheid: "binnen 7 werkdagen", actie: "Vraag direct welke nieuwe datum past" },
  { vraag: "Mogen we de ruwe beelden?", tarief: "raw", eenheid: "per opnamedag, binnen 90 dagen", actie: "Vraag van welke opnamedag" },
  { vraag: "Script na goedkeuring toch anders?", tarief: "reshoot", eenheid: "per video opnieuw opnemen", actie: "Kleine woordwijzigingen doen we altijd" },
  { vraag: "Waarom reiskosten?", tarief: "km", eenheid: "per km, apart gerekend", actie: "Zo blijft het maandbedrag voor iedereen gelijk" },
  { vraag: "Zetten jullie de ads ook live?", tekst: "Nee, bewust niet", actie: "Wij maken de creatives, hun media buyer zet live. Geen media buyer? We denken mee", spoor: "ads" },
  { vraag: "Geen tijd voor een opname, geld terug?", tekst: "Terugbetalen kan niet", actie: "Inhalen binnen 2 maanden. Zet direct een datum" },
  { vraag: "Kunnen jullie extra video's maken?", tarief: "extraOrg", eenheid: "per organische video", tarief2: "extraAds", eenheid2: "bij ads", actie: "Als het op de opnamedag past. Bevestig dezelfde dag per mail" },
];

export type Afspraak = { k: string; v: string; d: string; ref: string };
export const KERNAFSPRAKEN: Afspraak[] = [
  { k: "Looptijd", v: "3 maanden", d: "Minimaal, niet tussentijds op te zeggen", ref: "9.1" },
  { k: "Opzeggen", v: "1 maand vooraf", d: "Daarna per maand, volle kalendermaand, per mail", ref: "9.2" },
  { k: "Facturatie", v: "Vooraf", d: "Eerste maand vóór de eerste opname", ref: "7.2" },
  { k: "Betaaltermijn", v: "14 dagen", d: "Altijd vóór de opnamedag", ref: "7.3" },
  { k: "Scripts goedgekeurd", v: "3 werkdagen", d: "Uiterlijk vóór de opnamedag", ref: "5.3" },
  { k: "Feedback klant", v: "3 werkdagen", d: "Gebundeld. 5 werkdagen stil = akkoord", ref: "11.2" },
  { k: "Gebruiksrecht", v: "Onbeperkt", d: "Na betaling, organisch en betaald", ref: "13.2" },
];

export const OVERIGE_AFSPRAKEN: { groep: string; items: Afspraak[] }[] = [
  { groep: "Contract en communicatie", items: [
    { k: "Prijsverhoging", v: "1x per jaar", d: "CPI of tot 3%, 1 maand vooraf melden", ref: "7.8" },
    { k: "Offerte", v: "30 dagen", d: "Geldig", ref: "3.1" },
    { k: "Reactie op klant", v: "1 werkdag", d: "Op vragen van de klant", ref: "Offerte" },
  ] },
  { groep: "Rechten en materiaal", items: [
    { k: "Raw footage", v: "90 dagen", d: "Blijft van ons, zo lang bewaard", ref: "13.5" },
    { k: "Eindvideo's", v: "12 maanden", d: "Bewaard", ref: "13.6" },
    { k: "Platformmuziek", v: "Alleen platform", d: "Alleen op dat platform, niet in ads", ref: "13.10" },
    { k: "Na het einde", v: "Wij stoppen", d: "We publiceren niet meer, video's staan klaar", ref: "9.11" },
  ] },
];

/** Wie beslist: [onderwerp, zelf, eerst naar Jarno]. Lege tekst = niet van toepassing. */
export const WIE_BESLIST: [string, string, string][] = [
  ["Korting", "Korting tot 5%", "Korting boven 5% of structureel"],
  ["Coulance en impact", "Coulance tot {coulance}", "Impact boven {coulance}"],
  ["Iets gratis", "1 gratis extra feedbackronde per klant per kwartaal", "Gratis maand of draaidag"],
  ["Extra werk", "", "Extra draaidag · meer dan 2 uur extra editwerk"],
  ["Materiaal", "", "Raw footage of montagebestanden"],
  ["Contract", "", "Contract wijzigen · klant wil stoppen"],
  ["Planning", "Deadline max 2 werkdagen verschuiven", ""],
  ["Advies en uitleg", "Adviesgesprek tot 30 minuten · standaardtarieven uitleggen", ""],
];

export const NOG_OPEN: [string, string][] = [
  ["Ads: per maand of per ronde?", "Nog niet vastgesteld, vraag het na."],
  ["Combinatie organisch + ads", "Nog geen pakket. Offreer twee losse pakketten."],
];

export const GIDS: Record<Spoor, { wat: string; tarief: TariefKey | string }[]> = {
  org: [{ wat: "Extra organische video", tarief: "extraOrg" }, { wat: "Publiceren", tarief: "Inbegrepen" }, { wat: "Video's niet gebruikt", tarief: "Inhalen in 2 mnd" }],
  ads: [{ wat: "Extra advertentievideo (incl. 3 hooks)", tarief: "extraAds" }, { wat: "Extra hook", tarief: "hook" }, { wat: "Live zetten", tarief: "Nee, media buyer klant" }],
};

export const GIDS_BEIDE: { kop: string; regels: { wat: string; tarief: ExtraPost["tarief"] }[] }[] = [
  { kop: "Feedback en wijzigen", regels: [{ wat: "Extra feedbackronde", tarief: "feedback" }, { wat: "Opnieuw opnemen", tarief: "reshoot" }, { wat: "Spoedlevering", tarief: "spoed" }] },
  { kop: "Opnamedag annuleren", regels: [{ wat: "Tot 7 werkdagen vooraf", tarief: { tekst: "€ 0", stijl: "gratis" } }, { wat: "Binnen 7 werkdagen", tarief: "annul7" }, { wat: "Binnen 24 uur / niet aanwezig", tarief: { tekst: "100%", stijl: "volledig" } }] },
  { kop: "Reizen en materiaal", regels: [{ wat: "Reiskosten per km", tarief: "km" }, { wat: "Extra reisuur (>100 km)", tarief: "reisuur" }, { wat: "Raw footage per dag", tarief: "raw" }, { wat: "Montagebestanden", tarief: { tekst: "Niet inbegrepen", stijl: "niet" } }] },
];

export const ALTIJD = ["Strategie", "Scripts", "1 opnamedag", "Montage", "1 feedbackronde", "Publiceren (organisch)", "Rapport"];
export const NOOIT = ["Ads beheren", "Mediabudget", "Community", "Fotografie", "Thumbnails", "Montagebestanden"];
