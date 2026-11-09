import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer, isOwner } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { completeConsent, OAUTH_STATE_COOKIE, statesMatch } from "@/server/integrations/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(request: Request, params: Record<string, string>) {
  const url = new URL("/settings/integrations", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/integrations/google" });
  return res;
}

/** Google stuurt de gebruiker hierheen terug na toestemming. */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer || !isOwner(viewer)) {
    return NextResponse.json({ error: "Alleen de eigenaar kan de Google-koppeling vernieuwen." }, { status: 403 });
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const expected = (await cookies()).get(OAUTH_STATE_COOKIE)?.value;
  if (!statesMatch(expected, state)) {
    return back(request, { google: "fout", melding: "De aanvraag is verlopen of ongeldig. Probeer opnieuw." });
  }
  if (url.searchParams.get("error")) {
    return back(request, { google: "fout", melding: "Toestemming is geannuleerd." });
  }
  const code = url.searchParams.get("code");
  if (!code) return back(request, { google: "fout", melding: "Geen autorisatiecode ontvangen." });

  const outcome = await completeConsent(code, Boolean(state?.endsWith(".switch")));
  if (!outcome.ok) return back(request, { google: "fout", melding: outcome.message });

  await auditLog({
    viewer,
    action: "integration.google.reconnect",
    entityType: "integration",
    changes: { account: outcome.email },
  }).catch(() => {});
  return back(request, { google: "verbonden" });
}
