import "server-only";
import { notInactiveClient } from "@/server/client-activity";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients } from "@/db/schema";
import { laatsteWerkdag, maandCompleetVanaf, nthWorkday } from "@/lib/maandcontrole";
import { nlHolidaySet } from "@/lib/holidays";
import { ensureMonthlyReport } from "@/server/reports/run";
import { syncReportBatches } from "@/server/reports/batch";
import { ANALYSE_VERSIE, currentMonthPeriod, periodLabel, previousMonthPeriod } from "@/server/reports/analysis";

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
  return nthWorkday(period, 1, nlHolidaySet([Number(period.slice(0, 4))]));
}

/** De eerste 3 werkdagen van de huidige maand (vangnet voor ontbrekende rapporten van de vorige maand). */
function isWithinMonthStart(today: string): boolean {
  const period = currentMonthPeriod();
  const holidays = nlHolidaySet([Number(period.slice(0, 4))]);
  return [1, 2, 3].some((n) => nthWorkday(period, n, holidays) === today);
}

/** Zet voor elke actieve klant zonder rapport een rapport voor `period` in de wachtrij. */
async function queueMissing(period: string, retryFailed: boolean): Promise<{ scanned: number; started: number }> {
  const active = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(isNull(clients.deletedAt), inArray(clients.status, ["active", "onboarding"])))
    .limit(500);

  // Alleen klaarzetten in de wachtrij; de analyses zelf draaien in
  // reports.process_queue. Zo kan één lange run nooit halverwege worden
  // afgebroken (wat eerder rapporten op 'analyse bezig' liet hangen).
  let started = 0;
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
    } else if (existing.status === "mislukt" && retryFailed) {
      await db.update(clientReports).set({ status: "gegevens_verzamelen", errorMessage: null, updatedAt: new Date() }).where(eq(clientReports.id, existing.id));
      started++;
    }
  }
  return { scanned: active.length, started };
}

/**
 * Rapporten met voorlopige cijfers (gegenereerd vóór de 1e van de volgende
 * maand) opnieuw in de wachtrij zetten zodra de maand compleet is, zodat de
 * definitieve maandresultaten er staan vóór goedkeuring. De beoordeling,
 * feedback en eerdere versies blijven bewaard; goedgekeurde rapporten blijven
 * ongemoeid (die kunnen nooit voorlopig zijn).
 */
export async function requeueVoorlopigeReports(period: string): Promise<number> {
  const grens = maandCompleetVanaf(period);
  const rows = await db
    .update(clientReports)
    .set({ status: "gegevens_verzamelen", errorMessage: null, updatedAt: new Date() })
    .where(and(
      eq(clientReports.periodType, "month"),
      eq(clientReports.period, period),
      isNull(clientReports.deletedAt),
      inArray(clientReports.status, ["klaar_voor_controle", "aanpassing_nodig"]),
      or(isNull(clientReports.generatedAt), sql`(${clientReports.generatedAt} at time zone 'Europe/Amsterdam')::date < ${grens}::date`),
      notInactiveClient(clientReports.clientId),
    ))
    .returning({ id: clientReports.id });
  return rows.length;
}

/**
 * Maandelijkse automatische rapportage.
 *  - Op de laatste werkdag van de maand (controledag) wordt voor de LOPENDE
 *    maand per actieve klant een rapport met voorlopige cijfers klaargezet, zodat
 *    het team kan voorbereiden en controleren.
 *  - Zodra de maand voorbij is worden die rapporten ververst met de complete
 *    maandcijfers (definitief); ontbrekende rapporten van de vorige maand worden
 *    in de eerste werkdagen alsnog gemaakt.
 * Idempotent: klanten met een reeds opgesteld rapport worden overgeslagen.
 */
export async function runMonthlyReports(): Promise<{ eligible: boolean; period: string; scanned: number; started: number; failed: number; bijgewerkt: number }> {
  const today = amsterdamToday();
  const huidig = currentMonthPeriod();
  const vorige = previousMonthPeriod(huidig);
  const holidays = nlHolidaySet([Number(huidig.slice(0, 4))]);

  // Vorige maand: verouderd analyseformaat en voorlopige cijfers verversen.
  const bijgewerkt = (await requeueOutdatedReports(vorige)) + (await requeueVoorlopigeReports(vorige));

  let scanned = 0;
  let started = 0;
  let eligible = false;
  if (isWithinMonthStart(today)) {
    eligible = true;
    const r = await queueMissing(vorige, today === firstWorkday());
    scanned += r.scanned; started += r.started;
  }
  // Lopende maand: vanaf de laatste werkdag voorlopige rapporten klaarzetten.
  let period = vorige;
  if (today >= laatsteWerkdag(huidig, holidays)) {
    eligible = true;
    period = huidig;
    const r = await queueMissing(huidig, false);
    scanned += r.scanned; started += r.started;
  }
  return { eligible, period, scanned, started, failed: 0, bijgewerkt };
}

/**
 * Rapporten van de afgelopen maand die nog op controle wachten maar in een
 * ouder analyseformaat staan, opnieuw in de wachtrij zetten. Zo krijgt het team
 * na een verbetering van de analyse automatisch de nieuwe versie, zonder dat
 * iemand op 'AI opnieuw' hoeft te klikken. Goedgekeurde rapporten blijven
 * ongemoeid; feedback en eerdere versies blijven bewaard.
 */
export async function requeueOutdatedReports(period: string): Promise<number> {
  const rows = await db
    .update(clientReports)
    .set({ status: "gegevens_verzamelen", errorMessage: null, updatedAt: new Date() })
    .where(and(
      eq(clientReports.periodType, "month"),
      eq(clientReports.period, period),
      isNull(clientReports.deletedAt),
      inArray(clientReports.status, ["klaar_voor_controle", "aanpassing_nodig"]),
      sql`coalesce((${clientReports.analysis}->>'versie')::int, 0) < ${ANALYSE_VERSIE}`,
      notInactiveClient(clientReports.clientId),
    ))
    .returning({ id: clientReports.id });
  return rows.length;
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
        // Centrale klantstatus: geen nieuwe rapportages voor een niet actieve klant.
        // Een handmatig gestarte generatie die vastliep (analyse_bezig) wordt wel
        // afgemaakt, zodat administratieve afronding mogelijk blijft.
        and(eq(clientReports.status, "gegevens_verzamelen"), notInactiveClient(clientReports.clientId)),
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
  // Maandtaken bijwerken (ook als de laatste generatie mislukte), zodat de
  // melding "staan klaar" komt zodra alles voor iemand gegenereerd is.
  if (processed > 0 || failed > 0) await syncReportBatches().catch(() => undefined);
  return { queued: queue.length, processed, ok, failed };
}
