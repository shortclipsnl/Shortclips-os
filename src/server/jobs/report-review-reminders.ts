import "server-only";
import { syncReportBatches } from "@/server/reports/batch";

/**
 * Dagelijkse maandcontrole (08:00): houdt de controletaak per medewerker per
 * maand bij, stuurt hooguit één herinnering als er geen controledag is
 * ingepland en meldt de goedkeurder één keer zodra alles gecontroleerd is.
 * Een verlopen controledag wordt niet gemeld maar staat als 'te laat' in de
 * takenplanning en op Vandaag. Vervangt de wekelijkse herinnering per klant.
 */
export async function runReportReviewReminders(): Promise<{ scanned: number; reminded: number }> {
  const r = await syncReportBatches();
  return { scanned: r.created + r.updated + r.closed, reminded: r.reminded };
}
