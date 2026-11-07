import "server-only";
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients } from "@/db/schema";
import { addWorkingDays, snapToWorkingDay } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { ensureMonthlyReport } from "@/server/reports/run";
import { currentMonthPeriod, previousMonthPeriod } from "@/server/reports/analysis";

/** Na zoveel minuten geldt een analyse die nog 'bezig' is als vastgelopen. */
const STALE_MIN = 20;
/** Tijdsbudget per run: ruim onder de maximale looptijd van de job-route (300 s). */
const BUDGET_MS = 230_000;

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
    // Al opgesteld/goedgekeurd/gepubliceerd → overslaan. Mislukt, afwezig of in
    // de wachtrij → (opnieuw) proberen.
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

/**
 * Verwerkt de wachtrij, elke dag en voor elke maand: rapporten die klaargezet
 * zijn ("gegevens_verzamelen", bv. via "Genereer ontbrekende rapporten") en
 * analyses die zijn vastgelopen ("analyse_bezig" langer dan STALE_MIN minuten,
 * bv. door een time-out). Werkt binnen een vast tijdsbudget; de rest volgt bij
 * de volgende run. Eén storing blokkeert de rest niet.
 */
export async function runReportQueue(): Promise<{ queued: number; processed: number; ok: number; failed: number }> {
  const started = Date.now();
  const staleBefore = new Date(Date.now() - STALE_MIN * 60000);
  const queue = await db
    .select({ id: clientReports.id, clientId: clientReports.clientId, period: clientReports.period })
    .from(clientReports)
    .where(and(
      eq(clientReports.periodType, "month"),
      isNull(clientReports.deletedAt),
      or(
        eq(clientReports.status, "gegevens_verzamelen"),
        and(eq(clientReports.status, "analyse_bezig"), or(isNull(clientReports.startedAt), lt(clientReports.startedAt, staleBefore))),
      ),
    ))
    .orderBy(asc(clientReports.updatedAt))
    .limit(50);

  let processed = 0;
  let ok = 0;
  let failed = 0;
  for (const r of queue) {
    if (Date.now() - started > BUDGET_MS) break;
    processed++;
    try {
      const res = await ensureMonthlyReport(r.clientId, r.period, { force: true, triggeredById: null });
      if (res.ok) ok++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { queued: queue.length, processed, ok, failed };
}
