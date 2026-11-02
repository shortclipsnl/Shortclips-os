import { NextResponse } from "next/server";
import { getViewer, isOwner } from "@/server/auth/context";
import { getMentorExportData, renderMentorExportHtml } from "@/server/mentor-export";
import { htmlToPdf } from "@/server/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Volledige export van de AI CEO Mentor als PDF. Alleen de eigenaar: het bevat
 * zijn privé-gesprekken, adviezen en persoonlijk geheugen. Rendert zelfstandige
 * HTML (geen auth-fetch) en levert de PDF als download.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!isOwner(viewer)) return new NextResponse(null, { status: 403 });

  const data = await getMentorExportData(viewer);
  const html = renderMentorExportHtml(data);

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
      "Content-Disposition": `attachment; filename="shortclips-ai-mentor-export-${day}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
