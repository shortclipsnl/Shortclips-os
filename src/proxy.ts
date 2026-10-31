import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Eerste, goedkope poortwachter (heette vóór Next 16 `middleware`).
 *
 * Hier gebeurt bewust géén autorisatie: de proxy draait los van de rest van de
 * applicatie en heeft geen databasetoegang. Hij controleert alleen of er
 * überhaupt een sessiecookie is, zodat uitgelogde bezoekers meteen naar het
 * inlogscherm gaan. De échte controle — bestaat de sessie, welke rechten, welke
 * klanten — gebeurt server-side in `getViewer()` bij elke pagina en actie.
 */
// /api/jobs, /api/kosten en /api/vermogen/import zijn publiek op proxy-niveau,
// maar worden door de route zélf beveiligd met een geheim token (CRON_SECRET,
// KOSTEN_IMPORT_TOKEN resp. VERMOGEN_IMPORT_TOKEN) — anders zou de geplande
// import nooit binnenkomen. De overige /api/vermogen-routes blijven
// sessiebeschermd (eigenaar), dus die staan hier bewust niet bij.
const PUBLIC_PATHS = ["/login", "/api/webhooks", "/api/health", "/api/jobs", "/api/kosten", "/api/vermogen/import"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has("sc_os_session");
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?verder=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Alles behalve statische bestanden en Next-interne routes. De lokale
    // upload-route van de AI Editor slaat de proxy over: anders buffert Next
    // de body (max. 10 MB) en komen grote camerabestanden afgekapt binnen. Die
    // route controleert zelf de sessie en rechten.
    "/((?!_next/static|_next/image|favicon.ico|api/ai-editor/blob|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
