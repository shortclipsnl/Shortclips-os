"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import {
  ForbiddenError,
  hasClientAccess,
  requirePermission,
} from "@/server/auth/context";
import { generateInsights } from "@/server/ai";

export type ActionResult = { ok: boolean; message?: string };

/** Analyses opnieuw draaien voor alle klanten binnen je toegang. */
export async function refreshInsights(clientId?: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai:run");

    const targets = clientId
      ? [{ id: clientId }]
      : await db
          .select({ id: clients.id })
          .from(clients)
          .where(and(isNull(clients.deletedAt), eq(clients.status, "active")));

    let total = 0;
    for (const target of targets) {
      if (!hasClientAccess(viewer, target.id)) continue;
      total += await generateInsights(target.id);
    }

    revalidatePath("/insights");
    return {
      ok: true,
      message:
        total === 0
          ? "Nog te weinig data voor betrouwbare inzichten. Er wordt niets verzonnen."
          : `${total} inzichten bijgewerkt op basis van de huidige cijfers.`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
