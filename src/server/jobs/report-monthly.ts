import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients } from "@/db/schema";
import { addWorkingDays, snapToWorkingDay } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { ensureMonthlyReport } from "@/server/reports/run";
import { currentMonthPeriod, previousMonthPeriod } from "@/server/reports/analysis";

const MAX_PER_RUN = 12;

function amsterdamToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

/** De eerste ~3 werkdagen van de huidige maand (voor de 1e-werkdag-planning + herkansing). */
function isWithinMonthStart(today: string): boolean {
  const period = currentMonthPeriod();
  const holidays = nlHolidaySet([Number(period.slice(0, 4))]);
  const first = snapToWorkingDay(`${period}-01`, holidays);
  return [0, 1, 2].some((n) => addWorkingDays(first, n, holidays) === today);
}

/**
 * Maandelijkse automatische rapportage: op de eerste werkdag van de maand (met
 * een paar dagen herkansing) wordt voor de VORIGE kalendermaand per actieve klant
 * een rapport klaargezet. Idempotent: klanten met een reeds opgesteld rapport
 * worden overgeslagen. Eén storing blokkeert de rest niet.
 */
export async function runMonthlyReports(): Promise<{ eligible: boolean; period: string; scanned: number; started: number; failed: number }> {
  const today = amsterdamToday();
  const period = previousMonthPeriod(currentMonthPeriod());
  if (!isWithinMonthStart(today)) return { eligible: false, period, scanned: 0, started: 0, failed: 0 };

  const active = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(isNull(clients.deletedAt), inArray(clients.status, ["active", "onboarding"])))
    .limit(500);

  let started = 0;
  let failed = 0;
  for (const c of active) {
    if (started >= MAX_PER_RUN) break;
    const [existing] = await db
      .select({ status: clientReports.status })
      .from(clientReports)
      .where(and(eq(clientReports.clientId, c.id), eq(clientReports.period, period), eq(clientReports.periodType, "month"), isNull(clientReports.deletedAt)))
      .limit(1);
    // Al opgesteld/goedgekeurd/gepubliceerd → overslaan. Mislukt of afwezig → (opnieuw) proberen.
    if (existing && existing.status !== "mislukt" && existing.status !== "gegevens_verzamelen") continue;

    try {
      const res = await ensureMonthlyReport(c.id, period, { triggeredById: null });
      if (res.ok) started++;
      else if (res.reason === "error") failed++;
    } catch {
      failed++;
    }
  }

  return { eligible: true, period, scanned: active.length, started, failed };
}
