import "server-only";
import type { Viewer } from "@/server/auth/context";
import { isCoreStaff } from "@/server/core-staff";

/**
 * Feedbackrondes zijn uitsluitend zichtbaar en bewerkbaar voor het vaste
 * kernteam (Jarno, Milou, Jiska, Rutger). Andere medewerkers, freelance editors
 * en klanten zien de kolom niet en krijgen de waarde ook niet mee van de server.
 */
export function canManageFeedbackRounds(viewer: Viewer | null | undefined): boolean {
  if (!viewer || viewer.isPortalUser || viewer.isEditorOnly) return false;
  return isCoreStaff(viewer.email);
}
