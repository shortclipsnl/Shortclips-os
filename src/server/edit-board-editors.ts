import "server-only";

/**
 * De vaste set editors met een eigen edit-board: Sem, Noah, Fabian, Quinn en
 * Senna. Alleen aan hen wijzen we edit-projecten toe, en alleen zij krijgen een
 * editor-portal. Bewust een vaste lijst (op voornaam), zodat oud-editors of
 * mensen die ooit één keer monteerden hier niet tussen staan.
 */
export const EDIT_BOARD_EDITOR_FIRST_NAMES = ["sem", "sam", "noah", "fabian", "quinn", "senna"] as const;

export function isBoardEditor(fullName: string | null | undefined): boolean {
  if (!fullName) return false;
  const first = fullName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return (EDIT_BOARD_EDITOR_FIRST_NAMES as readonly string[]).includes(first);
}
