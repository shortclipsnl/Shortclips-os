import { NextResponse, type NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { htmlToPdf } from "@/server/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Rendert de bestaande A4-rapportpagina (/rapport/[slug]) naar PDF met een
 * headless Chromium. Geen aparte opmaak: dezelfde HTML, zodat scherm en PDF
 * gelijk blijven. Recht reports:read + harde klantscheiding; de sessie-cookie
 * van de aanvrager wordt meegegeven zodat de beveiligde rapportpagina laadt.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!viewer.permissions.has("reports:read")) return new NextResponse(null, { status: 403 });

  const [client] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return new NextResponse(null, { status: 404 });
  if (!hasClientAccess(viewer, client.id)) return new NextResponse(null, { status: 403 });

  const url = new URL(req.url);
  const days = Number(url.searchParams.get("dagen")) || 90;

  // Haal de gerenderde rapport-HTML op met de cookie van de aanvrager.
  const origin = url.origin;
  const reportUrl = `${origin}/rapport/${encodeURIComponent(slug)}?dagen=${days}`;
  const res = await fetch(reportUrl, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: `Rapportpagina kon niet worden geladen (status ${res.status}).` },
      { status: 502 },
    );
  }
  const html = await res.text();

  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(html);
  } catch (e) {
    // Eerlijk falen: geen lege of kapotte download, maar een duidelijke melding.
    return NextResponse.json(
      { error: "PDF genereren is mislukt. Controleer of Chrome beschikbaar is (CHROME_PATH).", detail: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }

  const safeName = client.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase() || slug;
  const filename = `shortclips-rapport-${safeName}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
