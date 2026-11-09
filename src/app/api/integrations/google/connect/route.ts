import { NextResponse } from "next/server";
import { getViewer, isOwner } from "@/server/auth/context";
import { buildConsentUrl, newOAuthState, OAUTH_STATE_COOKIE } from "@/server/integrations/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start van 'Opnieuw verbinden' voor Google (alleen de eigenaar). */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer || !isOwner(viewer)) {
    return NextResponse.json({ error: "Alleen de eigenaar kan de Google-koppeling vernieuwen." }, { status: 403 });
  }
  const allowSwitch = new URL(request.url).searchParams.get("wissel") === "1";
  const state = newOAuthState(allowSwitch);
  const response = NextResponse.redirect(await buildConsentUrl(state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/integrations/google",
    maxAge: 600,
  });
  return response;
}
