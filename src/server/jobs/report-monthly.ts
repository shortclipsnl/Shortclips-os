import "server-only";
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients } from "@/db/schema";
import { addWorkingDays, snapToWorkingDay } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { ensureMonthlyReport } from "@/server/reports/run";
import { currentMonthPeriod, periodLabel, previousMonthPeriod } from "@/server/reports/analysis";

/** Na zoveel minuten geldt een analyse die nog 'bezig' is als vastgelopen. */
const STALE_MIN = 20;
/** Tijdsbudget per run: ruim onder de maximale looptijd van de job-route (300 s). */
const BUDGET_MS = 100_000;
/** Na zoveel vastgelopen pogingen stopt de wachtrij en meldt het rapport 'mislukt'. */
const MAX_STALE_ATTEMPTS = 3;

const MAX_PER_RUN = 12;

function amsterdamToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

function firstWorkday(): string {
  const period = currentMonthPeriod();
  return snapToWorkingDay(`${period}-01`, nlHolidaySet([Number(period.slice(0, 4))]));
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

  // Alleen klaarzetten in de wachtrij; de analyses zelf draaien in
  // reports.process_queue. Zo kan één lange run nooit halverwege worden
  // afgebroken (wat eerder rapporten op 'analyse bezig' liet hangen).
  let started = 0;
  const failed = 0;
  for (const c of active) {
    if (started >= MAX_PER_RUN * 10) break;
    const [existing] = await db
      .select({ id: clientReports.id, status: clientReports.status })
      .from(clientReports)
      .where(and(eq(clientReports.clientId, c.id), eq(clientReports.period, period), eq(clientReports.periodType, "month"), isNull(clientReports.deletedAt)))
      .limit(1);
    if (!existing) {
      await db.insert(clientReports).values({ clientId: c.id, periodType: "month", period, title: `Maandrapport ${periodLabel(period)}`, status: "gegevens_verzamelen" }).onConflictDoNothing();
      started++;
    } else if (existing.status === "mislukt" && today === firstWorkday()) {
      // Mislukt (bv. nog geen cijfers): op de eerste werkdag één keer opnieuw.
      await db.update(clientReports).set({ status: "gegevens_verzamelen", errorMessage: null, updatedAt: new Date() }).where(eq(clientReports.id, existing.id));
      started++;
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
    .select({ id: clientReports.id, clientId: clientReports.clientId, period: clientReports.period, status: clientReports.status, kwaliteit: clientReports.kwaliteit })
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

  // Een nieuwe analyse start alleen binnen het tijdsbudget: een analyse duurt
  // 1 tot 3 minuten en de job mag de maximale looptijd (300 s) nooit halen.
  let processed = 0;
  let ok = 0;
  let failed = 0;
  for (const r of queue) {
    if (Date.now() - started > BUDGET_MS) break;
    // Vastgelopen analyse: poging tellen; na MAX_STALE_ATTEMPTS niet eindeloos
    // opnieuw proberen (en AI-kosten maken), maar eerlijk 'mislukt' melden.
    if (r.status === "analyse_bezig") {
      const k = (r.kwaliteit ?? {}) as { vastgelopen?: number };
      const pogingen = (k.vastgelopen ?? 0) + 1;
      if (pogingen >= MAX_STALE_ATTEMPTS) {
        await db.update(clientReports).set({ status: "mislukt", startedAt: null, errorMessage: "De analyse liep herhaaldelijk vast (te lange looptijd). Probeer het opnieuw via AI opnieuw.", kwaliteit: { ...k, vastgelopen: 0 }, updatedAt: new Date() }).where(eq(clientReports.id, r.id));
        failed++;
        continue;
      }
      await db.update(clientReports).set({ kwaliteit: { ...k, vastgelopen: pogingen } }).where(eq(clientReports.id, r.id));
    }
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
