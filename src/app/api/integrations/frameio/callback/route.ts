import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer, isOwner } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { completeFrameioConsent, FRAMEIO_STATE_COOKIE, frameioStatesMatch } from "@/server/integrations/frameio-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(request: Request, params: Record<string, string>) {
  const url = new URL("/settings/integrations", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: FRAMEIO_STATE_COOKIE, path: "/api/integrations/frameio" });
  return res;
}

/** Adobe stuurt de eigenaar hierheen terug na toestemming. */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer || !isOwner(viewer)) {
    return NextResponse.json({ error: "Alleen de eigenaar kan de Frame.io-koppeling vernieuwen." }, { status: 403 });
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!frameioStatesMatch((await cookies()).get(FRAMEIO_STATE_COOKIE)?.value, state)) {
    return back(request, { frameio: "fout", melding: "De aanvraag is verlopen of ongeldig. Probeer opnieuw." });
  }
  if (url.searchParams.get("error")) return back(request, { frameio: "fout", melding: "Toestemming is geannuleerd." });
  const code = url.searchParams.get("code");
  if (!code) return back(request, { frameio: "fout", melding: "Geen autorisatiecode ontvangen." });
  const outcome = await completeFrameioConsent(code);
  if (!outcome.ok) return back(request, { frameio: "fout", melding: outcome.message });
  await auditLog({ viewer, action: "integration.frameio.reconnect", entityType: "integration" }).catch(() => {});
  return back(request, { frameio: "verbonden" });
}
