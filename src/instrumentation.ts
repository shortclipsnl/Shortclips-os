/**
 * Centrale registratie van serverfouten.
 *
 * Next.js roept `onRequestError` aan bij elke fout die tijdens het renderen van
 * een pagina, een server action of een API-route optreedt. Die fouten komen
 * zo automatisch in `error_logs` terecht en verschijnen bij Jarno in
 * Instellingen > Koppelingsbewaking > Technische meldingen, met dezelfde
 * referentie die een medewerker op het foutscherm ziet.
 *
 * Bewust niet geregistreerd: doorverwijzingen, "niet gevonden" en
 * toegangsweigeringen. Dat zijn geen storingen.
 * Nooit opgeslagen: headers, cookies of de querystring (kan tokens bevatten).
 */
export async function register() {}

type RequestInfo = { path: string; method: string };
type ContextInfo = { routePath: string; routeType: string; renderSource?: string };

export async function onRequestError(error: unknown, request: RequestInfo, context: ContextInfo) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const err = error as { name?: string; message?: string; digest?: string } | null;
  const digest = err && typeof err === "object" && "digest" in err ? String(err.digest ?? "") : "";
  if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND") return;
  if (err?.name === "ForbiddenError") return;

  try {
    const { logError } = await import("@/server/audit");
    await logError({
      category: "application",
      source: `portaal:${context.routeType}`,
      error,
      context: {
        path: (request.path ?? "").split("?")[0],
        method: request.method,
        routePath: context.routePath,
        routeType: context.routeType,
        ...(digest ? { digest } : {}),
      },
    });
  } catch {
    // Registreren mag een pagina nooit verder breken.
  }
}
