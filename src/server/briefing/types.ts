import type { ParsedScriptPdf } from "./script-pdf";
import type { GuideHighlight } from "./guide-highlights";

/**
 * Wat er in `briefing_sets.content` staat (versie 2). Alleen de dure, afgeleide
 * delen worden opgeslagen: de letterlijke scripts (uit de PDF) en de highlights
 * van de Editing Guide. Klant, editor, deadline, links en omslag worden bij elke
 * weergave live uit het portaal gehaald, zodat ze nooit verouderd zijn.
 *
 * De oude velden (`projectIntro`, `shorts`) blijven gevuld voor bestaande
 * weergaven (editingbord, videopagina).
 */
export type BriefingStoreV2 = {
  v: 2;
  source: { fileName: string; origin: "drive" | "review"; hash: string; parsedAt: string };
  scripts: ParsedScriptPdf;
  guide: { hash: string | null; fileName: string | null; highlights: GuideHighlight[]; error?: string | null };
  /** Handmatige correcties door Team Shortclips. Een automatische update raakt
   *  dit nooit aan. */
  overrides?: BriefingOverrides;
  projectIntro: { client: string; aantalShorts: number; omschrijving: string; algemeneAandachtspunten: string[] };
  shorts: Array<{ titel: string; omschrijving: string; aandachtspunten: string[] }>;
};

export type BriefingOverrides = {
  /** Vervangt de automatische highlights (bijv. een klantafspraak die extra nadruk moet krijgen). */
  highlights?: GuideHighlight[] | null;
  /** Op welke guide-versie de gecorrigeerde highlights gebaseerd zijn. */
  highlightsGuideHash?: string | null;
  /** Gekozen omslagbeeld (frame_assets.id). */
  coverAssetId?: string | null;
  updatedAt?: string;
  updatedBy?: string;
};

export function isStoreV2(c: unknown): c is BriefingStoreV2 {
  return Boolean(c && typeof c === "object" && (c as { v?: unknown }).v === 2);
}
