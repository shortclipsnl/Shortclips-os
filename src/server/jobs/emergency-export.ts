import "server-only";
import { drive } from "@/server/integrations/drive";
import { getEmergencySnapshot, renderEmergencyHtml } from "@/server/emergency";
import { htmlToPdf } from "@/server/pdf/render";
import { runJob } from "./runner";

const FOLDER = "ShortClips OS – Noodprocedure";
const FILE_PREFIX = "noodprocedure-";
const KEEP = 14;

/**
 * Zet elke nacht de noodprocedure als PDF in Google Drive, zodat de kritieke
 * operationele info beschikbaar blijft wanneer het portaal zelf niet werkt.
 * Bewust met provider "monday" (interne placeholder): een mislukte PDF-render is
 * geen storing van de Drive-koppeling en moet die status niet beïnvloeden.
 */
export async function runEmergencyExport() {
  return runJob("monday", "emergency.export", {}, async (ctx) => {
    if (!drive.isConfigured) {
      ctx.log("Google Drive niet geconfigureerd — noodexport overgeslagen.");
      return;
    }
    const snap = await getEmergencySnapshot();
    const pdf = await htmlToPdf(renderEmergencyHtml(snap));
    const day = new Date().toISOString().slice(0, 10);
    const fileName = `${FILE_PREFIX}${day}.pdf`;

    const folderId = await drive.ensureFolder(FOLDER);
    await drive.uploadBytes(fileName, "application/pdf", Buffer.from(pdf), folderId);
    ctx.counters.created++;
    ctx.log(`Noodprocedure-PDF ${fileName} naar Drive geüpload.`);

    // Oude versies opruimen (laatste KEEP bewaren).
    try {
      const files = (await drive.listFolder(folderId))
        .filter((f) => f.name.startsWith(FILE_PREFIX))
        .sort((a, b) => b.name.localeCompare(a.name));
      for (const old of files.slice(KEEP)) {
        await drive.deleteFileById(old.id);
        ctx.counters.updated++;
      }
    } catch {
      /* opruimen mag falen zonder de export te laten mislukken */
    }
  });
}
