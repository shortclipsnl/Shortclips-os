import "server-only";
import type { Viewer } from "@/server/auth/context";
import { isOwner } from "@/server/auth/context";
import { isCoreStaff } from "@/server/core-staff";

/**
 * Freelance videografen: uitsluitend de eigenaar en het vaste kantoorteam (Milou,
 * Jiska, Rutger). Freelance videografen, editors en klanten zien het menu-item
 * niet, kunnen de pagina niet openen en kunnen de acties niet aanroepen: daar
 * staan telefoonnummers, tarieven en interne opmerkingen van andere freelancers.
 * Dezelfde groep mag profielen ook toevoegen, aanpassen en op niet actief zetten.
 */
export function canUseFreelanceVideographers(viewer: Viewer | null | undefined): boolean {
  if (!viewer || viewer.isPortalUser || viewer.isEditorOnly) return false;
  if (viewer.primaryRole === "videographer" && !isCoreStaff(viewer.email) && !isOwner(viewer)) return false;
  return isOwner(viewer) || isCoreStaff(viewer.email);
}
