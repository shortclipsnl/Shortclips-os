import { getViewer } from "@/server/auth/context";
import { buildScriptDocx, fetchScriptsForExport } from "@/server/scripts/document";

export const dynamic = "force-dynamic";

/**
 * Download een scriptdocument als bewerkbaar Word-bestand (.docx).
 *   /api/scripts/export?script=<id>     → één script
 *   /api/scripts/export?session=<id>    → alle scripts van een opnamesessie
 * Toegangscontrole loopt via de klant-scope van de viewer.
 */
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer || viewer.isPortalUser) return new Response("Niet toegestaan", { status: 401 });

  const url = new URL(req.url);
  const scriptId = url.searchParams.get("script") ?? undefined;
  const sessionId = url.searchParams.get("session") ?? undefined;
  if (!scriptId && !sessionId) return new Response("Geen script of sessie opgegeven", { status: 400 });

  let data;
  try {
    data = await fetchScriptsForExport(viewer, { scriptId, sessionId });
  } catch {
    return new Response("Geen toegang tot deze klant", { status: 403 });
  }
  if (!data || data.scripts.length === 0) return new Response("Geen scripts gevonden", { status: 404 });

  const title = sessionId
    ? `Scripts — ${data.sessionTitle ?? data.clientName}`
    : `Script — ${data.scripts[0]!.title}`;
  const subtitle = [data.clientName, data.sessionTitle, data.sessionDate ? new Date(`${data.sessionDate}T00:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : null]
    .filter(Boolean)
    .join(" · ");

  const buffer = await buildScriptDocx(data.scripts, { title, subtitle });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${data.fileBase}.docx"`,
      "Cache-Control": "no-store",
    },
  });
}
