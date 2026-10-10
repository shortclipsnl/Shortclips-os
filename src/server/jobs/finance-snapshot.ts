import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientFinanceMonths, clients } from "@/db/schema";

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/**
 * Maakt (of werkt bij) de maandstaat van de huidige maand voor elke actieve
 * klant: de omzet-, meerwerk- en editkostenvelden worden automatisch uit Monday
 * gevuld. Handmatige directe kosten (opname, strategie, overig) blijven staan —
 * die worden hier nooit overschreven. Idempotent.
 */
export async function snapshotFinanceMonth(period = currentPeriod()): Promise<{ ok: boolean; period: string; clients: number }> {
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

  for (const c of active) {
    const revenue = Number(c.monthlyRevenue) || 0;
    const extra = c.extraRevenue != null ? Number(c.extraRevenue) : 0;
    const editPer = c.editCostPerVideo != null ? Number(c.editCostPerVideo) : 0;
    const editCost = editPer * (c.shorts || 0);

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

  return { ok: true, period, clients: active.length };
}
