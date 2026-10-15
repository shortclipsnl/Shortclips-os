/**
 * Eén definitie per cijfer (#5). Pure functies zonder database, zodat elke
 * pagina exact hetzelfde rekent en hetzelfde oordeelt. Unit-getest.
 */

export type LoadLevel = "normaal" | "hoog" | "overbelast" | "geen_data";

export const LOAD_LABEL: Record<LoadLevel, string> = {
  normaal: "Normaal",
  hoog: "Hoog",
  overbelast: "Overbelast",
  geen_data: "Geen data",
};

/** Eén drempel voor belasting, op basis van bezetting t.o.v. de gezonde grens. */
export function levelFromPct(pct: number | null): LoadLevel {
  if (pct === null) return "geen_data";
  if (pct > 100) return "overbelast";
  if (pct >= 80) return "hoog";
  return "normaal";
}

/**
 * Editorbelasting: lopende shorts t.o.v. de gezonde capaciteit (shorts per 4
 * weken). Eén berekening voor dashboard, Editors én Teamcapaciteit.
 */
export function editorLoad(open: number, capacityShorts4w: number | null | undefined): { pct: number | null; level: LoadLevel } {
  const cap = capacityShorts4w ?? 0;
  if (!cap || cap <= 0) return { pct: null, level: "geen_data" };
  const pct = Math.round((open / cap) * 100);
  return { pct, level: levelFromPct(pct) };
}

/** Tone-mapping voor de UI-badges, overal gelijk. */
export const LEVEL_TONE: Record<LoadLevel, "good" | "warn" | "bad" | "neutral"> = {
  normaal: "good",
  hoog: "warn",
  overbelast: "bad",
  geen_data: "neutral",
};
