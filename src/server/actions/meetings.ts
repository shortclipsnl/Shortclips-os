"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { meetingItems, tasks, teamMeetings } from "@/db/schema";
import { requireInternal, ForbiddenError } from "@/server/auth/context";
import { notify } from "@/server/notifications";

export type ActionResult = { ok: boolean; message?: string; id?: string };

const meetingSchema = z.object({
  title: z.string().trim().min(1, "Geef de meeting een titel.").max(200),
  scheduledAt: z.string().min(10, "Kies datum en tijd."),
  location: z.string().trim().max(160).optional(),
  participantIds: z.array(z.string().uuid()).default([]),
});

export async function createMeeting(input: z.input<typeof meetingSchema>): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    const parsed = meetingSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    const [created] = await db
      .insert(teamMeetings)
      .values({
        title: parsed.data.title,
        scheduledAt: new Date(parsed.data.scheduledAt),
        location: parsed.data.location || null,
        participantIds: parsed.data.participantIds,
        createdById: viewer.id,
      })
      .returning({ id: teamMeetings.id });
    revalidatePath("/meetings");
    return { ok: true, id: created!.id };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function deleteMeeting(id: string): Promise<ActionResult> {
  try {
    await requireInternal();
    await db.delete(teamMeetings).where(eq(teamMeetings.id, id));
    revalidatePath("/meetings");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const itemSchema = z.object({
  meetingId: z.string().uuid(),
  kind: z.enum(["agenda", "decision", "action"]).default("agenda"),
  body: z.string().trim().min(1, "Vul een tekst in.").max(1000),
  assigneeId: z.string().uuid().nullish(),
  dueOn: z.string().nullish(),
});

export async function addMeetingItem(input: z.input<typeof itemSchema>): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    const parsed = itemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    await db.insert(meetingItems).values({
      meetingId: parsed.data.meetingId,
      kind: parsed.data.kind,
      body: parsed.data.body,
      assigneeId: parsed.data.assigneeId ?? null,
      dueOn: parsed.data.dueOn || null,
      createdById: viewer.id,
    });
    revalidatePath(`/meetings/${parsed.data.meetingId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function toggleMeetingItem(id: string): Promise<ActionResult> {
  try {
    await requireInternal();
    const [item] = await db.select({ isDone: meetingItems.isDone, meetingId: meetingItems.meetingId }).from(meetingItems).where(eq(meetingItems.id, id)).limit(1);
    if (!item) return { ok: false, message: "Niet gevonden." };
    await db.update(meetingItems).set({ isDone: !item.isDone, updatedAt: new Date() }).where(eq(meetingItems.id, id));
    revalidatePath(`/meetings/${item.meetingId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function deleteMeetingItem(id: string): Promise<ActionResult> {
  try {
    await requireInternal();
    const [item] = await db.select({ meetingId: meetingItems.meetingId }).from(meetingItems).where(eq(meetingItems.id, id)).limit(1);
    await db.delete(meetingItems).where(eq(meetingItems.id, id));
    if (item) revalidatePath(`/meetings/${item.meetingId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Maakt van een actiepunt een taak in het Taken-overzicht en koppelt die. */
export async function actionItemToTask(id: string): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    const [item] = await db
      .select({ id: meetingItems.id, meetingId: meetingItems.meetingId, body: meetingItems.body, assigneeId: meetingItems.assigneeId, dueOn: meetingItems.dueOn, taskId: meetingItems.taskId })
      .from(meetingItems)
      .where(eq(meetingItems.id, id))
      .limit(1);
    if (!item) return { ok: false, message: "Actiepunt niet gevonden." };
    if (item.taskId) return { ok: false, message: "Er is al een taak gekoppeld." };

    const [task] = await db
      .insert(tasks)
      .values({ title: item.body.slice(0, 240), assigneeId: item.assigneeId ?? null, dueOn: item.dueOn || null, status: "todo", createdById: viewer.id })
      .returning({ id: tasks.id });
    await db.update(meetingItems).set({ taskId: task!.id, updatedAt: new Date() }).where(eq(meetingItems.id, id));

    if (item.assigneeId && item.assigneeId !== viewer.id) {
      await notify({
        userIds: [item.assigneeId],
        type: "task_assigned",
        level: "info",
        title: `Taak uit teammeeting van ${viewer.fullName}`,
        body: item.body.slice(0, 200),
        href: `/tasks?persoon=${item.assigneeId}`,
        entityType: "task",
        entityId: task!.id,
        dedupeKey: `meeting_task:${task!.id}`,
      });
    }

    revalidatePath(`/meetings/${item.meetingId}`);
    revalidatePath("/tasks");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
