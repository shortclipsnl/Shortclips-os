import { NextResponse, type NextRequest } from "next/server";
import { peekQuoteByToken } from "@/server/quotes/token";
import { htmlToPdf } from "@/server/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Rendert de publieke offertepagina (/offerte/[token]?pdf=1) naar een A4-PDF met
 * headless Chromium — exact dezelfde weergave die de klant ziet. Toegang via het
 * onvoorspelbare token; `?pdf=1` zorgt dat deze render niet als opening meetelt
 * en de actieknoppen niet toont.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const q = await peekQuoteByToken(token);
  if (!q) return new NextResponse(null, { status: 404 });

  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/offerte/${encodeURIComponent(token)}?pdf=1`, { cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json({ error: `Offerte kon niet worden geladen (status ${res.status}).` }, { status: 502 });
  }
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

  const filename = `Offerte-${q.number}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
