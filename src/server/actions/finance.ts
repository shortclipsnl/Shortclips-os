"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clientFinanceMonths, clients } from "@/db/schema";
import { assertClientAccess, requirePermission, ForbiddenError } from "@/server/auth/context";
import { auditLog } from "@/server/audit";

export type ActionResult = { ok: boolean; message?: string };

const schema = z.object({
  clientId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}$/, "Ongeldige maand."),
  shootCost: z.coerce.number().min(0).default(0),
  strategyCost: z.coerce.number().min(0).default(0),
  otherCost: z.coerce.number().min(0).default(0),
  note: z.string().trim().max(500).optional(),
});

/** Handmatige directe kosten van een klantmaand bijwerken (opname/strategie/overig).
 *  Maakt de maandrij aan met een auto-snapshot als die nog niet bestaat. */
export async function upsertFinanceMonth(input: z.input<typeof schema>): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("finance:write");
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    assertClientAccess(viewer, parsed.data.clientId);
    const { clientId, period, shootCost, strategyCost, otherCost, note } = parsed.data;

    const [existing] = await db
      .select({ id: clientFinanceMonths.id })
      .from(clientFinanceMonths)
      .where(and(eq(clientFinanceMonths.clientId, clientId), eq(clientFinanceMonths.period, period)))
      .limit(1);

    if (existing) {
      await db
        .update(clientFinanceMonths)
        .set({
          shootCost: shootCost.toFixed(2),
          strategyCost: strategyCost.toFixed(2),
          otherCost: otherCost.toFixed(2),
          note: note || null,
          source: "manual",
          updatedById: viewer.id,
          updatedAt: new Date(),
        })
        .where(eq(clientFinanceMonths.id, existing.id));
    } else {
      // Nog geen rij: auto-velden uit de klant snapshotten.
      const [c] = await db
        .select({ revenue: clients.monthlyRevenue, extra: clients.extraRevenue, editPer: clients.editCostPerVideo, shorts: clients.monthlyVideoQuota })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      const revenue = Number(c?.revenue ?? 0);
      const extra = c?.extra != null ? Number(c.extra) : 0;
      const editCost = (c?.editPer != null ? Number(c.editPer) : 0) * (c?.shorts ?? 0);
      await db.insert(clientFinanceMonths).values({
        clientId,
        period,
        revenue: revenue.toFixed(2),
        extraRevenue: extra.toFixed(2),
        editCost: editCost.toFixed(2),
        shootCost: shootCost.toFixed(2),
        strategyCost: strategyCost.toFixed(2),
        otherCost: otherCost.toFixed(2),
        note: note || null,
        source: "manual",
        updatedById: viewer.id,
      });
    }

    await auditLog({ viewer, action: "finance.month_updated", entityType: "client", entityId: clientId, clientId, changes: { period, shootCost, strategyCost, otherCost } });
    revalidatePath(`/clients`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
