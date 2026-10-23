import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { salesResearch } from "@/db/schema";
import { getViewer } from "@/server/auth/context";
import { htmlToPdf } from "@/server/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Rendert de salespresentatie (/presentatie/[id]) naar een liggende (16:9) PDF
 * met headless Chromium — dezelfde weergave als de editor/preview. De
 * sessie-cookie van de aanvrager wordt meegegeven zodat de beveiligde
 * presentatiepagina laadt. Recht: ai:read.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!viewer.permissions.has("ai:read")) return new NextResponse(null, { status: 403 });

  const [row] = await db
    .select({ id: salesResearch.id, companyName: salesResearch.companyName })
    .from(salesResearch)
    .where(and(eq(salesResearch.id, id), isNull(salesResearch.deletedAt)))
    .limit(1);
  if (!row) return new NextResponse(null, { status: 404 });

  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/presentatie/${encodeURIComponent(id)}`, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json({ error: `Presentatie kon niet worden geladen (status ${res.status}).` }, { status: 502 });
  }
  // <base> injecteren zodat relatieve afbeeldingen (logo, teamfoto's) in de PDF laden.
  let html = await res.text();
  html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/">`);

  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(html);
  } catch (e) {
    return NextResponse.json(
      { error: "PDF genereren is mislukt. Controleer of Chrome beschikbaar is (CHROME_PATH).", detail: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }

  const safe = (row.companyName || "bedrijf").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "bedrijf";
  const datum = new Date().toISOString().slice(0, 10);
  const filename = `Shortclips_Sales_Research_${safe}_${datum}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
