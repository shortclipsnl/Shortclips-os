import "server-only";
import { syncReportBatches } from "@/server/reports/batch";

/**
 * Dagelijkse maandcontrole (08:00): houdt de taken per klant per processtap
 * (controleren, goedkeuren, versturen) in lijn met de status van de
 * maandrapportages. Geen losse herinneringen: een verlopen taak staat als
 * 'te laat' in de takenplanning en op Vandaag.
 */
export async function runReportReviewReminders(): Promise<{ scanned: number; reminded: number }> {
  const r = await syncReportBatches();
  return { scanned: r.created + r.updated + r.closed + r.reopened, reminded: 0 };
}
