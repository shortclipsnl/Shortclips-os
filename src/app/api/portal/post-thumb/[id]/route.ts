import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { publications } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Miniatuur van een gepubliceerde post (bewaarde kopie uit Metricool). Los
 * geserveerd zodat de resultatenpagina geen tientallen afbeeldingen in de HTML
 * meestuurt. Alleen voor wie toegang heeft tot de klant van de post.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  const [p] = await db
    .select({ clientId: publications.clientId, data: publications.thumbnailData })
    .from(publications)
    .where(and(eq(publications.id, id), isNull(publications.deletedAt)))
    .limit(1);
  if (!p || !p.data || !hasClientAccess(viewer, p.clientId)) return new NextResponse(null, { status: 404 });
  const m = p.data.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(Buffer.from(m[2]!, "base64")), {
    status: 200,
    headers: { "Content-Type": m[1]!, "Cache-Control": "private, max-age=86400" },
  });
}
