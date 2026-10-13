"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { calendarCouplings } from "@/db/schema";
import { requireOwner, ForbiddenError } from "@/server/auth/context";
import { AGENDA_COLORS } from "@/server/calendar-couplings";

export type ActionResult = { ok: boolean; message?: string };

function wrap(fn: () => Promise<ActionResult>) {
  return fn().catch((e) => {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message } as ActionResult;
    throw e;
  });
}

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Ongeldige kleur.");

const addSchema = z.object({
  calendarId: z.string().trim().min(1, "Geef een agenda-id op.").max(320),
  label: z.string().trim().max(200).optional(),
  color: colorSchema.optional(),
});

/** Een agenda koppelen (owner-only). */
export async function addCoupling(input: z.infer<typeof addSchema>): Promise<ActionResult> {
  return wrap(async () => {
    await requireOwner();
    const p = addSchema.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0]?.message };

    const existing = await db.select({ id: calendarCouplings.id }).from(calendarCouplings).where(eq(calendarCouplings.calendarId, p.data.calendarId)).limit(1);
    if (existing[0]) return { ok: false, message: "Deze agenda is al gekoppeld." };

    // Volgende kleur die nog niet in gebruik is, zodat agenda's standaard verschillen.
    const used = new Set((await db.select({ color: calendarCouplings.color }).from(calendarCouplings)).map((r) => r.color.toLowerCase()));
    const color = p.data.color ?? AGENDA_COLORS.find((c) => !used.has(c.toLowerCase())) ?? AGENDA_COLORS[0];

    await db.insert(calendarCouplings).values({
      calendarId: p.data.calendarId,
      label: p.data.label || null,
      color,
    });
    revalidatePath("/settings/agendas");
    return { ok: true };
  });
}

const updateSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().max(200).nullable().optional(),
  color: colorSchema.optional(),
  enabled: z.boolean().optional(),
});

/** Label, kleur of aan/uit van een gekoppelde agenda wijzigen (owner-only). */
export async function updateCoupling(input: z.infer<typeof updateSchema>): Promise<ActionResult> {
  return wrap(async () => {
    await requireOwner();
    const p = updateSchema.safeParse(input);
    if (!p.success) return { ok: false, message: "Ongeldige invoer." };
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (p.data.label !== undefined) patch.label = p.data.label || null;
    if (p.data.color !== undefined) patch.color = p.data.color;
    if (p.data.enabled !== undefined) patch.enabled = p.data.enabled;
    await db.update(calendarCouplings).set(patch).where(eq(calendarCouplings.id, p.data.id));
    revalidatePath("/settings/agendas");
    return { ok: true };
  });
}

/** Een agenda ontkoppelen (owner-only). Reeds gesyncte afspraken blijven staan. */
export async function removeCoupling(id: string): Promise<ActionResult> {
  return wrap(async () => {
    await requireOwner();
    await db.delete(calendarCouplings).where(eq(calendarCouplings.id, id));
    revalidatePath("/settings/agendas");
    return { ok: true };
  });
}
