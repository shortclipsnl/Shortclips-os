import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients } from "@/db/schema";
import { getClientReport } from "@/server/client-report";
import { runJob } from "./runner";

function currentPeriod(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
}
function periodTitle(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const name = new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  return `Maandrapport ${name}`;
}

/**
 * Stelt voor elke actieve klant automatisch een maandrapport-concept samen uit
 * de echte cijfers. Nooit automatisch publiceren — de coördinator keurt goed en
 * publiceert pas naar het portaal. Idempotent per klant+maand.
 */
export async function runMonthlyReportDrafts() {
  return runJob("monday", "reports.generate_drafts", {}, async (ctx) => {
    const period = currentPeriod();
    const active = await db
      .select({ id: clients.id, slug: clients.slug })
      .from(clients)
      .where(and(eq(clients.status, "active"), isNull(clients.deletedAt)));
    ctx.log(`${active.length} actieve klanten · periode ${period}`);

    for (const c of active) {
      try {
        const report = await getClientReport(c.slug, 30);
        if (!report.hasData) {
          ctx.counters.failed++;
          continue;
        }
        ctx.counters.processed++;
        const summary = report.observations.join(" ");
        const [existing] = await db
          .select({ id: clientReports.id })
          .from(clientReports)
          .where(and(eq(clientReports.clientId, c.id), eq(clientReports.period, period)))
          .limit(1);
        if (existing) {
          await db.update(clientReports).set({ title: periodTitle(period), summary, metrics: report.totals, updatedAt: new Date() }).where(eq(clientReports.id, existing.id));
          ctx.counters.updated++;
        } else {
          await db.insert(clientReports).values({
            clientId: c.id,
            periodType: "month",
            period,
            title: periodTitle(period),
            summary,
            metrics: report.totals,
          });
          ctx.counters.created++;
        }
      } catch {
        ctx.counters.failed++;
      }
    }
    ctx.log(`Klaar: ${ctx.counters.created} concepten nieuw, ${ctx.counters.updated} bijgewerkt (nog niet gepubliceerd).`);
  });
}
