import "server-only";
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { files } from "@/db/schema";
import { drive } from "@/server/integrations/drive";

export type PriorScriptPdf = { name: string; base64: string };

/**
 * Bestanden die bij de scripts van een klant horen. Pakt niet alleen de map die
 * exact "Scripts" heet (categorie "Scripts"), maar ook mappen als "Short Video
 * Scripts" — daar staan de script-PDF's vaak. Match op categorie óf op het pad/
 * de naam die "script" bevat, zodat geen script-PDF wordt gemist.
 */
function scriptFileWhere(clientId: string): SQL {
  return and(
    eq(files.clientId, clientId),
    eq(files.isFolder, false),
    isNull(files.deletedAt),
    or(
      eq(files.category, "Scripts"),
      sql`lower(${files.path}) like '%script%'`,
      sql`lower(${files.name}) like '%script%'`,
    ),
  )!;
}

/** Een scriptbestand in Drive met een directe open-link (de webViewLink). */
export type DriveScriptLink = { name: string; url: string | null; modifiedAt: string | null };

/**
 * Haalt per klant de scriptbestanden (PDF/doc) uit de al gesynchroniseerde
 * Drive-map (categorie "Scripts") op als open-links — nieuwste eerst — zodat ze
 * rechtstreeks op de scriptingpagina getoond kunnen worden. Dit is enkel een
 * DB-lezing (geen Drive-download), dus snel en veilig om bij het laden van de
 * pagina voor alle opnames in één keer te doen. Geen Drive gekoppeld → leeg.
 */
export async function listClientDriveScriptLinks(
  clientIds: string[],
  perClient = 12,
): Promise<Map<string, DriveScriptLink[]>> {
  const result = new Map<string, DriveScriptLink[]>();
  const ids = [...new Set(clientIds.filter(Boolean))];
  if (ids.length === 0) return result;

  const rows = await db
    .select({
      clientId: files.clientId,
      name: files.name,
      url: files.externalUrl,
      mimeType: files.mimeType,
      modifiedAt: files.modifiedAt,
    })
    .from(files)
    .where(and(
      inArray(files.clientId, ids),
      eq(files.isFolder, false),
      isNull(files.deletedAt),
      or(
        eq(files.category, "Scripts"),
        sql`lower(${files.path}) like '%script%'`,
        sql`lower(${files.name}) like '%script%'`,
      ),
    ))
    .orderBy(desc(files.modifiedAt));

  for (const r of rows) {
    if (!r.clientId) continue;
    // Alleen echte scriptdocumenten (PDF/Word/Google Doc) — geen losse mappen of
    // toevallige bestanden in de scriptsmap.
    const n = r.name.toLowerCase();
    const isDoc = r.mimeType?.includes("pdf") || r.mimeType?.includes("document")
      || r.mimeType?.includes("word") || n.endsWith(".pdf") || n.endsWith(".docx") || n.endsWith(".doc");
    if (!isDoc) continue;
    const arr = result.get(r.clientId) ?? [];
    if (arr.length >= perClient) continue;
    arr.push({
      name: r.name,
      url: r.url,
      modifiedAt: r.modifiedAt ? (r.modifiedAt instanceof Date ? r.modifiedAt.toISOString() : String(r.modifiedAt)) : null,
    });
    result.set(r.clientId, arr);
  }
  return result;
}

/**
 * Haalt de recentste scriptbestanden (PDF) van een klant uit de al
 * gesynchroniseerde Drive-map (categorie "Scripts") en downloadt ze als base64,
 * zodat de scriptgenerator ze als basis/stijlreferentie kan meelezen. Zo hoeft
 * het team eerdere scripts niet handmatig te uploaden.
 */
export async function getClientDriveScriptPdfs(clientId: string, limit = 6): Promise<PriorScriptPdf[]> {
  if (!drive.isConfigured) return [];
  const rows = await db
    .select({ externalId: files.externalId, name: files.name, mimeType: files.mimeType })
    .from(files)
    .where(scriptFileWhere(clientId))
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

/** Aantal script-PDF's in Drive voor deze klant — voor de live melding in de UI. */
export async function getClientDriveScriptInfo(clientId: string): Promise<{ count: number }> {
  const rows = await db
    .select({ name: files.name, mimeType: files.mimeType })
    .from(files)
    .where(scriptFileWhere(clientId))
    .limit(200);
  const count = rows.filter((r) => r.mimeType?.includes("pdf") || r.name.toLowerCase().endsWith(".pdf")).length;
  return { count };
}

/** Of er überhaupt scriptbestanden in Drive staan voor deze klant (voor de UI-knop). */
export async function clientHasDriveScripts(clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: files.id })
    .from(files)
    .where(scriptFileWhere(clientId))
    .limit(1);
  return Boolean(row);
}
