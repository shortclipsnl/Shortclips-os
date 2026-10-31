import { NextResponse, type NextRequest } from "next/server";
import { handleSignhostPostback } from "@/server/actions/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Signhost/Evidos postback: Signhost meldt hier de voortgang van een transactie
 * (we pollen niet). Bij "signed" (Status 30) halen we het ondertekende document
 * + ontvangstbewijs op en zetten de offerte op "ondertekend".
 *
 * LET OP: in de sandbox moet de echtheidscontrole (checksum/handtekening van de
 * postback) nog toegevoegd worden voordat dit live gaat.
 */
export async function POST(req: NextRequest) {
  let body: { Id?: string; Status?: number } = {};
  try {
    body = (await req.json()) as { Id?: string; Status?: number };
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (body.Id && typeof body.Status === "number") {
    await handleSignhostPostback(body.Id, body.Status).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
