import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/server/auth/context";
import { getLesson } from "@/server/kennisbank";
import { htmlToPdf } from "@/server/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Rendert de printvriendelijke SOP-pagina (/kennisbank-print/[courseId]/[lessonId])
 * naar PDF met een headless Chromium — dezelfde HTML, zodat scherm en PDF
 * gelijk blijven. Toegang via getLesson (respecteert zichtbaarheid van de
 * cursus); de sessie-cookie wordt meegegeven zodat de beveiligde pagina laadt.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ courseId: string; lessonId: string }> }) {
  const { courseId, lessonId } = await params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });

  const lesson = await getLesson(viewer, courseId, lessonId);
  if (!lesson) return new NextResponse(null, { status: 404 });

  const origin = new URL(req.url).origin;
  const printUrl = `${origin}/kennisbank-print/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonId)}`;
  const res = await fetch(printUrl, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json({ error: `Printpagina kon niet worden geladen (status ${res.status}).` }, { status: 502 });
  }
  const html = await res.text();

  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(html);
  } catch (e) {
    return NextResponse.json(
      { error: "PDF genereren is mislukt. Controleer of Chrome beschikbaar is (CHROME_PATH).", detail: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }

  const safeName = lesson.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase() || "sop";
  const filename = `shortclips-sop-${safeName}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
