/**
 * Kwaliteitskeuring van kandidaat-ideeën (puur, zonder database of AI).
 *
 * Werkwijze: de AI bedenkt ruim (±10 kandidaten), daarna beoordeelt een APARTE,
 * strenge keuring elke kandidaat op vijf onderdelen. De code rekent het totaal
 * uit en past de drempel toe: alleen wat sterk onderbouwd is én klinkt als deze
 * klant, komt bij het team. Liever drie goede ideeën dan vijf met opvulling.
 *
 * Eerlijk: de score zegt "sterk onderbouwd en past bij de klant", niet
 * "garantie op weergaven".
 */

export const QUALITY_PARTS = [
  { key: "stijlFit", label: "Stijl-fit", gewicht: 30, uitleg: "Klinkt als de echte scripts van deze klant (hooks, middenstuk, CTA)." },
  { key: "bewezenPatroon", label: "Bewezen patroon", gewicht: 25, uitleg: "Lijkt op wat aantoonbaar goed werkte in de eigen video's of hookanalyse." },
  { key: "relevantie", label: "Relevantie", gewicht: 15, uitleg: "Past bij doelgroep, doel en het moment." },
  { key: "originaliteit", label: "Originaliteit", gewicht: 15, uitleg: "Niet al eerder gemaakt of voorgesteld." },
  { key: "uitvoerbaarheid", label: "Uitvoerbaarheid", gewicht: 15, uitleg: "Op een opnamedag met deze klant goed te filmen." },
] as const;

export type QualityKey = (typeof QUALITY_PARTS)[number]["key"];
export type QualityBasis = "data" | "scripts" | "inschatting";

export type QualityPart = { score: number; basis: QualityBasis; toelichting: string };

export type Keuring = {
  totaal: number;
  geslaagd: boolean;
  onderdelen: Record<QualityKey, QualityPart>;
  oordeel: string;
  stijlProblemen: string[];
  /** Lichte verbeterpunten voor het team (tellen niet mee in de score). */
  aanscherpen?: string[];
  /** Waarom niet door de keuring (leeg als geslaagd). */
  afwijsReden: string | null;
};

/** Drempels: totaal én stijl-fit moeten allebei gehaald worden. */
export const MIN_TOTAAL = 80;
export const MIN_STIJL_FIT = 8;

function clamp10(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

function basis(v: unknown): QualityBasis {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "data") return "data";
  if (s === "scripts" || s === "script") return "scripts";
  return "inschatting";
}

function s(v: unknown, max = 400): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Zet de ruwe beoordeling om naar een Keuring, met harde regels in code:
 * - "bewezen patroon" mag alleen "data" heten als er echt video-data was;
 *   zonder eigen data of bewezen hooks is dat onderdeel maximaal 6;
 * - zware stijlproblemen (zinnen die duidelijk niet bij de klant passen of
 *   onjuist zijn) drukken stijl-fit tot maximaal 6, ook als de beoordelaar
 *   hoger gaf. Lichte "aanscherpen"-punten tellen niet mee; die ziet het team.
 */
export function normalizeKeuring(
  raw: Record<string, unknown>,
  ctx: { hasVideoData: boolean; hasProvenHooks: boolean },
): Keuring {
  const parts = {} as Record<QualityKey, QualityPart>;
  for (const p of QUALITY_PARTS) {
    const score = clamp10(raw[p.key]);
    const b = basis(raw[`${p.key}Basis`]);
    parts[p.key] = { score, basis: p.key === "stijlFit" ? "scripts" : b, toelichting: s(raw[`${p.key}Toelichting`]) };
  }

  const stijlProblemen = (Array.isArray(raw.stijlProblemen) ? raw.stijlProblemen : [])
    .map((x) => s(x, 200))
    .filter(Boolean)
    .slice(0, 5);

  const aanscherpen = (Array.isArray(raw.aanscherpen) ? raw.aanscherpen : [])
    .map((x) => s(x, 200))
    .filter(Boolean)
    .slice(0, 3);

  const bp = parts.bewezenPatroon;
  if (bp.basis === "data" && !ctx.hasVideoData) bp.basis = "inschatting";
  if (!ctx.hasVideoData && !ctx.hasProvenHooks) bp.score = Math.min(bp.score, 6);
  if (bp.basis === "inschatting") bp.score = Math.min(bp.score, 7);
  if (stijlProblemen.length > 0) parts.stijlFit.score = Math.min(parts.stijlFit.score, 6);

  const totaal = Math.round(QUALITY_PARTS.reduce((sum, p) => sum + (parts[p.key].score * p.gewicht) / 10, 0));
  const redenen: string[] = [];
  if (parts.stijlFit.score < MIN_STIJL_FIT) redenen.push(`stijl-fit ${parts.stijlFit.score}/10 (minimaal ${MIN_STIJL_FIT})`);
  if (totaal < MIN_TOTAAL) redenen.push(`kwaliteitsscore ${totaal} (minimaal ${MIN_TOTAAL})`);
  return {
    totaal,
    geslaagd: redenen.length === 0,
    onderdelen: parts,
    oordeel: s(raw.oordeel, 500),
    stijlProblemen,
    aanscherpen,
    afwijsReden: redenen.length ? redenen.join(" en ") : null,
  };
}

/** Kandidaat met keuring: de beste eerst, geslaagd voor gezakt. */
export function rankByQuality<T extends { keuring: Keuring }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    Number(b.keuring.geslaagd) - Number(a.keuring.geslaagd)
    || b.keuring.totaal - a.keuring.totaal
    || b.keuring.onderdelen.stijlFit.score - a.keuring.onderdelen.stijlFit.score,
  );
}

/** Leest een opgeslagen keuring terug (of null bij oude ideeën zonder keuring). */
export function readKeuring(v: unknown): Keuring | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<Keuring>;
  if (typeof o.totaal !== "number" || !o.onderdelen) return null;
  return o as Keuring;
}

function words(t: string): Set<string> {
  return new Set(
    t.toLowerCase().replace(/[^a-z0-9€ ]+/g, " ").split(/\s+/).filter((w) => w.length > 2),
  );
}

/** Twee ideeën zijn (bijna) hetzelfde als titel + eerste hook grotendeels overlappen. */
export function nearDuplicate(a: { titel: string; hooks: string[] }, b: { titel: string; hooks: string[] }): boolean {
  const wa = words(`${a.titel} ${a.hooks[0] ?? ""}`);
  const wb = words(`${b.titel} ${b.hooks[0] ?? ""}`);
  if (wa.size === 0 || wb.size === 0) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.min(wa.size, wb.size) >= 0.7;
}

/** De ideeën die het team ziet: geslaagd, beste eerst, zonder bijna-dubbele. */
export function pickShown<T extends { titel: string; hooks: string[]; keuring: Keuring }>(ranked: T[], max: number): T[] {
  const out: T[] = [];
  for (const c of ranked) {
    if (!c.keuring.geslaagd) continue;
    if (out.some((o) => nearDuplicate(o, c))) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}
