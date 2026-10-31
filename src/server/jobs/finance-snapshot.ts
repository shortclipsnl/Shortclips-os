import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientFinanceMonths, clients, productionDays } from "@/db/schema";

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/**
 * Maakt (of werkt bij) de maandstaat van de huidige maand voor elke actieve
 * klant. We factureren op basis van de geplande opnames (Google Agenda →
 * production_days): alleen klanten die díe maand een opname hebben staan,
 * krijgen automatisch omzet, meerwerk en editkosten. Klanten zonder geplande
 * opname die maand → 0 (we hebben niet elke klant elke maand). Zo staat er geen
 * omzet "voor niets" op het bord. Handmatige directe kosten (opname, strategie,
 * overig) blijven staan — die worden hier nooit overschreven. Idempotent.
 */
export async function snapshotFinanceMonth(period = currentPeriod()): Promise<{ ok: boolean; period: string; clients: number; billable: number }> {
  const active = await db
    .select({
      id: clients.id,
      monthlyRevenue: clients.monthlyRevenue,
      extraRevenue: clients.extraRevenue,
      editCostPerVideo: clients.editCostPerVideo,
      shorts: clients.monthlyVideoQuota,
    })
    .from(clients)
    .where(and(isNull(clients.deletedAt), eq(clients.status, "active")));

  // Klanten met een geplande opname in deze maand — alleen die kunnen we
  // factureren. De opnameplanning komt uit de agenda-sync (production_days).
  const shootRows = await db
    .selectDistinct({ clientId: productionDays.clientId })
    .from(productionDays)
    .where(and(
      isNull(productionDays.deletedAt),
      sql`${productionDays.status} <> 'cancelled'`,
      sql`to_char(${productionDays.scheduledOn}, 'YYYY-MM') = ${period}`,
    ));
  const hasShoot = new Set(shootRows.map((r) => r.clientId));

  let billable = 0;
  for (const c of active) {
    // Geen opname gepland deze maand → niets te factureren (0), zodat een klant
    // die deze maand niet draait ook geen omzet op het bord zet.
    const canBill = hasShoot.has(c.id);
    if (canBill) billable++;
    const revenue = canBill ? (Number(c.monthlyRevenue) || 0) : 0;
    const extra = canBill && c.extraRevenue != null ? Number(c.extraRevenue) : 0;
    const editPer = c.editCostPerVideo != null ? Number(c.editCostPerVideo) : 0;
    const editCost = canBill ? editPer * (c.shorts || 0) : 0;

    await db
      .insert(clientFinanceMonths)
      .values({
        clientId: c.id,
        period,
        revenue: revenue.toFixed(2),
        extraRevenue: extra.toFixed(2),
        editCost: editCost.toFixed(2),
        source: "auto",
      })
      .onConflictDoUpdate({
        target: [clientFinanceMonths.clientId, clientFinanceMonths.period],
        // Alleen de automatische velden bijwerken; handmatige kosten blijven.
        set: {
          revenue: revenue.toFixed(2),
          extraRevenue: extra.toFixed(2),
          editCost: editCost.toFixed(2),
          updatedAt: new Date(),
        },
      });
  }

  return { ok: true, period, clients: active.length, billable };
}
