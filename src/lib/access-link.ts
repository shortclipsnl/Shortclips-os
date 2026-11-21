/**
 * Persoonlijke inloglink voor het klantportaal: pure regels, los te testen en
 * gedeeld door proxy, server en client.
 *
 * Vorm van de link: een gewone portaallink met een persoonlijk token erachter,
 * bijv. https://…/portal/scripts/<id>?t=<token>. Daardoor blijft de link
 * herkenbaar als portaallink (en slagen bestaande controles op klant en script),
 * terwijl de proxy hem herkent en via /toegang/<token> laat lopen.
 */

/** Naam van de queryparameter met het persoonlijke token. */
export const ACCESS_PARAM = "t";

/** Token = 32 willekeurige bytes in base64url (43 tekens). */
export const ACCESS_TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

/** Geldigheid van een persoonlijke link. */
export const ACCESS_LINK_TTL_DAYS = 7;

/** Zo vaak mag dezelfde link gebruikt worden (bijv. telefoon én laptop). */
export const ACCESS_LINK_MAX_USES = 10;

export function isAccessToken(value: string | null | undefined): value is string {
  return typeof value === "string" && ACCESS_TOKEN_RE.test(value);
}

/**
 * Alleen een pad binnen het klantportaal is een geldige bestemming. Alles wat
 * naar buiten zou kunnen leiden (//host, backslash, protocol) wordt het overzicht.
 */
export function safePortalPath(input: string | null | undefined): string {
  if (typeof input !== "string") return "/portal";
  const value = input.trim();
  if (!value.startsWith("/portal")) return "/portal";
  if (value.startsWith("//") || value.includes("\\") || value.includes("://") || /[\u0000-\u001f]/.test(value)) return "/portal";
  // /portalX is geen portaalpad.
  const rest = value.slice("/portal".length);
  if (rest && !/^[/?#]/.test(rest)) return "/portal";
  return value.slice(0, 300);
}

/** Pad + overige queryparameters, zonder het token. */
export function stripAccessParam(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(ACCESS_PARAM);
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

/** Volledige persoonlijke link op basis van de portaal-URL. */
export function buildAccessUrl(baseUrl: string, targetPath: string, token: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const path = safePortalPath(targetPath);
  const sep = path.includes("?") ? "&" : "?";
  return `${base}${path}${sep}${ACCESS_PARAM}=${token}`;
}

/** Bevat deze link een persoonlijk token? (Voor de teamweergave.) */
export function hasAccessToken(link: string): boolean {
  try {
    return isAccessToken(new URL(link).searchParams.get(ACCESS_PARAM));
  } catch {
    return false;
  }
}

/** Waar gaat de link naartoe, in klanttaal (voor de knop op /toegang). */
export function destinationLabel(path: string): string {
  const p = safePortalPath(path).split("?")[0]!;
  if (p.startsWith("/portal/scripts/")) return "je scripts";
  if (p.startsWith("/portal/scripts")) return "je scripts";
  if (p.startsWith("/portal/videos")) return "je video's";
  if (p.startsWith("/portal/content") || p.startsWith("/portal/planning") || p.startsWith("/portal/agenda")) return "je planning";
  if (p.startsWith("/portal/resultaten") || p.startsWith("/portal/analyses")) return "je resultaten";
  return "je Shortclips omgeving";
}
