"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { personalNotes, tasks } from "@/db/schema";
import { ForbiddenError, requirePermission, requireViewer } from "@/server/auth/context";

/**
 * Persoonlijke notities ("Maak notitie" op de takenpagina). Elke actie werkt
 * uitsluitend op notities van de ingelogde medewerker: de user-id komt altijd
 * van de sessie, nooit uit de invoer. Een notitie van een collega is dus niet
 * te lezen, te wijzigen of te verwijderen, ook niet met een geraden id.
 */
export type NoteResult = { ok: boolean; message?: string; id?: string };

const noteSchema = z.object({
  title: z.string().trim().min(1, "Geef de notitie een korte titel.").max(160, "Houd de titel kort (max. 160 tekens)."),
  body: z.string().trim().max(5000, "De notitie is te lang (max. 5000 tekens).").nullish(),
});

async function internalViewer() {
  const viewer = await requireViewer();
  if (viewer.isPortalUser) throw new ForbiddenError("Geen toegang.");
  return viewer;
}

function done() {
  revalidatePath("/tasks");
}

export async function createNote(input: { title: string; body?: string | null }): Promise<NoteResult> {
  try {
    const viewer = await internalViewer();
    const parsed = noteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    const [row] = await db
      .insert(personalNotes)
      .values({ userId: viewer.id, title: parsed.data.title, body: parsed.data.body || null })
      .returning({ id: personalNotes.id });
    done();
    return { ok: true, id: row?.id };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function updateNote(id: string, input: { title: string; body?: string | null }): Promise<NoteResult> {
  try {
    const viewer = await internalViewer();
    const parsed = noteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    const res = await db
      .update(personalNotes)
      .set({ title: parsed.data.title, body: parsed.data.body || null, updatedAt: new Date() })
      .where(and(eq(personalNotes.id, id), eq(personalNotes.userId, viewer.id), isNull(personalNotes.deletedAt)))
      .returning({ id: personalNotes.id });
    if (res.length === 0) return { ok: false, message: "Notitie niet gevonden." };
    done();
    return { ok: true, id };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function deleteNote(id: string): Promise<NoteResult> {
  try {
    const viewer = await internalViewer();
    const res = await db
      .update(personalNotes)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(personalNotes.id, id), eq(personalNotes.userId, viewer.id), isNull(personalNotes.deletedAt)))
      .returning({ id: personalNotes.id });
    if (res.length === 0) return { ok: false, message: "Notitie niet gevonden." };
    done();
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/**
 * Notitie omzetten naar een taak voor de medewerker zelf. De notitie blijft
 * bestaan (met een verwijzing naar de taak), zodat er niets verloren gaat.
 */
export async function convertNoteToTask(id: string, input?: { dueOn?: string | null }): Promise<NoteResult> {
  try {
    const viewer = await requirePermission("tasks:write");
    const [note] = await db
      .select({ id: personalNotes.id, title: personalNotes.title, body: personalNotes.body, taskId: personalNotes.taskId })
      .from(personalNotes)
      .where(and(eq(personalNotes.id, id), eq(personalNotes.userId, viewer.id), isNull(personalNotes.deletedAt)))
      .limit(1);
    if (!note) return { ok: false, message: "Notitie niet gevonden." };
    if (note.taskId) return { ok: false, message: "Deze notitie staat al als taak op je lijst." };
    const dueOn = input?.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) ? input.dueOn : null;

    const [task] = await db
      .insert(tasks)
      .values({
        title: note.title.slice(0, 240),
        description: note.body ? note.body.slice(0, 2000) : null,
        assigneeId: viewer.id,
        createdById: viewer.id,
        category: "werkzaamheden",
        status: "todo",
        dueOn,
        entityType: "personal_note",
        entityId: note.id,
      })
      .returning({ id: tasks.id });
    await db.update(personalNotes).set({ taskId: task!.id, updatedAt: new Date() }).where(eq(personalNotes.id, note.id));
    done();
    revalidatePath("/dashboard");
    return { ok: true, id: task!.id };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
