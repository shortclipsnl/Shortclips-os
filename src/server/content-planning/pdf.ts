import "server-only";
import { htmlToPdf } from "@/server/pdf/render";
import { loadContentPlanningOverview } from "./overview";
import { contentPlanningFilename, renderContentPlanningHtml } from "./pdf-html";

/**
 * De centrale contentplanning-PDF-generator. Wordt aangeroepen door zowel de
 * klantroute (/api/portal/contentplanning/pdf) als de teamroute
 * (/api/contentplanning/[clientId]/pdf), zodat beide exact hetzelfde document
 * opleveren. Toegangscontrole gebeurt in de route, vóór deze aanroep.
 */
export async function generateContentPlanningPdf(clientId: string): Promise<{ pdf: Uint8Array; filename: string } | null> {
  const overview = await loadContentPlanningOverview(clientId);
  if (!overview) return null;
  const pdf = await htmlToPdf(renderContentPlanningHtml(overview));
  return { pdf, filename: contentPlanningFilename(overview) };
}

export function pdfResponseHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
}
