"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { salesLeads } from "@/db/schema";
import { requireInternal, ForbiddenError } from "@/server/auth/context";

export type ActionResult = { ok: boolean; message?: string };

function wrap<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message } as ActionResult;
    throw e;
  });
}

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["lead", "offerte", "onderhandeling", "gewonnen", "verloren"]),
});

/** Leadstatus wijzigen — zoals de statuskolom in Monday. */
export async function setLeadStatus(input: z.infer<typeof statusSchema>): Promise<ActionResult> {
  return wrap(async () => {
    await requireInternal();
    const p = statusSchema.safeParse(input);
    if (!p.success) return { ok: false, message: "Ongeldige status." };
    await db.update(salesLeads).set({ status: p.data.status, updatedAt: new Date() }).where(eq(salesLeads.id, p.data.id));
    revalidatePath("/leads");
    return { ok: true };
  });
}

const followUpSchema = z.object({
  id: z.string().uuid(),
  followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

/** Opvolgdatum zetten of wissen. */
export async function setLeadFollowUp(input: z.infer<typeof followUpSchema>): Promise<ActionResult> {
  return wrap(async () => {
    await requireInternal();
    const p = followUpSchema.safeParse(input);
    if (!p.success) return { ok: false, message: "Ongeldige datum." };
    await db.update(salesLeads).set({ followUpOn: p.data.followUpOn, updatedAt: new Date() }).where(eq(salesLeads.id, p.data.id));
    revalidatePath("/leads");
    return { ok: true };
  });
}
