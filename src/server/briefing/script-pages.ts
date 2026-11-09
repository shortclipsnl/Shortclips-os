import "server-only";
import { shootReviewPdf } from "@/server/captions/generate";
import { extractPages } from "./pdfjs-server";
import { parseScriptPdf } from "./script-pdf";
import type { BriefingDoc } from "./assemble";

/**
 * De scriptpagina's van een opname als PDF, op het moment van openen uit de
 * actuele script-PDF gehaald (Drive of scriptcontrole). Niets in de database:
 * zo groeit de database niet mee en is het altijd de nieuwste versie.
 */
export async function scriptPagesPdf(doc: BriefingDoc): Promise<Uint8Array | null> {
  if (!doc.scriptPages) return null;
  const pdf = await shootReviewPdf(doc.productionDayId);
  if (!pdf) return null;
  const bytes = new Uint8Array(Buffer.from(pdf.pdfBase64, "base64"));
  let pages = doc.scriptPages.pages;
  if (pdf.hash !== doc.scriptPages.sourceHash) {
    // Script is net vervangen en de briefing nog niet bijgewerkt: pagina's opnieuw bepalen.
    const parsed = await parseScriptPdf(bytes);
    const found = [...new Set(parsed.scripts.flatMap((s) => s.pages))].sort((a, b) => a - b);
    pages = found.length ? found : Array.from({ length: parsed.pageCount }, (_, i) => i + 1).filter((p) => !parsed.imagePages.includes(p));
  }
  return pages.length ? extractPages(bytes, pages) : null;
}
