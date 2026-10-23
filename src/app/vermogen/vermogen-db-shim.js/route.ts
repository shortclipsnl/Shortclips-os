import { getViewer, isOwner } from "@/server/auth/context";
import { vermogenShimJs } from "@/server/vermogen/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * De opslag-shim die de dashboardpagina inlaadt (<script src=
 * "/vermogen/vermogen-db-shim.js">). Alleen voor de eigenaar; vervangt de
 * claude.ai-db door onze /api/vermogen-endpoints.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer || !isOwner(viewer)) {
    return new Response("// niet toegestaan", { status: 403, headers: { "content-type": "application/javascript; charset=utf-8" } });
  }
  return new Response(vermogenShimJs(), {
    status: 200,
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" },
  });
}
