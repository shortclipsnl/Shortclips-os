import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { quotes } from "@/db/schema";
import { getViewer, isOwner } from "@/server/auth/context";
import { downloadQuotePdf } from "@/server/quotes/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serveert het ondertekende document of het ontvangstbewijs van een offerte.
 *  Uitsluitend de eigenaar. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const viewer = await getViewer();
  if (!isOwner(viewer)) return new NextResponse("Niet toegestaan", { status: 403 });
  const { id, kind } = await params;

  const [q] = await db.select({ signed: quotes.signedPdfPath, receipt: quotes.signingReceiptPath, original: quotes.originalPdfPath, number: quotes.number }).from(quotes).where(eq(quotes.id, id)).limit(1);
  if (!q) return new NextResponse("Niet gevonden", { status: 404 });
  const key = kind === "signed" ? q.signed : kind === "receipt" ? q.receipt : kind === "original" ? q.original : null;
  if (!key) return new NextResponse("Niet beschikbaar", { status: 404 });

  const buf = await downloadQuotePdf(key);
  if (!buf) return new NextResponse("Bestand niet beschikbaar", { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Offerte-${q.number}-${kind}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
