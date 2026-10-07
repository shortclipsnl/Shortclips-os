import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { frameio } from "@/server/integrations/frameio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Omslag-proxy voor video's. Frame.io levert thumbnails als ondertekende URL's
 * die na enkele uren verlopen; we slaan de laatste URL op en vernieuwen 'm pas
 * wanneer hij bijna verloopt. Zo blijft de omslag altijd zichtbaar zonder bij
 * elke paginaweergave Frame te bevragen.
 *
 * Harde klantscheiding: een gebruiker kan alleen de omslag van een video van de
 * eigen klant opvragen.
 */

/** Vervaltijd (ms) uit de `exp=`-parameter van de ondertekende Frame-URL. */
function expiryOf(url: string | null | undefined): number {
  if (!url) return 0;
  const m = url.match(/[?&]exp=(\d+)/);
  return m ? Number(m[1]) * 1000 : 0;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });

  const [v] = await db
    .select({
      id: deliverables.id,
      clientId: deliverables.clientId,
      frameAssetId: deliverables.frameAssetId,
      thumbnailUrl: deliverables.thumbnailUrl,
    })
    .from(deliverables)
    .where(and(eq(deliverables.id, id), isNull(deliverables.deletedAt)))
    .limit(1);

  if (!v || !hasClientAccess(viewer, v.clientId) || !v.frameAssetId) {
    return new NextResponse(null, { status: 404 });
  }

  let url = v.thumbnailUrl;
  // Vernieuw als de opgeslagen URL ontbreekt of binnen 2 minuten verloopt.
  if (expiryOf(url) < Date.now() + 120_000) {
    try {
      const fresh = await frameio.getFileThumbnail(v.frameAssetId);
      if (fresh) {
        url = fresh;
        await db
          .update(deliverables)
          .set({ thumbnailUrl: fresh })
          .where(eq(deliverables.id, v.id));
      }
    } catch {
      // Val terug op de opgeslagen URL (mogelijk net verlopen) i.p.v. een fout.
    }
  }

  if (!url) return new NextResponse(null, { status: 404 });

  return NextResponse.redirect(url, {
    status: 307,
    headers: { "Cache-Control": "private, max-age=600" },
  });
}
