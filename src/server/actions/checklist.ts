"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { checklistChecks } from "@/db/schema";
import { requireInternal, ForbiddenError } from "@/server/auth/context";

export type ActionResult = { ok: boolean; message?: string };

function today(): string {
  // Nederlandse datum, zodat de checklist per NL-kalenderdag loopt.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts; // YYYY-MM-DD
}

/** Een dagelijks checklistonderdeel bevestigen of de bevestiging intrekken. */
export async function toggleChecklistItem(slotKey: string): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    const onDate = today();
    const [existing] = await db
      .select({ id: checklistChecks.id })
      .from(checklistChecks)
      .where(and(eq(checklistChecks.onDate, onDate), eq(checklistChecks.slotKey, slotKey)))
      .limit(1);

    if (existing) {
      await db.delete(checklistChecks).where(eq(checklistChecks.id, existing.id));
    } else {
      await db.insert(checklistChecks).values({ onDate, slotKey, confirmedById: viewer.id }).onConflictDoNothing();
    }
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
