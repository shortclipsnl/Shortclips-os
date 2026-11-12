/**
 * Koppeling contentplanning ↔ Frame-video's (pure logica, zonder database).
 *
 * Een bericht in de contentplanning heet bijvoorbeeld
 *   "Koops Short online > 16:00 > Wat kies jij?"
 * en de video in Frame
 *   "3. WAT KIES JIJ - Shortclips.mp4" (in sessie 5, submap v4).
 * Beide worden teruggebracht tot dezelfde sleutel ("wat kies jij"), zodat de
 * planning automatisch de juiste video vindt. Van één video bestaan vaak
 * meerdere versies (V1..V4, "V2 ..."); we kiezen altijd de nieuwste.
 *
 * Bewust voorzichtig: alleen een eenduidige, sterke match wordt automatisch
 * gekoppeld. Twijfel = geen koppeling (dan kiest de medewerker zelf).
 */

export type MatchableVideo = {
  id: string;
  name: string;
  clientId: string;
  sessionKey: string;
  sessionName: string | null;
  sessionCreatedAt: Date | null;
  sessionProductionDayId: string | null;
  subfolder: string | null;
  frameCreatedAt: Date | null;
  versionCount: number;
};

/** Woorden die in agendatitels en bestandsnamen staan maar niets over de inhoud zeggen. */
const NOISE = new Set([
  "short", "shorts", "online", "video", "videos", "post", "reel", "reels", "shortclips", "clip",
  "organisch", "organische", "ad", "ads", "nog", "afstemmen", "uur", "om", "versie", "final", "def", "definitief",
  "ingepland", "gepland", "plaatsen", "posten", "concept",
  "tiktok", "instagram", "youtube", "linkedin", "facebook",
]);

function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Losse woorden uit een tekst: kleine letters, zonder accenten, leestekens en ruis. */
export function tokens(text: string, clientName?: string | null): string[] {
  const clientWords = clientName ? tokens(clientName) : [];
  // Klantnaam los én aan elkaar ("Auto Christiaan" en "Autochristiaan").
  const client = new Set(clientWords.length > 1 ? [...clientWords, clientWords.join("")] : clientWords);
  return deaccent(text.toLowerCase())
    .replace(/(\d)[.,](\d)/g, "$1$2") // 24.000 → 24000
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0 && !NOISE.has(w) && !client.has(w));
}

/** Versienummer uit naam of submap: "V2 Titel", "titel v3", submap "V4" → 2/3/4; anders 1. */
export function versionOf(name: string, subfolder: string | null): number {
  let v = 1;
  const fromName = name.match(/(?:^|[\s_-])v(\d{1,2})(?=[\s_.-]|$)/i);
  if (fromName) v = Math.max(v, Number(fromName[1]));
  const fromFolder = subfolder?.trim().match(/^v(?:ersie)?\s*(\d{1,2})$/i);
  if (fromFolder) v = Math.max(v, Number(fromFolder[1]));
  return v;
}

/** Inhoudelijke sleutel van een Frame-bestand (zonder nummering, versie, extensie en klantnaam). */
export function videoKey(name: string, clientName?: string | null): string {
  const t = name
    .replace(/\.(mp4|mov|m4v|mkv|webm)$/i, "")
    .replace(/(_\d+|\s*\(\d+\))$/i, "") // "_1", " (1)": kopieën van dezelfde export
    .replace(/^\s*v\d{1,2}\b\s*/i, "") // "V2 4. ..."
    .replace(/^\s*video\s*\d{1,3}\b\s*/i, "") // "Video 5 ..."
    .replace(/^\s*\d{1,3}(?:\.\d{1,2})?\s*[.)-]?\s+/, "") // "3. ", "2.2 ", "1.2 "
    .replace(/[\s-]*shortclips\b.*$/i, ""); // "- Shortclips" en alles erachter
  return tokens(t, clientName).filter((w) => !/^v\d{1,2}$/.test(w)).join(" ");
}

/**
 * Onderwerp van een contentplanningbericht. Agendatitels zijn opgebouwd als
 * "Klant short online > 16:00 > Onderwerp" of "Klant - Onderwerp"; het laatste
 * inhoudelijke deel is het onderwerp.
 */
