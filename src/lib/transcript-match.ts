/**
 * Koppelt een geanalyseerde video (transcript) aan de publicatie waar hij bij
 * hoort, op basis van wat er in de video gezegd wordt.
 *
 * De bestaande koppeling (bestandsnaam + duur) mist vaak: bestandsnamen zeggen
 * weinig en de duur ontbreekt bij veel publicaties. Het transcript is een veel
 * sterker kenmerk: de caption van een Shortclips-video vat de video samen en
 * begint meestal met de gesproken hook.
 *
 * Puur rekenwerk. Alleen zekere koppelingen komen terug: genoeg onderscheidende
 * woorden gemeen, en duidelijk beter dan het tweede alternatief. Bij twijfel
 * geen koppeling.
 */

import { words } from "./screen-reel-match";

const DAY = 86_400_000;

export type MatchVideo = {
  key: string;
  caption: string;
  publishedAt: Date;
  durationSeconds: number | null;
};

export type MatchAnalysis = {
  id: string;
  transcript: string;
  durationSeconds: number | null;
  /** Moment waarop het videobestand in de bibliotheek kwam. */
  createdAt: Date | null;
};

export type TranscriptMatch = { analysisId: string; videoKey: string; score: number; margin: number; shared: string[] };

/** Voettekst en hashtags zeggen niets over de video. */
function captionBody(caption: string): string {
  return caption
    .split(/\n+/)
    .filter((l) => !/^\s*(#|📍|📞|📩|📲|📧|☎|✉|📱|🌐|www\.|https?:)/u.test(l))
    .join(" ")
    .replace(/#[\p{L}\p{N}_]+/gu, " ");
}

const stem = (w: string) => (w.length >= 6 ? w.slice(0, Math.max(5, w.length - 2)) : w);

/**
 * @param videos    unieke video's van één klant (dezelfde video op meerdere platforms = één)
 * @param analyses  geanalyseerde videobestanden van dezelfde klant met transcript
 */
export function matchTranscripts(videos: MatchVideo[], analyses: MatchAnalysis[], opts: { minScore?: number; minMargin?: number; minShared?: number } = {}): TranscriptMatch[] {
  const minScore = opts.minScore ?? 0.3;
  const minMargin = opts.minMargin ?? 0.08;
  const minShared = opts.minShared ?? 4;

  // Hoe zeldzamer een woord in de captions van deze klant, hoe zwaarder het telt.
  const capWords = videos.map((v) => [...new Set(words(captionBody(v.caption)).map(stem))]);
  const df = new Map<string, number>();
  for (const ws of capWords) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(1, videos.length);
  const idf = (w: string) => Math.log(1 + n / (df.get(w) ?? 1));

  const proposals: TranscriptMatch[] = [];
  for (const a of analyses) {
    const tw = new Set(words(a.transcript).map(stem));
    const scored: Array<{ i: number; score: number; shared: string[]; durMatch: boolean }> = [];
    videos.forEach((v, i) => {
      const pub = v.publishedAt.getTime();
      const created = a.createdAt?.getTime();
      // Het bestand bestaat vóór de publicatie (kleine marge voor latere versies).
      if (created != null && (created > pub + 3 * DAY || created < pub - 200 * DAY)) return;
      const bothDur = !!v.durationSeconds && !!a.durationSeconds;
      if (bothDur && Math.abs(v.durationSeconds! - a.durationSeconds!) > 3) return;
      const ws = capWords[i];
      const shared = ws.filter((w) => tw.has(w));
      const total = ws.reduce((s, w) => s + idf(w), 0);
      const hit = shared.reduce((s, w) => s + idf(w), 0);
      scored.push({ i, score: total > 0 ? hit / total : 0, shared, durMatch: bothDur && Math.abs(v.durationSeconds! - a.durationSeconds!) <= 1 });
    });
    if (!scored.length) continue;
    scored.sort((x, y) => y.score - x.score);
    const [best, second] = scored;
    const margin = best.score - (second?.score ?? 0);
    const propose = (c: (typeof scored)[number], m: number) =>
      proposals.push({ analysisId: a.id, videoKey: videos[c.i].key, score: Math.round(c.score * 100) / 100, margin: Math.round(m * 100) / 100, shared: c.shared });

    // 1. Zelfde duur (op de seconde) is het sterkste kenmerk.
    const sameDur = scored.filter((c) => c.durMatch);
    if (sameDur.length === 1) {
      // Enige video met deze duur, tenzij de tekst duidelijk naar een andere video wijst.
      if (best === sameDur[0] || best.score < minScore) propose(sameDur[0], best === sameDur[0] ? margin : 0);
      continue;
    }
    if (sameDur.length > 1) {
      const [d1, d2] = sameDur;
      if (d1.shared.length >= 1 && d1.score - d2.score >= 0.05) propose(d1, d1.score - d2.score);
      continue;
    }
    // 2. Geen duur bekend: alleen op wat er gezegd wordt.
    if (tw.size < 8) continue;
    const strong = best.score >= minScore && best.shared.length >= minShared && margin >= minMargin;
    // Lange captions delen veel woorden met het transcript, ook als de totaalscore lager uitvalt.
    const long = best.shared.length >= 10 && best.score >= 0.25 && margin >= 0.1;
    if (strong || long) propose(best, margin);
  }

  // Eén video hoort bij één bestand: de sterkste koppeling wint.
  proposals.sort((x, y) => y.score - x.score);
  const usedVideo = new Set<string>();
  const out: TranscriptMatch[] = [];
  for (const p of proposals) {
    if (usedVideo.has(p.videoKey)) continue;
    usedVideo.add(p.videoKey);
    out.push(p);
  }
  return out;
}
