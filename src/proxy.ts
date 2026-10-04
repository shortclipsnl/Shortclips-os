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
const PUBLIC_PATHS = ["/login", "/api/webhooks", "/api/health"];

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
    // Alles behalve statische bestanden en Next-interne routes.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
