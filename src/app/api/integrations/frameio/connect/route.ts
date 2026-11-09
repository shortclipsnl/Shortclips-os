import { NextResponse } from "next/server";
import { getViewer, isOwner } from "@/server/auth/context";
import { FRAMEIO_STATE_COOKIE, frameioConsentUrl, newFrameioState } from "@/server/integrations/frameio-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start van 'Opnieuw verbinden' voor Frame.io (alleen de eigenaar). */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer || !isOwner(viewer)) {
    return NextResponse.json({ error: "Alleen de eigenaar kan de Frame.io-koppeling vernieuwen." }, { status: 403 });
  }
  const state = newFrameioState();
  const url = frameioConsentUrl(state);
  if (!url) return NextResponse.json({ error: "FRAMEIO_CLIENT_ID ontbreekt." }, { status: 500 });
  const response = NextResponse.redirect(url);
  response.cookies.set(FRAMEIO_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/integrations/frameio", maxAge: 600 });
  return response;
}
