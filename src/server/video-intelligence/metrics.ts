import "server-only";

/**
 * Pure berekeningen op het transcript — los van Whisper, zodat ze te testen
 * zijn. Alle tijden in milliseconden.
 */

export type Word = { w: string; start: number; end: number };

export type SpeechStats = {
  wpm: number | null;
  firstWordMs: number | null;
  words3s: number | null;
  words5s: number | null;
  words10s: number | null;
};

/** Gemiddelde van een reeks getallen (null bij leeg). */
export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/** Mediaan van een reeks getallen (null bij leeg). */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Woorden-per-minuut en hoeveel woorden in de eerste 3/5/10 seconden vallen. */
export function speechStats(words: Word[], durationMs: number): SpeechStats {
  if (words.length === 0) {
    return { wpm: null, firstWordMs: null, words3s: 0, words5s: 0, words10s: 0 };
  }
  const minutes = durationMs > 0 ? durationMs / 60000 : 0;
  const wpm = minutes > 0 ? Math.round(words.length / minutes) : null;
  const before = (ms: number) => words.filter((x) => x.start <= ms).length;
  return {
    wpm,
    firstWordMs: words[0]!.start,
    words3s: before(3000),
    words5s: before(5000),
    words10s: before(10000),
  };
}
