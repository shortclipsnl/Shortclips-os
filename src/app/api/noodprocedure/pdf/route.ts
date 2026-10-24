import { NextResponse } from "next/server";
import { getViewer, isOwner } from "@/server/auth/context";
import { getEmergencySnapshot, renderEmergencyHtml } from "@/server/emergency";
import { htmlToPdf } from "@/server/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Noodprocedure als PDF. Rendert de zelfstandige HTML direct (geen auth-fetch van
 * een pagina), zodat dezelfde functie ook door de nachtelijke job gebruikt kan
 * worden. Alleen voor eigenaar en coördinator — het bevat alle klanten + contacten.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!(isOwner(viewer) || viewer.primaryRole === "project_coordinator")) {
    return new NextResponse(null, { status: 403 });
  }

  const snap = await getEmergencySnapshot();
  const html = renderEmergencyHtml(snap);

  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(html);
  } catch (e) {
    return NextResponse.json(
      { error: "PDF genereren is mislukt. Controleer of Chrome beschikbaar is (CHROME_PATH).", detail: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }

  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="shortclips-noodprocedure-${day}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
