"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { companyFinanceMonths, fixedCosts, salesLeads } from "@/db/schema";
import { requirePermission, ForbiddenError } from "@/server/auth/context";

export type ActionResult = { ok: boolean; message?: string };

async function owner() {
  return requirePermission("finance:write");
}
function wrap<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message } as ActionResult;
    throw e;
  });
}

/* --- Bedrijfsmaand (doel + kostencategorieën) --- */
const monthSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  revenueTarget: z.coerce.number().min(0).default(0),
  freelanceCost: z.coerce.number().min(0).default(0),
  staffCost: z.coerce.number().min(0).default(0),
  otherCost: z.coerce.number().min(0).default(0),
});
export async function upsertCompanyMonth(input: z.input<typeof monthSchema>): Promise<ActionResult> {
  return wrap(async () => {
    const viewer = await owner();
    const p = monthSchema.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0]?.message };
    const v = p.data;
    await db.insert(companyFinanceMonths).values({
      period: v.period, revenueTarget: v.revenueTarget.toFixed(2), freelanceCost: v.freelanceCost.toFixed(2),
      staffCost: v.staffCost.toFixed(2), otherCost: v.otherCost.toFixed(2), updatedById: viewer.id,
    }).onConflictDoUpdate({
      target: companyFinanceMonths.period,
      set: { revenueTarget: v.revenueTarget.toFixed(2), freelanceCost: v.freelanceCost.toFixed(2), staffCost: v.staffCost.toFixed(2), otherCost: v.otherCost.toFixed(2), updatedById: viewer.id, updatedAt: new Date() },
    });
    revalidatePath("/financien");
    return { ok: true };
  });
}

/* --- Vaste lasten --- */
const fixedSchema = z.object({
  id: z.string().uuid().optional(),
  category: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  monthlyAmount: z.coerce.number().min(0),
  isActive: z.boolean().default(true),
});
export async function upsertFixedCost(input: z.input<typeof fixedSchema>): Promise<ActionResult> {
  return wrap(async () => {
    await owner();
    const p = fixedSchema.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0]?.message };
    const v = p.data;
    if (v.id) {
      await db.update(fixedCosts).set({ category: v.category, name: v.name, monthlyAmount: v.monthlyAmount.toFixed(2), isActive: v.isActive, updatedAt: new Date() }).where(eq(fixedCosts.id, v.id));
    } else {
      await db.insert(fixedCosts).values({ category: v.category, name: v.name, monthlyAmount: v.monthlyAmount.toFixed(2), isActive: v.isActive });
    }
    revalidatePath("/financien");
    return { ok: true };
  });
}
export async function deleteFixedCost(id: string): Promise<ActionResult> {
  return wrap(async () => {
    await owner();
    await db.update(fixedCosts).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(fixedCosts.id, id));
    revalidatePath("/financien");
    return { ok: true };
  });
}

/* --- Offertes / pipeline --- */
const leadSchema = z.object({
  id: z.string().uuid().optional(),
  company: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(160).optional(),
  expectedMonthly: z.coerce.number().min(0).default(0),
  expectedValue: z.coerce.number().min(0).default(0),
  startOn: z.string().optional(),
  status: z.enum(["lead", "offerte", "onderhandeling", "gewonnen", "verloren"]).default("lead"),
  note: z.string().trim().max(500).optional(),
});
export async function upsertSalesLead(input: z.input<typeof leadSchema>): Promise<ActionResult> {
  return wrap(async () => {
    const viewer = await owner();
    const p = leadSchema.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0]?.message };
    const v = p.data;
    const vals = { company: v.company, contactName: v.contactName || null, expectedMonthly: v.expectedMonthly.toFixed(2), expectedValue: v.expectedValue.toFixed(2), startOn: v.startOn || null, status: v.status, note: v.note || null };
    if (v.id) {
      await db.update(salesLeads).set({ ...vals, updatedAt: new Date() }).where(eq(salesLeads.id, v.id));
    } else {
      await db.insert(salesLeads).values({ ...vals, ownerId: viewer.id });
    }
    revalidatePath("/financien");
    return { ok: true };
  });
}
export async function deleteSalesLead(id: string): Promise<ActionResult> {
  return wrap(async () => {
    await owner();
    await db.update(salesLeads).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(salesLeads.id, id));
    revalidatePath("/financien");
    return { ok: true };
  });
}
