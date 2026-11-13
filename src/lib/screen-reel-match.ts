/**
 * Kantoorscherm: koppelt gepubliceerde posts (Metricool, mét statistieken) aan
 * het echte videobestand in Frame.io (frame_assets), zodat we de juiste video
 * bij de juiste cijfers kunnen afspelen.
 *
 * In de database is publications.deliverable_id (nog) leeg, dus we matchen op
 * wat beide bronnen wél delen: klant, videoduur, publicatie- vs. uploaddatum en
 * de onderwerpwoorden in de bestandsnaam ("2 - MERCEDES SL43 AMG") die ook in de
 * caption terugkomen. We zijn bewust streng: bij twijfel tonen we de video niet,
 * want een verkeerde video bij de cijfers is erger dan een video minder.
 *
 * Pure functies (geen database), zodat de logica los te testen is.
 */

export type ReelPublication = {
  id: string;
  clientId: string;
  platform: string;
  publishedAt: Date;
  durationSeconds: number | null;
  caption: string | null;
  externalUrl: string | null;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  /** Gemiddelde kijktijd in seconden, als het platform die levert. */
  avgWatchSeconds?: number | null;
};

export type ReelAsset = {
  id: string;
  clientId: string;
  name: string;
  subfolderName: string | null;
  durationSeconds: number | null;
  frameCreatedAt: Date | null;
};

/** De cijfers van één video op één platform (één publicatie). */
export type ReelPlatformStats = {
  platform: string;
  url: string | null;
  views: number;
  /** Id van de publicatie op dit platform. */
  publicationId?: string;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  avgWatchSeconds?: number | null;
};

/** Eén video zoals die op meerdere platforms gepubliceerd is. */
export type ReelVideo = {
  key: string;
  clientId: string;
  publishedAt: Date;
  durationSeconds: number | null;
  caption: string;
  platforms: ReelPlatformStats[];
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
};

export type ReelMatch = { video: ReelVideo; asset: ReelAsset; score: number; matchedWords: string[] };

const DAY = 86_400_000;

const STOP = new Set([
  "shortclips", "mp4", "mov", "sessie", "versie", "final", "finale", "def", "definitief", "export", "edit",
  "video", "short", "shorts", "reel", "reels", "tiktok", "instagram", "the", "and", "met", "van", "voor",
  "een", "het", "der", "den", "des", "dat", "die", "dit", "deze", "ook", "nog", "wel", "niet", "naar",
  "bij", "aan", "uit", "over", "door", "als", "wat", "wie", "hoe", "waar", "zijn", "jij", "jou", "jouw",
  "wij", "ons", "onze", "zij", "hun", "hebben", "heeft", "kan", "kun", "wordt", "worden", "gaat", "gaan",
  "maar", "dan", "toch", "even", "alle", "elke", "meer", "veel", "zo", "nieuw", "nieuwe", "copy", "kopie",
  "hook", "deel", "part", "versie", "verkorte", "verkort", "versies", "klant", "opname", "draaidag",
]);

/** Kleine letters, accenten weg, alleen letters/cijfers als losse woorden. */
export function words(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/'s\b/g, "s")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^v\d{1,2}$/.test(w) && !/^\d{1,2}$/.test(w));
}

/** Onderwerpwoorden uit een Frame-bestandsnaam ("4 - BMW M5 TOURING - Shortclips_V3.mp4"). */
export function assetWords(name: string): string[] {
  const t = name
    .replace(/\.(mp4|mov|m4v|mkv|webm)$/i, "")
    .replace(/_/g, " ")
    .replace(/\b\d{1,3}\s*v\d{1,2}\b/gi, " ")
    .replace(/\b(9[\s:x-]?16|16[\s:x-]?9|4[-:]?5|1[-:]1)\b/gi, " ");
  return [...new Set(words(t))];
}

/** Naam zonder versie/nummering: om versies van dezelfde video samen te nemen. */
export function assetTitleKey(name: string): string {
  return assetWords(name).join(" ");
}

