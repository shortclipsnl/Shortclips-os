import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { editProjectFiles, productionDays } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { downloadEditScript } from "@/server/editing/script-file";

export const dynamic = "force-dynamic";

/**
 * Download/inline een geüpload bestand (nu: het script-pdf van een edit-project).
 * Alleen intern, en alleen voor de eigen klanten of de toegewezen editor.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer || viewer.primaryRole === "client") {
    return new Response("Niet toegestaan", { status: 401 });
  }
  const { id } = await ctx.params;

  const [row] = await db
    .select({
      fileName: editProjectFiles.fileName,
      contentType: editProjectFiles.contentType,
      dataBase64: editProjectFiles.dataBase64,
      storagePath: editProjectFiles.storagePath,
      clientId: productionDays.clientId,
      editorId: productionDays.editorId,
    })
    .from(editProjectFiles)
    .innerJoin(productionDays, eq(productionDays.id, editProjectFiles.productionDayId))
    .where(eq(editProjectFiles.id, id))
    .limit(1);

  if (!row) return new Response("Niet gevonden", { status: 404 });

  // Toegang: de toegewezen editor, of iemand met toegang tot deze klant.
  const allowed = row.editorId === viewer.id || hasClientAccess(viewer, row.clientId);
  if (!allowed) return new Response("Niet toegestaan", { status: 403 });

  // Bytes uit Supabase (grote bestanden) of uit base64 in de database (klein).
  const buffer = row.storagePath
    ? await downloadEditScript(row.storagePath)
    : row.dataBase64
      ? Buffer.from(row.dataBase64, "base64")
      : null;
  if (!buffer) return new Response("Bestand niet beschikbaar", { status: 404 });
  const safeName = row.fileName.replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": row.contentType || "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
