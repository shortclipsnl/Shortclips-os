import "server-only";
import { BOARD_EDITOR_FIRST_NAMES, isBoardEditorName } from "@/lib/editors";

/**
 * De vaste set editors met een eigen edit-board: Quinn, Noah, Sam, Senna en
 * Fabian. Alleen aan hen wijzen we edit-projecten toe, en alleen zij krijgen
 * een editor-portal. Bewust een vaste lijst (op voornaam), zodat oud-editors
 * of mensen die ooit één keer monteerden hier niet tussen staan. Eén "Sam"
 * (geen losse "Sem"). De lijst zelf staat in @/lib/editors.
 */
export const EDIT_BOARD_EDITOR_FIRST_NAMES = BOARD_EDITOR_FIRST_NAMES;

export function isBoardEditor(fullName: string | null | undefined): boolean {
  return isBoardEditorName(fullName);
}
