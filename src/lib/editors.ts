/**
 * De vaste set editors met een eigen edit-board, in weergavevolgorde:
 * Quinn, Noah, Sam, Senna en Fabian. Bewust één "Sam" (geen losse "Sem").
 * Eén bron van waarheid voor zowel de server (board-filtering) als de UI
 * (editor-knoppen en -keuzes).
 */
export const BOARD_EDITORS = ["Quinn", "Noah", "Sam", "Senna", "Fabian"] as const;

export const BOARD_EDITOR_FIRST_NAMES: readonly string[] = BOARD_EDITORS.map((n) => n.toLowerCase());

/** Oude/afwijkende schrijfwijzen die naar één editor horen. "Sem" is dezelfde
 *  persoon als "Sam" — zo telt, kleurt en filtert alles als één Sam. */
const FIRST_NAME_ALIAS: Record<string, string> = { sem: "sam" };

/** Vaste kleur per editor (zoals in Monday), op voornaam. */
export const EDITOR_COLOR: Record<string, string> = {
  quinn: "#7c5cff",
  noah: "#5b9bf0",
  sam: "#22b573",
  senna: "#f2843b",
  fabian: "#0f766e",
};

/** Canonieke sleutel: eerste woord van de naam, kleine letters, aliassen
 *  samengevoegd (sem → sam). */
export function firstNameKey(fullName: string | null | undefined): string {
  const raw = fullName?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return FIRST_NAME_ALIAS[raw] ?? raw;
}

/** De nette weergavenaam van een editor: als de naam bij het vaste board hoort
 *  (ook via alias), de canonieke naam (bijv. "Sam"); anders de naam zelf. */
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
