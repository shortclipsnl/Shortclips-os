import "server-only";
import type { Viewer } from "@/server/auth/context";
import { isOwner } from "@/server/auth/context";
import { isCoreStaff } from "@/server/core-staff";

/**
 * Editor database: uitsluitend de eigenaar en het vaste kantoorteam (Milou,
 * Jiska, Rutger). Freelance editors, videografen en klanten zien de knop niet,
 * kunnen de pagina niet openen en kunnen de acties niet aanroepen: daar staan
 * contactgegevens, tarieven en interne beoordelingen van andere editors.
 */
export function canUseEditorDatabase(viewer: Viewer | null | undefined): boolean {
  if (!viewer || viewer.isPortalUser || viewer.isEditorOnly) return false;
  return isOwner(viewer) || isCoreStaff(viewer.email);
}
