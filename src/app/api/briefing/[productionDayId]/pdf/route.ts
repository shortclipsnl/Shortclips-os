import { NextResponse, type NextRequest } from "next/server";
import { ForbiddenError, getViewer } from "@/server/auth/context";
import { briefingHtml, loadBriefingFor } from "@/server/briefing/access";
import { htmlToPdf } from "@/server/pdf/render";
import { mergePdfs } from "@/server/briefing/pdfjs-server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbAssetParts } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Editor-briefing als PDF: de briefingpagina's in dezelfde opmaak als in het
 * portaal, gevolgd door de originele scriptpagina's. Toegang via `loadBriefingFor` (team binnen de eigen klanten,
 * editors alleen voor hun eigen opname).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ productionDayId: string }> }) {
  const { productionDayId } = await params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });

  let loaded;
  try {
    loaded = await loadBriefingFor(viewer, productionDayId);
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse(null, { status: 403 });
    throw e;
  }
  if (!loaded || loaded.doc.scripts.length === 0) return new NextResponse(null, { status: 404 });

  let pdf: Uint8Array;
  try {
    // Pagina 1-2 (omslag, overzicht, richtlijnen, materiaal) + de scriptpagina's
    // exact zoals in de script-PDF.
    const head = await htmlToPdf(await briefingHtml(loaded.doc, "pdf"));
    const assetId = loaded.doc.scriptPagesAssetId;
    if (assetId) {
      const parts = await db.select({ data: kbAssetParts.data }).from(kbAssetParts).where(eq(kbAssetParts.assetId, assetId)).orderBy(asc(kbAssetParts.partNo));
      const scripts = new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p.data))));
      pdf = await mergePdfs([head, scripts]);
    } else {
      pdf = head;
    }
  } catch (e) {
    return NextResponse.json(
      { error: "PDF genereren is mislukt. Controleer of Chrome beschikbaar is (CHROME_PATH).", detail: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }

  const safe = (loaded.doc.client.name || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "klant";
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="Editor_briefing_${safe}_${loaded.doc.session.date}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
