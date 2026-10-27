import { getViewer, hasClientAccess } from "@/server/auth/context";
import { getScriptPdfVersion } from "@/server/script-review";
import { downloadScriptPdf } from "@/server/scripts/script-storage";

export const dynamic = "force-dynamic";

/**
 * Serveert een script-review-PDF inline. Klant-veilig: toegankelijk voor de klant
 * van de review (portaalgebruiker) én voor interne medewerkers met toegang tot
 * die klant — nooit voor andere klanten. (hasClientAccess dekt beide: een
 * portaalgebruiker heeft exact de eigen klant in scope.)
 */
export async function GET(_req: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Niet toegestaan", { status: 401 });

  const { versionId } = await ctx.params;
  const file = await getScriptPdfVersion(versionId);
  if (!file) return new Response("Niet gevonden", { status: 404 });
  if (!hasClientAccess(viewer, file.clientId)) return new Response("Niet toegestaan", { status: 403 });

  // Nieuwe, grote versies staan in Supabase Storage; oude als base64 in de db.
  let buffer: Buffer | null = null;
  if (file.storagePath) {
    buffer = await downloadScriptPdf(file.storagePath);
  } else if (file.dataBase64) {
    buffer = Buffer.from(file.dataBase64, "base64");
  }
  if (!buffer) return new Response("Niet gevonden", { status: 404 });
  const safeName = file.fileName.replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": file.contentType || "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
