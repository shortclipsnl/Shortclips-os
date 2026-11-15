import { NextResponse } from "next/server";
import { getViewer } from "@/server/auth/context";
import { getPortalQuarterDetail } from "@/server/quarterly/service";
import { renderQuarterDirectieHtml, renderQuarterKlantHtml } from "@/server/quarterly/pdf-html";
import { htmlToPdf } from "@/server/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Portaal-PDF: uitsluitend de eigen, gepubliceerde kwartaalrapportage van de
 * klant, in de versie die is goedgekeurd en gepubliceerd. De interne versie is
 * hier niet op te vragen.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer || !viewer.isPortalUser) return new NextResponse(null, { status: 401 });
  // Hard gescoopt: eigen klant én gepubliceerd (anders null).
  const rapport = await getPortalQuarterDetail(viewer, id);
  if (!rapport) return new NextResponse(null, { status: 403 });
  const directie = new URL(req.url).searchParams.get("versie") === "directie";
  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(directie ? renderQuarterDirectieHtml(rapport) : renderQuarterKlantHtml(rapport));
  } catch (e) {
    return NextResponse.json({ error: "PDF genereren is mislukt.", detail: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  const safe = (rapport.clientName || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "klant";
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Shortclips_${directie ? "Directieoverzicht" : "Kwartaalrapportage"}_${safe}_${rapport.periodKey.replace(/[^A-Za-z0-9]+/g, "_")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
