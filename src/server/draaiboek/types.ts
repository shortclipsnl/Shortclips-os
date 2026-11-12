/* Inhoud van een videograaf draaiboek (draaiboeken.content). */

export type DraaiboekPartKey = "hook" | "middenstuk" | "cta" | "broll";
/** Volgorde in het mobiele draaiboek: hook, middenstuk, call to action en als laatste de B-roll. */
export const PART_ORDER: DraaiboekPartKey[] = ["hook", "middenstuk", "cta", "broll"];
export const PART_LABEL: Record<DraaiboekPartKey, string> = {
  hook: "Hook",
  middenstuk: "Middenstuk",
  cta: "Call to action",
  broll: "B-roll",
};

export type DraaiboekPart = {
  /** Scripttekst, letterlijk uit de PDF (regels gescheiden door \n). In de controlestap aan te passen. */
  tekst: string;
  /** Beknopte shotaanwijzingen: richting, geen voorschrift. */
  aanwijzingen: string[];
};

export type DraaiboekVideo = {
  key: string;
  nr: number;
  titel: string;
  hook: DraaiboekPart;
  middenstuk: DraaiboekPart;
  cta: DraaiboekPart;
  /** Aanvullende beelden voor de montage. */
  broll: string[];
};

export type DraaiboekContent = {
  v: 1;
  videos: DraaiboekVideo[];
  warnings: string[];
};

export type DraaiboekProgress = Record<string, Partial<Record<DraaiboekPartKey, true>>>;

export type DraaiboekStatus = "concept" | "verstuurd" | "afgerond" | "afgerond_open";

export function isDraaiboekContent(c: unknown): c is DraaiboekContent {
  return Boolean(c && typeof c === "object" && (c as { v?: unknown }).v === 1 && Array.isArray((c as { videos?: unknown }).videos));
}

/** Welke onderdelen tellen mee voor de voortgang van deze video (B-roll alleen als die er is). */
export function partsFor(v: DraaiboekVideo): DraaiboekPartKey[] {
  return PART_ORDER.filter((k) => (k === "broll" ? v.broll.length > 0 : v[k].tekst.trim() !== "" || v[k].aanwijzingen.length > 0));
}

/** Eén voortgangscijfer voor de hele sessie: afgeronde onderdelen / alle onderdelen. */
export function sessionProgress(content: DraaiboekContent, progress: DraaiboekProgress): { done: number; total: number; pct: number; videosDone: number } {
  let done = 0;
  let total = 0;
  let videosDone = 0;
  for (const v of content.videos) {
    const parts = partsFor(v);
    const p = progress[v.key] ?? {};
    const d = parts.filter((k) => p[k]).length;
    done += d;
    total += parts.length;
    if (parts.length > 0 && d === parts.length) videosDone++;
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, videosDone };
}
