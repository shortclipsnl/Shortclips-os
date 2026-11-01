import "server-only";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { clientReports, clients } from "@/db/schema";
import { notify } from "@/server/notifications";
import { periodLabel } from "@/server/reports/analysis";

/** Jaar + ISO-weeknummer, voor week-dedupe zodat we niet dagelijks herinneren. */
function weekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Herinnert projectmanagers aan maandrapporten die te lang op controle wachten
 * (ouder dan 3 dagen). Week-dedupe via de melding-dedupeKey.
 */
export async function runReportReviewReminders(): Promise<{ scanned: number; reminded: number }> {
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: clientReports.id,
      clientId: clientReports.clientId,
      clientName: clients.name,
      period: clientReports.period,
      coordinatorId: clients.coordinatorId,
    })
    .from(clientReports)
    .innerJoin(clients, eq(clients.id, clientReports.clientId))
    .where(and(inArray(clientReports.status, ["klaar_voor_controle", "aanpassing_nodig"]), isNull(clientReports.deletedAt), lt(clientReports.generatedAt, cutoff)))
    .limit(200);

  const wk = weekKey();
  let reminded = 0;
  for (const r of rows) {
    const inserted = await notify({
      roles: ["project_coordinator", "operational_manager"],
      userIds: r.coordinatorId ? [r.coordinatorId] : undefined,
      clientId: r.clientId,
      level: "warning",
      type: "report_review_reminder",
      title: "Maandrapportage wacht nog op controle",
      body: `Het maandrapport van ${r.clientName} (${periodLabel(r.period)}) staat nog klaar voor controle.`,
      href: `/analytics/maandrapportages/${r.id}`,
      entityType: "client_report",
      entityId: r.id,
      dedupeKey: `report_review_reminder:${r.id}:${wk}`,
    }).catch(() => 0);
    if (inserted > 0) reminded++;
  }
  return { scanned: rows.length, reminded };
}
