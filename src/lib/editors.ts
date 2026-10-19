/**
 * De vaste set editors met een eigen edit-board, in weergavevolgorde:
 * Quinn, Noah, Sem, Senna en Fabian. Bewust één "Sem" (geen losse "Sam").
 * Eén bron van waarheid voor zowel de server (board-filtering) als de UI
 * (editor-knoppen en -keuzes).
 */
export const BOARD_EDITORS = ["Quinn", "Noah", "Sem", "Senna", "Fabian"] as const;

export const BOARD_EDITOR_FIRST_NAMES: readonly string[] = BOARD_EDITORS.map((n) => n.toLowerCase());

/** Oude/afwijkende schrijfwijzen die naar één editor horen. "Sam" is een
 *  verkeerde schrijfwijze van "Sem" — zo telt, kleurt en filtert alles als
 *  één Sem. */
const FIRST_NAME_ALIAS: Record<string, string> = { sam: "sem" };

/** Vaste kleur per editor (zoals in Monday), op voornaam. Sem heeft bewust een
 *  duidelijk andere kleur (framboos) dan Fabian (teal). */
export const EDITOR_COLOR: Record<string, string> = {
  quinn: "#7c5cff",
  noah: "#5b9bf0",
  sem: "#d6336c",
  senna: "#f2843b",
  fabian: "#0f766e",
};

/** Vaste prijs per short per editor (euro). Wordt gebruikt als standaard zodra
 *  er nog geen afwijkend tarief in de database staat. Op voornaam. */
export const EDITOR_RATE: Record<string, number> = {
  quinn: 25,
  noah: 35,
  senna: 40,
  fabian: 48,
  sem: 60,
};

/** Het standaardtarief voor een editornaam (0 als onbekend). */
export function defaultEditorRate(name: string | null | undefined): number {
  return EDITOR_RATE[firstNameKey(name)] ?? 0;
}

/** Canonieke sleutel: eerste woord van de naam, kleine letters, aliassen
 *  samengevoegd (sam → sem). */
export function firstNameKey(fullName: string | null | undefined): string {
  const raw = fullName?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return FIRST_NAME_ALIAS[raw] ?? raw;
}

/** De nette weergavenaam van een editor: als de naam bij het vaste board hoort
 *  (ook via alias), de canonieke naam (bijv. "Sem"); anders de naam zelf. */
export function editorDisplayName(name: string | null | undefined): string {
  const key = firstNameKey(name);
  const match = BOARD_EDITORS.find((e) => e.toLowerCase() === key);
  return match ?? (name?.trim() ?? "");
}

/** Kleur voor een (editor)naam, met een nette fallback. */
export function editorColor(name: string | null | undefined): string {
  const key = firstNameKey(name);
  return EDITOR_COLOR[key] ?? "var(--color-indigo-mist)";
}

/** Hoort deze naam bij het vaste editor-board? */
export function isBoardEditorName(fullName: string | null | undefined): boolean {
  const first = firstNameKey(fullName);
  return !!first && BOARD_EDITOR_FIRST_NAMES.includes(first);
}