function wordHit(assetWord: string, captionWords: Set<string>, captionJoined: string): boolean {
  if (captionWords.has(assetWord)) return true;
  // Samenstellingen en verbuigingen: "eindheffing" in "pseudo-eindheffing", "onderhoud" in "onderhoudsbeurt".
  if (assetWord.length >= 5 && captionJoined.includes(assetWord)) return true;
  if (assetWord.length >= 6) {
    const stem = assetWord.slice(0, Math.max(5, assetWord.length - 2));
    if (captionJoined.includes(stem)) return true;
  }
  return false;
}

/** Posts van dezelfde video op verschillende platforms samenvoegen. */
export function groupPublications(pubs: ReelPublication[]): ReelVideo[] {
  const sorted = [...pubs].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
  const groups: { pubs: ReelPublication[]; words: Set<string> }[] = [];
  for (const p of sorted) {
    const w = new Set(words(p.caption));
    let target: (typeof groups)[number] | undefined;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      const g0 = g.pubs[0];
      if (g0.clientId !== p.clientId) continue;
      if (Math.abs(g0.publishedAt.getTime() - p.publishedAt.getTime()) > 2 * DAY) continue;
      if (g.pubs.some((x) => x.platform === p.platform)) continue;
      const gDur = g.pubs.find((x) => x.durationSeconds)?.durationSeconds ?? null;
      if (gDur && p.durationSeconds && Math.abs(gDur - p.durationSeconds) > 1) continue;
      // Captions verschillen per platform licht (hashtags, emoji); kijk naar overlap.
      const inter = [...w].filter((x) => g.words.has(x)).length;
      const minSize = Math.min(w.size, g.words.size);
      const similar = minSize > 0 ? inter / minSize >= 0.6 : false;
      if (similar) {
        target = g;
        break;
      }
    }
    if (target) {
      target.pubs.push(p);
      w.forEach((x) => target!.words.add(x));
    } else groups.push({ pubs: [p], words: w });
  }

  return groups.map(({ pubs: ps }) => {
    const sum = (k: keyof ReelPublication) => ps.reduce((a, p) => a + (Number(p[k]) || 0), 0);
    const durs = ps.map((p) => p.durationSeconds).filter((d): d is number => !!d && d > 0);
    const caption = [...ps].sort((a, b) => (b.caption?.length ?? 0) - (a.caption?.length ?? 0))[0]?.caption ?? "";
    return {
      key: ps.map((p) => p.id).sort()[0],
      clientId: ps[0].clientId,
      publishedAt: ps[0].publishedAt,
      durationSeconds: durs.length ? durs.sort((a, b) => a - b)[Math.floor(durs.length / 2)] : null,
      caption,
      platforms: ps
        .map((p) => ({
          platform: p.platform,
          url: p.externalUrl,
          views: p.views,
          publicationId: p.id,
          reach: p.reach,
          likes: p.likes,
          comments: p.comments,
          shares: p.shares,
          saves: p.saves,
          avgWatchSeconds: p.avgWatchSeconds ?? null,
        }))
        .sort((a, b) => b.views - a.views),
      views: sum("views"),
      reach: sum("reach"),
      likes: sum("likes"),
      comments: sum("comments"),
      shares: sum("shares"),
      saves: sum("saves"),
    };
  });
}

type Scored = { asset: ReelAsset; score: number; dur: number | null; kw: number; matchedWords: string[] };

