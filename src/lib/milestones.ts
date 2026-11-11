/**
 * Onze mijlpalen (klantportaal): de awards die een klant samen met Shortclips
 * behaalt. Eén plek voor drempels, namen, materialen en teksten, zodat we dit
 * later kunnen aanpassen zonder door de code te zoeken. Puur (geen database),
 * zodat server en client dezelfde definities gebruiken.
 */

export type MilestoneCategory = "bereik" | "content" | "samenwerking";
export type Metal = "zilver" | "goud" | "platina" | "saffier" | "onyx";

export type AwardDef = {
  key: string;
  category: MilestoneCategory;
  /** Bereik: views. Content: video's. Samenwerking: maanden. */
  threshold: number;
  /** Groot getal in de badge. */
  big: string;
  /** Kleine regel onder het getal in de badge. */
  unit: string;
  name: string;
  metal: Metal;
  description: string;
  congrats: string;
};

export const CATEGORIES: Record<MilestoneCategory, { label: string; sub: string }> = {
  bereik: { label: "Bereik", sub: "Totaal aantal weergaven op alle kanalen" },
  content: { label: "Content", sub: "Gepubliceerde short video's" },
  samenwerking: { label: "Samenwerking", sub: "Duur van onze samenwerking" },
};

export const METALS: Record<Metal, { label: string; stops: [string, string, string, string]; glow: string }> = {
  zilver: { label: "Zilver", stops: ["#f6f8fc", "#c4cad6", "#858fa2", "#eef1f6"], glow: "#9aa4b8" },
  goud: { label: "Goud", stops: ["#fdf0c2", "#e0b95c", "#9a7224", "#f6dc90"], glow: "#d2a548" },
  platina: { label: "Platina", stops: ["#ffffff", "#e3e5ee", "#a5abc0", "#f3f4f9"], glow: "#b9bed2" },
  saffier: { label: "Saffier", stops: ["#7d92f0", "#2d44b8", "#10216a", "#5470d8"], glow: "#2d44b8" },
  onyx: { label: "Onyx", stops: ["#f2f3f8", "#8d91a8", "#2a2c40", "#c9ccdb"], glow: "#4b4e66" },
};

export const AWARDS: AwardDef[] = [
  { key: "views_100k", category: "bereik", threshold: 100_000, big: "100K", unit: "VIEWS", name: "100.000 views", metal: "zilver",
    description: "De eerste 100.000 weergaven op jullie kanalen. Het moment waarop jullie content structureel een publiek begon te bereiken.",
    congrats: "Een sterke start. Jullie eerste 100.000 views staan op de teller, en dit is de basis waarop we verder bouwen." },
  { key: "views_500k", category: "bereik", threshold: 500_000, big: "500K", unit: "VIEWS", name: "500.000 views", metal: "goud",
    description: "Een half miljoen weergaven. Jullie video's worden niet alleen bekeken, ze worden ook actief aangeraden door de platforms.",
    congrats: "Een half miljoen keer werd jullie verhaal bekeken. Dank voor het vertrouwen en de prettige samenwerking." },
  { key: "views_1m", category: "bereik", threshold: 1_000_000, big: "1M", unit: "VIEWS", name: "1 miljoen views", metal: "platina",
    description: "Het eerste miljoen. Een mijlpaal die laat zien dat jullie merk een vaste plek heeft gekregen in de feed van jullie doelgroep.",
    congrats: "Een miljoen weergaven is een echte prestatie. Dank voor de fijne samenwerking op de opnamedagen. Op naar het volgende miljoen." },
  { key: "views_5m", category: "bereik", threshold: 5_000_000, big: "5M", unit: "VIEWS", name: "5 miljoen views", metal: "saffier",
    description: "Vijf miljoen weergaven. Hiermee behoren jullie tot de best bekeken bedrijfskanalen binnen jullie branche.",
    congrats: "Vijf miljoen views. Dit bereik halen maar weinig bedrijven met short video. We zijn trots op wat we samen hebben neergezet." },
  { key: "views_10m", category: "bereik", threshold: 10_000_000, big: "10M", unit: "VIEWS", name: "10 miljoen views", metal: "onyx",
    description: "Tien miljoen weergaven. De hoogste bereikaward van Shortclips, voor merken met een uitzonderlijk sterke online aanwezigheid.",
    congrats: "Tien miljoen views. Dit is de hoogste bereikaward die we uitreiken. Dank voor het vertrouwen en de samenwerking." },

  { key: "videos_10", category: "content", threshold: 10, big: "10", unit: "VIDEO'S", name: "10 video's gepubliceerd", metal: "zilver",
    description: "De eerste tien video's staan online. Genoeg om te zien welke onderwerpen en formats het beste werken voor jullie doelgroep.",
    congrats: "Tien video's live. Daarmee hebben we een goed beeld gekregen van wat jullie kijkers willen zien." },
  { key: "videos_25", category: "content", threshold: 25, big: "25", unit: "VIDEO'S", name: "25 video's gepubliceerd", metal: "goud",
    description: "Vijfentwintig video's. Jullie kanalen hebben een herkenbaar ritme en een vaste stijl die kijkers terug laat komen.",
    congrats: "Vijfentwintig video's betekent consistentie, en consistentie maakt op short video het verschil. Mooi werk samen." },
  { key: "videos_50", category: "content", threshold: 50, big: "50", unit: "VIDEO'S", name: "50 video's gepubliceerd", metal: "platina",
    description: "Vijftig video's. Een volwaardige contentbibliotheek die dagelijks nieuwe kijkers naar jullie merk brengt.",
    congrats: "Vijftig video's live. Jullie bouwen een contentbibliotheek die nog lang nieuwe kijkers blijft opleveren." },
  { key: "videos_100", category: "content", threshold: 100, big: "100", unit: "VIDEO'S", name: "100 video's gepubliceerd", metal: "saffier",
    description: "Honderd video's. Een mijlpaal voor merken die short video structureel als kanaal inzetten.",
    congrats: "Honderd video's. Short video is een vast onderdeel van jullie marketing geworden. Dank voor de samenwerking." },
  { key: "videos_250", category: "content", threshold: 250, big: "250", unit: "VIDEO'S", name: "250 video's gepubliceerd", metal: "onyx",
    description: "Tweehonderdvijftig video's. De hoogste contentaward, voor partners die short video volledig in hun marketing hebben verankerd.",
    congrats: "Tweehonderdvijftig video's. Dit is de hoogste contentaward van Shortclips. We zijn trots op dit partnerschap." },

  { key: "months_3", category: "samenwerking", threshold: 3, big: "3", unit: "MAANDEN", name: "3 maanden samenwerking", metal: "zilver",
    description: "Drie maanden samen. De eerste contentcyclus is doorlopen en de werkwijze staat.",
    congrats: "Drie maanden geleden zijn we begonnen. Dank voor de open houding en de snelle feedback, dat maakt goede content mogelijk." },
  { key: "months_6", category: "samenwerking", threshold: 6, big: "6", unit: "MAANDEN", name: "6 maanden samenwerking", metal: "goud",
    description: "Een half jaar samen. Jullie content draait op een vast ritme van opnamedagen, montage en publicatie.",
    congrats: "Een half jaar samenwerking. We zijn trots op wat we samen hebben neergezet en kijken uit naar wat komt." },
  { key: "months_12", category: "samenwerking", threshold: 12, big: "1", unit: "JAAR", name: "1 jaar samenwerking", metal: "platina",
    description: "Een jaar samen. Een volledige seizoenscyclus aan content en een stevig fundament voor het jaar erna.",
    congrats: "Een jaar samen. Dank voor het vertrouwen. Op naar een tweede jaar vol sterke content." },
  { key: "months_24", category: "samenwerking", threshold: 24, big: "2", unit: "JAAR", name: "2 jaar samenwerking", metal: "saffier",
    description: "Twee jaar samen. Een langdurig partnerschap waarin short video een vast onderdeel van jullie merk is geworden.",
    congrats: "Twee jaar partnerschap. Dat is bijzonder, en we zijn er dankbaar voor." },
];

