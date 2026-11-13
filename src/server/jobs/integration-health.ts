import "server-only";
import { runMonitorWatch } from "@/server/monitoring/watch";

/**
 * Gezondheidscheck van de externe koppelingen. Vervangen door de centrale
 * Koppelingsbewaking (src/server/monitoring), die elk kwartier draait, zelf
 * herstelt en de beheerder alleen meldt als dat nodig is. Deze functie blijft
 * bestaan omdat de nachtelijke externe sync hem aanroept.
 */
export async function runIntegrationHealthCheck() {
  return runMonitorWatch({ trigger: "nightly" });
}
