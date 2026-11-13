import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getViewer, hasClientAccess } from "@/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Omslag van een gepubliceerde video (opgeslagen kopie uit Metricool).
 * Los geserveerd in plaats van als data-URI in de pagina, zodat de pagina
 * licht blijft en de browser de afbeeldingen cachet. Alleen voor wie toegang
 * heeft tot de klant; anders bestaat de afbeelding niet (404).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 404 });
  const res = await db.execute(sql`select client_id, thumbnail_data from publications where id = ${id} and deleted_at is null limit 1`);
  const row = (((res as { rows?: unknown[] }).rows ?? res) as Array<{ client_id: string; thumbnail_data: string | null }>)[0];
  if (!row || !hasClientAccess(viewer, row.client_id) || !row.thumbnail_data) return new NextResponse(null, { status: 404 });
  const m = row.thumbnail_data.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]*)$/);
  if (!m) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(m[2], "base64"), {
    headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=604800" },
  });
}