/** Een award zoals de klant hem ziet: definitie + eigen stand. */
export type AwardState = AwardDef & {
  achieved: boolean;
  /** YYYY-MM-DD, of null als de exacte datum niet bekend is. */
  achievedOn: string | null;
  current: number;
  progressPct: number;
  /** Het daadwerkelijk behaalde resultaat (alleen bij behaald). */
  resultLine: string | null;
  /** "Nog 2 video's" / "Op 20 april 2027" (alleen bij niet behaald). */
  remainingLine: string;
};

export type MilestonesYear = {
  year: number;
  videos: number;
  views: number;
  interactions: number;
  monthly: Array<{ label: string; views: number }>;
  bestVideo: { title: string; views: number; interactions: number; platform: string; publishedAt: string | null; thumbnailUrl: string | null; url: string | null } | null;
  growth: { month: string; prevMonth: string; prevViews: number; views: number; pct: number } | null;
  awardKeys: string[];
  periodLabel: string;
};

/** Eén gepubliceerde video met zijn cijfers (posts op meerdere platforms samengevoegd). */
export type MilestoneVideo = {
  key: string;
  title: string;
  /** YYYY-MM-DD */
  publishedAt: string;
  platforms: Array<{ platform: string; url: string | null; views: number }>;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  /** likes + reacties + shares + opgeslagen */
  interactions: number;
  thumbUrl: string | null;
  /** Afspelen via Frame (in het portaal), als de video zeker gekoppeld is. */
  playSrc: string | null;
  /** Anders: de originele post als ingesloten speler. */
  embedSrc: string | null;
  externalUrl: string | null;
};

/** Een opgeleverde video uit de videobibliotheek (Frame), altijd afspeelbaar. */
export type LibraryVideo = {
  id: string;
  title: string;
  publishedAt: string | null;
  durationSeconds: number | null;
  /** Sleutel van de gekoppelde post met cijfers, als die er zeker is. */
  statsKey: string | null;
};

export type MilestonesData = {
  clientName: string;
  startedOn: string | null;
  daysTogether: number | null;
  totals: { videos: number; views: number; interactions: number; firstVideoOn: string | null };
  awards: AwardState[];
  /** Niet-behaalde awards, de dichtstbijzijnde eerst (één per categorie). */
  next: AwardState[];
  year: MilestonesYear | null;
  /** Fysieke Short Video Award van dit jaar (alleen voor gekozen klanten). */
  physicalAward: { year: number; videos: number; views: number; interactions: number; standOn: string } | null;
  lastUpdated: string | null;
  /** Video's met cijfers, van veel naar weinig weergaven. */
  videos: MilestoneVideo[];
  /** Alle opgeleverde video's uit Frame, nieuwste eerst. */
  library: LibraryVideo[];
};

const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
export const MONTHS_SHORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** "2026-08-26" → "26 augustus 2026" */
export function longDateNl(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}
export function monthNameNl(month0: number): string {
  return MONTHS[month0] ?? "";
}
