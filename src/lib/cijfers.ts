/**
 * Getallen in een zin (aantallen, percentages, bedragen, tijden) zoals
 * "19.522", "+54,8%", "€550.000", "2,8x" of "13 sec".
 * Duizendtallen met een punt, decimalen met een komma (Nederlandse notatie).
 */
const NUM_RE = /(?<![\p{L}\p{N}.,])(?:[+\-−]|€\s?)?\d+(?:\.\d{3})*(?:,\d+)?(?:\s?%|\s?[x×](?![\p{L}\p{N}])|\s?(?:sec|seconden|min|minuten|uur)(?![\p{L}\p{N}]))?/gu;

/** Splitst een zin in gewone tekst en getallen, zodat elke weergave (PDF of portaal) de getallen kan benadrukken. */
export function splitNumbers(text: unknown): Array<{ text: string; num: boolean }> {
  const s = String(text ?? "");
  const out: Array<{ text: string; num: boolean }> = [];
  let last = 0;
  for (const m of s.matchAll(NUM_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: s.slice(last, i), num: false });
    out.push({ text: m[0], num: true });
    last = i + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), num: false });
  return out;
}

/**
 * Gemiddelde weergaven per video in een maand.
 *
 * Nieuwe rapportages leveren `videoViews`: de weergaven van de video's zelf
 * (zonder fotoposts en carrousels). Dan is dit het echte gemiddelde per video.
 * Zijn er voor die maand geen cijfers per video, dan is er geen gemiddelde (null).
 * Oudere rapportages zonder `videoViews` houden hun oorspronkelijke berekening
 * (alle weergaven van het account gedeeld door het aantal video's).
 */
export function weergavenPerVideo(m: { views: number; videos: number; videoViews?: number | null; meetdagen?: number } | null | undefined): number | null {
  if (!m || !m.videos) return null;
  if (typeof m.videoViews === "number") return m.videoViews > 0 ? m.videoViews / m.videos : null;
  if (m.meetdagen === 0) return null;
  return m.views / m.videos;
}
