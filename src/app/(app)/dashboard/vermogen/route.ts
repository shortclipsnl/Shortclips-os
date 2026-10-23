import { getViewer, isOwner } from "@/server/auth/context";
import { vermogenDashboardHtml } from "@/server/vermogen/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Levert de volledige, schermvullende vermogensdashboard-pagina uit — alleen
 * aan de eigenaar. Het is een op zichzelf staand document (eigen opmaak en
 * navigatie); het wordt daarom niet in de portaalschil getoond maar als eigen
 * pagina geopend. De opslag loopt via /api/vermogen/* (de ingebouwde shim).
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) {
    return new Response("Niet ingelogd.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (!isOwner(viewer)) {
    return new Response("Deze pagina is alleen voor de eigenaar.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  return new Response(vermogenDashboardHtml(), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