export function calendarKey(title: string, clientName?: string | null): string {
  const parts = title
    .split(/\s*(?:>|\s-\s|\||·)\s*/)
    .map((p) => tokens(p.replace(/\b\d{1,2}[:.]\d{2}\b/g, " ").replace(/#\d+/g, " "), clientName).join(" "))
    .filter((p) => p.length > 0);
  return parts.length ? parts[parts.length - 1]! : "";
}

/** Overeenkomst tussen twee sleutels, 0..1. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = new Set(a.split(" "));
  const B = new Set(b.split(" "));
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  if (common === 0) return 0;
  // Onderwerp volledig in de videotitel (agendatitels zijn vaak ingekort), of
  // de volledige videotitel in een langer agendaonderwerp.
  const inVideo = common / A.size;
  const inTopic = common / B.size;
  const jaccard = common / new Set([...A, ...B]).size;
  const contained = (inVideo >= 1 && A.size >= 2) || (inTopic >= 1 && B.size >= 2);
  return Math.max(jaccard, contained ? 0.85 : Math.max(inVideo, inTopic) * 0.75);
}

const STRONG = 0.8;

/** Nieuwste versie binnen een groep van dezelfde video (zelfde sleutel). */
export function newestVersion<T extends MatchableVideo>(group: T[]): T {
  return [...group].sort((a, b) => {
    const dv = versionOf(b.name, b.subfolder) - versionOf(a.name, a.subfolder);
    if (dv !== 0) return dv;
    if (b.versionCount !== a.versionCount) return b.versionCount - a.versionCount;
    return (b.frameCreatedAt?.getTime() ?? 0) - (a.frameCreatedAt?.getTime() ?? 0);
  })[0]!;
}

/**
 * Groepeert video's per (sessie, sleutel) en houdt alleen de nieuwste versie over.
 * Zo verschijnt in de planning nooit een verouderde versie.
 */
export function latestVersions<T extends MatchableVideo>(videos: T[], clientName?: string | null): Array<T & { key: string }> {
  const groups = new Map<string, T[]>();
  for (const v of videos) {
    const key = videoKey(v.name, clientName);
    const g = `${v.sessionKey}|${key || v.id}`;
    const list = groups.get(g);
    if (list) list.push(v);
    else groups.set(g, [v]);
  }
  return [...groups.values()].map((g) => ({ ...newestVersion(g), key: videoKey(g[0]!.name, clientName) }));
}

/**
 * Automatische koppeling voor één bericht. Geeft alleen een video terug bij een
 * sterke én eenduidige match. Video's van de bijbehorende opnamedag (als die
 * bekend is) gaan voor; video's die pas ná de publicatiedatum in Frame kwamen
 * tellen niet mee.
 */
export function autoMatch<T extends MatchableVideo>(
  item: { title: string; scheduledOn: string; productionDayId?: string | null },
  videos: Array<T & { key: string }>,
  clientName?: string | null,
): (T & { key: string }) | null {
  const topic = calendarKey(item.title, clientName);
  if (!topic) return null;
  const topicWords = topic.split(" ");
  // Eén los kort woord ("AMG") telt alleen als de videotitel precies dat woord is.
  const singleShort = topicWords.length < 2 && (topicWords[0]?.length ?? 0) < 6;
  if (singleShort && (topicWords[0]?.length ?? 0) < 3) return null;

  const publishBy = Date.parse(`${item.scheduledOn.slice(0, 10)}T23:59:59Z`);
  let pool = videos.filter((v) => !v.frameCreatedAt || v.frameCreatedAt.getTime() <= publishBy);
  if (item.productionDayId) {
    const sameDay = pool.filter((v) => v.sessionProductionDayId === item.productionDayId);
    if (sameDay.length) pool = sameDay;
  }

  const scored = pool
    .map((v) => ({ v, s: singleShort ? (v.key === topic ? 1 : 0) : similarity(topic, v.key) }))
    .filter((x) => x.s >= STRONG)
    .sort((a, b) => b.s - a.s || (b.v.sessionCreatedAt?.getTime() ?? 0) - (a.v.sessionCreatedAt?.getTime() ?? 0));
  if (!scored.length) return null;
  const best = scored[0]!;
  // Eenduidig: geen tweede, even goede kandidaat met een andere inhoud.
  const rival = scored.find((x) => x.v.key !== best.v.key && x.s >= best.s - 0.05);
  if (rival) return null;
  return best.v;
}
