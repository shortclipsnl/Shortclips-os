import "server-only";
import { notFound } from "next/navigation";
import { requireOwner, ForbiddenError } from "@/server/auth/context";

/**
 * Financiële pagina's bestaan voor teamleden niet: zij krijgen "pagina niet
 * gevonden" in plaats van een foutmelding of "geen toegang". Niet ingelogd
 * blijft gewoon doorsturen naar de login (dat regelt requireOwner).
 */
export async function requireFinanceOwner() {
  try {
    return await requireOwner();
  } catch (e) {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  }
}
