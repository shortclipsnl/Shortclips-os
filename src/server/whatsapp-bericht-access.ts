import "server-only";
import type { Viewer } from "@/server/auth/context";
import { isOwner } from "@/server/auth/context";
import { isCoreStaff } from "@/server/core-staff";

/**
 * WhatsApp-bericht eerste versies: voor wie het volledige editingoverzicht ziet,
 * dus de eigenaar en het vaste kantoorteam (Milou, Jiska, Rutger). Editors en
 * klanten zien de knoppen niet en kunnen de acties ook niet aanroepen.
 */
export function canUseWhatsappBericht(viewer: Viewer | null | undefined): boolean {
  if (!viewer || viewer.isPortalUser || viewer.isEditorOnly) return false;
  return isOwner(viewer) || isCoreStaff(viewer.email);
}
