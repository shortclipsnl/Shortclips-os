"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requireInternal } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { addItem, cancelMeeting, deleteItem, planMeeting, saveReport, saveTopics, setActionDone, setEditorOwner, setPointStatus, updateItem } from "@/server/editor-meetings";
import { ITEM_OUTCOMES, MAX_ITEM_LENGTH, OWNER_TYPES, POINT_KINDS } from "@/lib/editor-meetings";

export type ActionResult = { ok: boolean; message?: string; id?: string };

/** Eén plek voor foutafhandeling: rechtenfouten worden een nette melding. */
async function run(work: () => Promise<Partial<ActionResult> | void>): Promise<ActionResult> {
  try {
    const res = await work();
    revalidatePath("/editor-meetings", "layout");
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    return { ok: true, ...(res ?? {}) };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const planSchema = z.object({
  meetingId: z.string().uuid().nullish(),
  editorId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Kies een datum."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Kies een tijd."),
  durationMinutes: z.number().int().min(10).max(240).optional(),
  location: z.string().max(160).nullish(),
  meetingUrl: z.string().max(500).nullish(),
  topics: z.array(z.string().max(300)).max(20).optional(),
});

export async function planEditorMeeting(input: z.input<typeof planSchema>): Promise<ActionResult> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
  return run(async () => {
    const viewer = await requireInternal();
    const { id } = await planMeeting(viewer, parsed.data);
    await auditLog({ viewer, action: "editor_meeting.planned", entityType: "editor_meeting", entityId: id, changes: { datum: parsed.data.date, tijd: parsed.data.time } });
    return { id };
  });
}

export async function cancelEditorMeeting(meetingId: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(meetingId).success) return { ok: false, message: "Meeting niet gevonden." };
  return run(async () => {
    const viewer = await requireInternal();
    await cancelMeeting(viewer, meetingId);
    await auditLog({ viewer, action: "editor_meeting.cancelled", entityType: "editor_meeting", entityId: meetingId });
  });
}

export async function saveEditorMeetingTopics(meetingId: string, topics: string[]): Promise<ActionResult> {
  const parsed = z.object({ id: z.string().uuid(), topics: z.array(z.string().max(300)).max(20) }).safeParse({ id: meetingId, topics });
  if (!parsed.success) return { ok: false, message: "Controleer de bespreekpunten." };
  return run(async () => {
    const viewer = await requireInternal();
    await saveTopics(viewer, parsed.data.id, parsed.data.topics);
  });
}

const reportSchema = z.object({
  insights: z.string().max(4000).default(""),
  focusNext: z.string().max(4000).default(""),
  internalNotes: z.string().max(6000).default(""),
  points: z
    .array(z.object({ id: z.string().uuid().nullish(), kind: z.enum(POINT_KINDS), theme: z.string().max(24), body: z.string().max(2000), example: z.string().max(2000).nullish() }))
    .max(60),
  actions: z
    .array(z.object({ id: z.string().uuid().nullish(), body: z.string().max(1000), ownerType: z.enum(OWNER_TYPES), assigneeId: z.string().uuid().nullish(), dueOn: z.string().nullish() }))
    .max(40),
  next: z.object({ date: z.string(), time: z.string(), topics: z.array(z.string().max(300)).max(20) }).nullish(),
  items: z.array(z.object({ id: z.string().uuid(), outcome: z.enum(ITEM_OUTCOMES).nullable() })).max(60).optional(),
});

export async function saveEditorMeetingReport(meetingId: string, input: z.input<typeof reportSchema>, publish: boolean): Promise<ActionResult & { published?: boolean }> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success || !z.string().uuid().safeParse(meetingId).success) return { ok: false, message: "Controleer het verslag: een veld is te lang of ongeldig." };
  return run(async () => {
    const viewer = await requireInternal();
    const res = await saveReport(viewer, meetingId, parsed.data, publish);
    if (publish) await auditLog({ viewer, action: "editor_meeting.report_published", entityType: "editor_meeting", entityId: meetingId });
    return { published: res.published } as Partial<ActionResult>;
  });
}

export async function setEditorMeetingPoint(pointId: string, status: "open" | "behaald"): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(pointId).success || (status !== "open" && status !== "behaald")) return { ok: false, message: "Punt niet gevonden." };
  return run(async () => {
    const viewer = await requireInternal();
    await setPointStatus(viewer, pointId, status);
  });
}

export async function setEditorMeetingAction(actionId: string, done: boolean): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(actionId).success) return { ok: false, message: "Actiepunt niet gevonden." };
  return run(async () => {
    const viewer = await requireInternal();
    await setActionDone(viewer, actionId, done);
  });
}

export async function setEditorMeetingOwner(editorId: string, ownerId: string): Promise<ActionResult> {
  const parsed = z.object({ editorId: z.string().uuid(), ownerId: z.string().uuid() }).safeParse({ editorId, ownerId });
  if (!parsed.success) return { ok: false, message: "Kies een verantwoordelijke." };
  return run(async () => {
    const viewer = await requireInternal();
    await setEditorOwner(viewer, parsed.data.editorId, parsed.data.ownerId);
    await auditLog({ viewer, action: "editor_meeting.owner_set", entityType: "user", entityId: parsed.data.editorId, changes: { verantwoordelijke: parsed.data.ownerId } });
  });
}

/* ------------------- eigen bespreekpunten van de editor ------------------- */

const itemText = z.string().trim().min(1, "Vul een bespreekpunt in.").max(MAX_ITEM_LENGTH, `Houd het kort: maximaal ${MAX_ITEM_LENGTH} tekens.`);

export async function addEditorMeetingItem(body: string): Promise<ActionResult> {
  const parsed = itemText.safeParse(body);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
  return run(async () => {
    const viewer = await requireInternal();
    return await addItem(viewer, parsed.data);
  });
}

export async function updateEditorMeetingItem(itemId: string, body: string): Promise<ActionResult> {
  const parsed = itemText.safeParse(body);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
  if (!z.string().uuid().safeParse(itemId).success) return { ok: false, message: "Bespreekpunt niet gevonden." };
  return run(async () => {
    const viewer = await requireInternal();
    await updateItem(viewer, itemId, parsed.data);
  });
}

export async function deleteEditorMeetingItem(itemId: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(itemId).success) return { ok: false, message: "Bespreekpunt niet gevonden." };
  return run(async () => {
    const viewer = await requireInternal();
    await deleteItem(viewer, itemId);
  });
}
