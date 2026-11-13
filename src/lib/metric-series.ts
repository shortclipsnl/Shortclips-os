/**
 * Metricool levert voor sommige TikTok-accounts geen dagcijfers maar de
 * oplopende totaalstand (bijv. alle likes ooit: 84.124, 84.130, 84.141 …).
 * Wie die per dag optelt, krijgt over 30 dagen miljoenen "likes" die nooit
 * bestaan hebben. Deze functie herkent zo'n oplopende reeks en zet hem om naar
 * het werkelijke aantal per dag (verschil met de dag ervoor).
 *
 * Bewust streng: alleen een reeks die (vrijwel) nooit daalt, elke dag boven nul
 * staat en veel groter is dan de dagelijkse verandering, geldt als totaalstand.
 * Een gewone dagreeks schommelt en valt daar niet onder.
 */
export type SeriesPoint = { date: string; value: number };

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function isCumulativeSeries(points: SeriesPoint[]): boolean {
  if (points.length < 7) return false;
  const v = [...points].sort((a, b) => a.date.localeCompare(b.date)).map((p) => p.value);
  if (v.some((x) => !(x > 0))) return false;
  const diffs: number[] = [];
  for (let i = 1; i < v.length; i++) {
    const d = v[i]! - v[i - 1]!;
    // Kleine dalingen (iemand haalt een like weg) mogen; een echte daling niet.
    if (d < 0 && Math.abs(d) > v[i - 1]! * 0.005) return false;
    diffs.push(Math.abs(d));
  }
  return Math.min(...v) >= 20 * Math.max(1, median(diffs));
}

/** Oplopende totaalstand → aantal per dag. Gewone dagreeksen blijven ongewijzigd. */
export function toDailySeries(points: SeriesPoint[]): SeriesPoint[] {
  if (!isCumulativeSeries(points)) return points;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((p, i) => ({ date: p.date, value: i === 0 ? 0 : Math.max(0, p.value - sorted[i - 1]!.value) }));
}
