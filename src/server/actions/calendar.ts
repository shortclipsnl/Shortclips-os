"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { contentCalendar } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";

export type ActionResult = { ok: boolean; message?: string; id?: string };

const PLATFORMS = ["instagram", "tiktok", "youtube", "facebook", "linkedin"] as const;
const STATUSES = ["to_prepare", "ready", "scheduled", "published", "failed"] as const;

const itemSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().trim().min(1, "Geef een titel op.").max(240),
  scheduledOn: z.string().min(8, "Kies een publicatiedatum."),
  platforms: z.array(z.enum(PLATFORMS)).default([]),
  status: z.enum(STATUSES).default("scheduled"),
  notes: z.string().trim().max(2000).nullish(),
});

export async function createCalendarItem(input: z.input<typeof itemSchema>): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("calendar:write");
    const parsed = itemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    assertClientAccess(viewer, parsed.data.clientId);

    const [created] = await db
      .insert(contentCalendar)
      .values({
        clientId: parsed.data.clientId,
        title: parsed.data.title,
        scheduledOn: parsed.data.scheduledOn,
        platforms: parsed.data.platforms,
        status: parsed.data.status,
        notes: parsed.data.notes || null,
        ownerId: viewer.id,
      })
      .returning({ id: contentCalendar.id });

    await auditLog({
      viewer,
      action: "calendar.item_created",
      entityType: "calendar_item",
      entityId: created!.id,
      clientId: parsed.data.clientId,
      changes: { title: parsed.data.title, scheduledOn: parsed.data.scheduledOn, status: parsed.data.status },
    });

    revalidatePath("/calendar");
    revalidatePath("/portal/planning");
    return { ok: true, id: created!.id };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  scheduledOn: z.string().min(8).optional(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function updateCalendarItem(
  itemId: string,
  input: z.input<typeof patchSchema>,
): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("calendar:write");
    const parsed = patchSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };

    const [item] = await db
      .select({ id: contentCalendar.id, clientId: contentCalendar.clientId })
      .from(contentCalendar)
      .where(and(eq(contentCalendar.id, itemId), isNull(contentCalendar.deletedAt)))
      .limit(1);
    if (!item) return { ok: false, message: "Publicatie niet gevonden." };
    assertClientAccess(viewer, item.clientId);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.scheduledOn !== undefined) patch.scheduledOn = parsed.data.scheduledOn;
    if (parsed.data.platforms !== undefined) patch.platforms = parsed.data.platforms;
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes || null;

    await db.update(contentCalendar).set(patch).where(eq(contentCalendar.id, itemId));

    await auditLog({
      viewer,
      action: "calendar.item_updated",
      entityType: "calendar_item",
      entityId: itemId,
      clientId: item.clientId,
      changes: parsed.data as Record<string, unknown>,
    });

    revalidatePath("/calendar");
    revalidatePath("/portal/planning");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function deleteCalendarItem(itemId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("calendar:write");
    const [item] = await db
      .select({ id: contentCalendar.id, clientId: contentCalendar.clientId })
      .from(contentCalendar)
      .where(and(eq(contentCalendar.id, itemId), isNull(contentCalendar.deletedAt)))
      .limit(1);
    if (!item) return { ok: false, message: "Publicatie niet gevonden." };
    assertClientAccess(viewer, item.clientId);

    await db.update(contentCalendar).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(contentCalendar.id, itemId));

    await auditLog({ viewer, action: "calendar.item_deleted", entityType: "calendar_item", entityId: itemId, clientId: item.clientId });

    revalidatePath("/calendar");
    revalidatePath("/portal/planning");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
