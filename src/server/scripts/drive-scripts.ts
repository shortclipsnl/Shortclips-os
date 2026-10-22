import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { files } from "@/db/schema";
import { drive } from "@/server/integrations/drive";

export type PriorScriptPdf = { name: string; base64: string };

/**
 * Haalt de recentste scriptbestanden (PDF) van een klant uit de al
 * gesynchroniseerde Drive-map (categorie "Scripts") en downloadt ze als base64,
 * zodat de scriptgenerator ze als basis/stijlreferentie kan meelezen. Zo hoeft
 * het team eerdere scripts niet handmatig te uploaden.
 */
export async function getClientDriveScriptPdfs(clientId: string, limit = 3): Promise<PriorScriptPdf[]> {
  if (!drive.isConfigured) return [];
  const rows = await db
    .select({ externalId: files.externalId, name: files.name, mimeType: files.mimeType })
    .from(files)
    .where(and(
      eq(files.clientId, clientId),
      eq(files.isFolder, false),
      eq(files.category, "Scripts"),
      isNull(files.deletedAt),
    ))
    .orderBy(desc(files.modifiedAt))
    .limit(limit * 3);

  const pdfs = rows
    .filter((r) => r.externalId && (r.mimeType?.includes("pdf") || r.name.toLowerCase().endsWith(".pdf")))
    .slice(0, limit);

  const out: PriorScriptPdf[] = [];
  for (const r of pdfs) {
    try {
      const bytes = await drive.downloadBytes(r.externalId!);
      if (bytes.byteLength > 10 * 1024 * 1024) continue; // te groot: overslaan
      out.push({ name: r.name, base64: Buffer.from(bytes).toString("base64") });
    } catch { /* bestand overslaan als download faalt */ }
  }
  return out;
}

/** Of er überhaupt scriptbestanden in Drive staan voor deze klant (voor de UI-knop). */
export async function clientHasDriveScripts(clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: files.id })
    .from(files)
    .where(and(
      eq(files.clientId, clientId),
      eq(files.isFolder, false),
      eq(files.category, "Scripts"),
      isNull(files.deletedAt),
    ))
    .limit(1);
  return Boolean(row);
}
