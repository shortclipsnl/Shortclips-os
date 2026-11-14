import { canManageOperations, getViewer, isOwner } from "@/server/auth/context";
import { prijslijstHtml } from "@/server/prijslijst/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Levert de interne prijslijst 2027 uit als op zichzelf staand document voor
 * de iframe op /prijslijst. Fase 1: alleen de eigenaar (Jarno) en de
 * operationeel beheerder (Milou). Iedereen anders krijgt 404.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) {
    return new Response("Niet ingelogd.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (!canManageOperations(viewer)) {
    return new Response("Pagina niet gevonden.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(prijslijstHtml({ owner: isOwner(viewer) }), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