function scoreCandidates(v: ReelVideo, assets: ReelAsset[], wordWeight: (w: string) => number): Scored[] {
  const capWords = new Set(words(v.caption));
  const capJoined = [...capWords].join(" ");
  const pub = v.publishedAt.getTime();

  // Versies van dezelfde video (V3, V4) samennemen: nieuwste telt.
  const latestByTitle = new Map<string, ReelAsset>();
  for (const a of assets) {
    if (a.clientId !== v.clientId || !a.frameCreatedAt) continue;
    const created = a.frameCreatedAt.getTime();
    if (created > pub + 2 * DAY || created < pub - 150 * DAY) continue;
    // Alleen samennemen als de naam echt iets zegt; "A.mp4" en "B.mp4" blijven los.
    const title = assetTitleKey(a.name);
    const key = title ? `${title}|${a.subfolderName ?? ""}|${a.durationSeconds ?? ""}` : `id:${a.id}`;
    const prev = latestByTitle.get(key);
    if (!prev || (prev.frameCreatedAt?.getTime() ?? 0) < created) latestByTitle.set(key, a);
  }

  const out: Scored[] = [];
  for (const a of latestByTitle.values()) {
    let dur: number | null = null;
    if (v.durationSeconds && a.durationSeconds) {
      const diff = Math.abs(v.durationSeconds - a.durationSeconds);
      if (diff > 2) continue;
      dur = diff === 0 ? 3 : diff === 1 ? 2.5 : 1;
    }
    const matched = assetWords(a.name).filter((w) => wordHit(w, capWords, capJoined));
    const kw = Math.min(4, matched.reduce((s, w) => s + wordWeight(w), 0));
    const ageDays = (pub - (a.frameCreatedAt?.getTime() ?? pub)) / DAY;
    const shortened = /verkort|\bad\b|ads?\s*-/i.test(a.subfolderName ?? "") ? 0.5 : 0;
    const score = (dur ?? 0) + kw * 1.5 - Math.max(0, ageDays) * 0.01 - shortened;
    out.push({ asset: a, score, dur, kw, matchedWords: matched });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Koppelt video's aan Frame-bestanden. Alleen zekere koppelingen komen terug:
 * - duur exact/±1s én minstens één onderwerpwoord, of
 * - duur exact/±1s en er is maar één kandidaat met die duur, of
 * - duur onbekend maar duidelijke woordovereenkomst (≥ 2 sterke woorden),
 * en de beste kandidaat moet duidelijk beter zijn dan de tweede.
 */
export function matchVideosToAssets(videos: ReelVideo[], assets: ReelAsset[]): ReelMatch[] {
  // Woorden die in veel captions van een klant staan ("auto", "makelaar") zeggen weinig.
  const capCount = new Map<string, Map<string, number>>();
  const capTotal = new Map<string, number>();
  for (const v of videos) {
    capTotal.set(v.clientId, (capTotal.get(v.clientId) ?? 0) + 1);
    const m = capCount.get(v.clientId) ?? new Map<string, number>();
    for (const w of new Set(words(v.caption))) m.set(w, (m.get(w) ?? 0) + 1);
    capCount.set(v.clientId, m);
  }

  const proposals: { video: ReelVideo; best: Scored }[] = [];
  for (const v of videos) {
    const total = capTotal.get(v.clientId) ?? 1;
    const counts = capCount.get(v.clientId);
    const weight = (w: string) => {
      const share = (counts?.get(w) ?? 0) / total;
      return total >= 5 && share > 0.3 ? 0.3 : 1;
    };
    const cands = scoreCandidates(v, assets, weight);
    if (!cands.length) continue;
    const [best, second] = cands;
    const durOk = best.dur !== null && best.dur >= 2.5;
    const sameDurCount = cands.filter((c) => c.dur !== null && c.dur >= 2.5).length;
    const sure =
      (durOk && best.kw >= 1) ||
      // Alleen op duur: dan moet die exact gelijk zijn én de enige kandidaat.
      (best.dur === 3 && sameDurCount === 1) ||
      (best.dur === null && best.kw >= 2) ||
      (best.dur !== null && best.dur >= 1 && best.kw >= 2);
    if (!sure) continue;
    if (second && best.score - second.score < 1) continue;
    proposals.push({ video: v, best });
  }

  // Eén Frame-bestand hoort bij één video: sterkste koppeling wint.
  proposals.sort((a, b) => b.best.score - a.best.score);
  const used = new Set<string>();
  const out: ReelMatch[] = [];
  for (const p of proposals) {
    if (used.has(p.best.asset.id)) continue;
    used.add(p.best.asset.id);
    out.push({ video: p.video, asset: p.best.asset, score: p.best.score, matchedWords: p.best.matchedWords });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Selectie en volgorde voor het scherm
 * ------------------------------------------------------------------ */

export type ReelPick = ReelMatch & {
  reason: "nieuw" | "top" | "uitschieter";
  /** Weergaven t.o.v. de mediaan van deze klant (1 = normaal niveau). */
  relative: number;
};

/**
 * Kiest welke video's het scherm toont en in welke volgorde:
 * - per klant de beste en de nieuwste video's (max. `perClient`), zodat niet
 *   alleen de grootste klant voorbijkomt;
 * - alleen video's met weergaven (de cijfers moeten iets laten zien);
 * - een video die voor díe klant opvallend goed loopt telt zwaar ("uitschieter");
 * - nooit twee keer achter elkaar dezelfde klant.
 */
export function pickReel(matches: ReelMatch[], opts: { now?: Date; perClient?: number; max?: number } = {}): ReelPick[] {
  const now = (opts.now ?? new Date()).getTime();
  const perClient = opts.perClient ?? 3;
  const max = opts.max ?? 30;

  const byClient = new Map<string, ReelMatch[]>();
  for (const m of matches) {
    if (m.video.views <= 0) continue;
    const list = byClient.get(m.video.clientId) ?? [];
    list.push(m);
    byClient.set(m.video.clientId, list);
  }

  const perClientPicks: ReelPick[][] = [];
  for (const list of byClient.values()) {
    const sortedViews = list.map((m) => m.video.views).sort((a, b) => a - b);
    const median = sortedViews[Math.floor(sortedViews.length / 2)] || 1;
    const scored = list.map((m) => {
      const ageDays = (now - m.video.publishedAt.getTime()) / DAY;
      const rel = m.video.views / median; // t.o.v. het normale niveau van deze klant
      const recency = ageDays <= 14 ? 1.5 : ageDays <= 30 ? 0.7 : 0;
      const value = Math.log10(m.video.views + 10) + Math.min(3, rel) + recency;
      const reason: ReelPick["reason"] = rel >= 2 && list.length >= 3 ? "uitschieter" : ageDays <= 14 ? "nieuw" : "top";
      return { pick: { ...m, reason, relative: Math.round(rel * 10) / 10 } as ReelPick, value };
    });
    scored.sort((a, b) => b.value - a.value);
    perClientPicks.push(scored.slice(0, perClient).map((s) => s.pick));
  }

  // Klanten met hun sterkste video eerst; daarna rondes over alle klanten.
  perClientPicks.sort((a, b) => b[0].video.views - a[0].video.views);
  const out: ReelPick[] = [];
  for (let round = 0; round < perClient && out.length < max; round++) {
    for (const list of perClientPicks) {
      if (list[round] && out.length < max) out.push(list[round]);
    }
  }
  return out;
}

/**
 * Volgende video kiezen: niet dezelfde klant als de vorige, en bij voorkeur een
 * video die het langst niet getoond is. `history` = recent getoonde keys.
 */
export function nextIndex<T extends { key: string; clientId: string }>(
  items: T[],
  lastShown: Map<string, number>,
  prevClientId: string | null,
): number {
  if (!items.length) return -1;
  let best = -1;
  let bestAt = Infinity;
  for (let i = 0; i < items.length; i++) {
    if (items.length > 1 && items[i].clientId === prevClientId && new Set(items.map((x) => x.clientId)).size > 1) continue;
    const at = lastShown.get(items[i].key) ?? -1;
    if (at < bestAt) {
      bestAt = at;
      best = i;
    }
  }
  return best === -1 ? 0 : best;
}
