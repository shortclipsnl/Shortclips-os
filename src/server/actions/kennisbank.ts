"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { kbChapters, kbCourses, kbLessonRevisions, kbLessons, kbProgress, type KbDoc } from "@/db/schema";
import { ForbiddenError, requireAuthorKennisbank, requireInternal } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { canSeeCourse, searchKennisbank, type KbSearchHit } from "@/server/kennisbank";
import { docToPlainText, type PMDoc } from "@/lib/kennisbank-doc";
import { runJsonPrompt } from "@/server/ai/client";
import { centralKnowledgeText } from "@/server/ai/knowledge";

/**
 * Beheeracties van de Shortclips Kennisbank.
 *
 * Elke schrijfactie begint met `requireAuthorKennisbank()`: de eigenaar én
 * projectcoördinatoren (Jarno, Milou, Jiska, Tim …) mogen de kennisbank
 * wijzigen. Dat geldt ook voor directe aanroepen buiten de interface om — een
 * server action is gewoon een POST-verzoek, dus de controle zit hier en niet in
 * het verbergen van knoppen.
 *
 * Uitzondering: voortgang (les afronden) mag iedere interne gebruiker, en
 * uitsluitend voor zichzelf.
 */

export type KbActionResult = { ok: boolean; message?: string; id?: string };

const uuid = z.string().uuid();

async function guard<T>(fn: () => Promise<T>): Promise<T | KbActionResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? "Ongeldige invoer." };
    throw error;
  }
}

function revalidateKb(courseId?: string) {
  revalidatePath("/kennisbank");
  if (courseId) revalidatePath(`/kennisbank/${courseId}`);
}

/* ----------------------------- Voortgang ----------------------------- */

/** Zoeken vanuit de kennisbank-zoekbalk: lestitels én lesinhoud, afgeschermd op
 *  toegang. Herbruikt de bestaande searchKennisbank-logica. */
export async function searchKennisbankLessons(query: string): Promise<KbSearchHit[]> {
  const viewer = await requireInternal();
  return searchKennisbank(viewer, query, 10);
}

export async function setLessonCompleted(lessonId: string, completed: boolean): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireInternal();
    uuid.parse(lessonId);
    const [row] = await db
      .select({ courseId: kbLessons.courseId, isPublished: kbLessons.isPublished, c: kbCourses })
      .from(kbLessons)
      .innerJoin(kbCourses, eq(kbCourses.id, kbLessons.courseId))
      .where(and(eq(kbLessons.id, lessonId), isNull(kbLessons.deletedAt)))
      .limit(1);
    if (!row || !canSeeCourse(viewer, row.c)) return { ok: false, message: "Les niet gevonden." };
    if (completed) {
      await db.insert(kbProgress).values({ userId: viewer.id, lessonId, source: "user" }).onConflictDoNothing();
    } else {
      await db.delete(kbProgress).where(and(eq(kbProgress.userId, viewer.id), eq(kbProgress.lessonId, lessonId)));
    }
    revalidateKb(row.courseId);
    return { ok: true };
  }) as Promise<KbActionResult>;
}

/* ------------------------------ Cursussen ----------------------------- */

const courseSchema = z.object({
  title: z.string().trim().min(1, "Geef de cursus een titel.").max(300),
  description: z.string().max(5000).default(""),
  coverAssetId: uuid.nullable().optional(),
  isRestricted: z.boolean().default(false),
  allowedRoles: z.array(z.string().max(40)).max(20).default([]),
  isPublished: z.boolean().default(true),
});

export async function createCourse(input: z.input<typeof courseSchema>): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireAuthorKennisbank();
    const data = courseSchema.parse(input);
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${kbCourses.sortOrder}), 0)::int` }).from(kbCourses).where(isNull(kbCourses.deletedAt));
    const [created] = await db
      .insert(kbCourses)
      .values({ ...data, coverAssetId: data.coverAssetId ?? null, sortOrder: max + 10, updatedById: viewer.id })
      .returning({ id: kbCourses.id });
    await auditLog({ viewer, action: "kennisbank.course.create", entityType: "kb_course", entityId: created!.id });
    revalidateKb();
    return { ok: true, id: created!.id, message: "Cursus aangemaakt." };
  }) as Promise<KbActionResult>;
}

export async function updateCourse(courseId: string, input: z.input<typeof courseSchema>): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireAuthorKennisbank();
    uuid.parse(courseId);
    const data = courseSchema.parse(input);
    await db
      .update(kbCourses)
      .set({ ...data, coverAssetId: data.coverAssetId ?? null, updatedById: viewer.id, updatedAt: new Date() })
      .where(eq(kbCourses.id, courseId));
    await auditLog({ viewer, action: "kennisbank.course.update", entityType: "kb_course", entityId: courseId });
    revalidateKb(courseId);
    return { ok: true, message: "Cursus opgeslagen." };
  }) as Promise<KbActionResult>;
}

export async function deleteCourse(courseId: string): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireAuthorKennisbank();
    uuid.parse(courseId);
    // Soft delete: herstelbaar, niets wordt definitief gewist.
    await db.update(kbCourses).set({ deletedAt: new Date(), updatedById: viewer.id }).where(eq(kbCourses.id, courseId));
    await auditLog({ viewer, action: "kennisbank.course.delete", entityType: "kb_course", entityId: courseId });
    revalidateKb();
    return { ok: true, message: "Cursus verwijderd." };
  }) as Promise<KbActionResult>;
}

/** Cursus één plek omhoog (-1) of omlaag (+1). */
export async function moveCourse(courseId: string, direction: -1 | 1): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireAuthorKennisbank();
    uuid.parse(courseId);
    const rows = await db.select({ id: kbCourses.id }).from(kbCourses).where(isNull(kbCourses.deletedAt)).orderBy(asc(kbCourses.sortOrder), asc(kbCourses.createdAt));
    const ids = rows.map((r) => r.id);
    const i = ids.indexOf(courseId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= ids.length) return { ok: true };
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await db.transaction(async (tx) => {
      for (const [k, id] of ids.entries()) await tx.update(kbCourses).set({ sortOrder: (k + 1) * 10 }).where(eq(kbCourses.id, id));
    });
    await auditLog({ viewer, action: "kennisbank.course.move", entityType: "kb_course", entityId: courseId });
    revalidateKb();
    return { ok: true };
  }) as Promise<KbActionResult>;
}

/* ----------------------------- Hoofdstukken ---------------------------- */

/** Volgorde van de bovenste laag van een cursus: hoofdstukken + losse lessen. */
async function topLevel(courseId: string) {
  const [chs, ls] = await Promise.all([
    db.select({ id: kbChapters.id, sortOrder: kbChapters.sortOrder }).from(kbChapters).where(and(eq(kbChapters.courseId, courseId), isNull(kbChapters.deletedAt))),
    db.select({ id: kbLessons.id, sortOrder: kbLessons.sortOrder }).from(kbLessons).where(and(eq(kbLessons.courseId, courseId), isNull(kbLessons.chapterId), isNull(kbLessons.deletedAt))),
  ]);
  return [...chs.map((c) => ({ ...c, kind: "chapter" as const })), ...ls.map((l) => ({ ...l, kind: "lesson" as const }))].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function createChapter(courseId: string, title: string): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireAuthorKennisbank();
    uuid.parse(courseId);
    const t = z.string().trim().min(1, "Geef het hoofdstuk een naam.").max(300).parse(title);
    const top = await topLevel(courseId);
    const sortOrder = (top.at(-1)?.sortOrder ?? 0) + 10;
    const [created] = await db.insert(kbChapters).values({ courseId, title: t, sortOrder, updatedById: viewer.id }).returning({ id: kbChapters.id });
    await auditLog({ viewer, action: "kennisbank.chapter.create", entityType: "kb_chapter", entityId: created!.id });
    revalidateKb(courseId);
    return { ok: true, id: created!.id };
  }) as Promise<KbActionResult>;
}

export async function renameChapter(chapterId: string, title: string): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireAuthorKennisbank();
    uuid.parse(chapterId);
    const t = z.string().trim().min(1, "Geef het hoofdstuk een naam.").max(300).parse(title);
    const [row] = await db.update(kbChapters).set({ title: t, updatedById: viewer.id, updatedAt: new Date() }).where(eq(kbChapters.id, chapterId)).returning({ courseId: kbChapters.courseId });
    await auditLog({ viewer, action: "kennisbank.chapter.update", entityType: "kb_chapter", entityId: chapterId });
    revalidateKb(row?.courseId);
    return { ok: true };
  }) as Promise<KbActionResult>;
}

export async function deleteChapter(chapterId: string): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireAuthorKennisbank();
    uuid.parse(chapterId);
    const now = new Date();
    const [row] = await db.update(kbChapters).set({ deletedAt: now, updatedById: viewer.id }).where(eq(kbChapters.id, chapterId)).returning({ courseId: kbChapters.courseId });
    await db.update(kbLessons).set({ deletedAt: now, updatedById: viewer.id }).where(and(eq(kbLessons.chapterId, chapterId), isNull(kbLessons.deletedAt)));
    await auditLog({ viewer, action: "kennisbank.chapter.delete", entityType: "kb_chapter", entityId: chapterId });
    revalidateKb(row?.courseId);
    return { ok: true, message: "Hoofdstuk verwijderd." };
  }) as Promise<KbActionResult>;
}

/** Hoofdstuk (of losse les op cursusniveau) een plek omhoog/omlaag. */
export async function moveTopLevel(courseId: string, itemId: string, direction: -1 | 1): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireAuthorKennisbank();
    uuid.parse(courseId);
    uuid.parse(itemId);
    const top = await topLevel(courseId);
    const i = top.findIndex((t) => t.id === itemId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= top.length) return { ok: true };
    [top[i], top[j]] = [top[j]!, top[i]!];
    await db.transaction(async (tx) => {
      for (const [k, item] of top.entries()) {
        if (item.kind === "chapter") await tx.update(kbChapters).set({ sortOrder: (k + 1) * 10 }).where(eq(kbChapters.id, item.id));
        else await tx.update(kbLessons).set({ sortOrder: (k + 1) * 10 }).where(eq(kbLessons.id, item.id));
      }
    });
    await auditLog({ viewer, action: "kennisbank.order.update", entityType: "kb_course", entityId: courseId });
    revalidateKb(courseId);
    return { ok: true };
  }) as Promise<KbActionResult>;
}

/* -------------------------------- Lessen ------------------------------- */

export async function createLesson(courseId: string, chapterId: string | null, title: string): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireAuthorKennisbank();
    uuid.parse(courseId);
    if (chapterId) uuid.parse(chapterId);
    const t = z.string().trim().min(1, "Geef de les een titel.").max(300).parse(title);
    let sortOrder: number;
    if (chapterId) {
      const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${kbLessons.sortOrder}), 0)::int` }).from(kbLessons).where(and(eq(kbLessons.chapterId, chapterId), isNull(kbLessons.deletedAt)));
      sortOrder = max + 10;
    } else {
      sortOrder = ((await topLevel(courseId)).at(-1)?.sortOrder ?? 0) + 10;
    }
    // Nieuwe lessen starten als concept: pas zichtbaar voor het team na publiceren.
    const [created] = await db
      .insert(kbLessons)
      .values({ courseId, chapterId, title: t, sortOrder, isPublished: false, updatedById: viewer.id })
      .returning({ id: kbLessons.id });
    await auditLog({ viewer, action: "kennisbank.lesson.create", entityType: "kb_lesson", entityId: created!.id });
    revalidateKb(courseId);
    return { ok: true, id: created!.id };
  }) as Promise<KbActionResult>;
}

const resourceSchema = z.object({
  title: z.string().trim().min(1).max(300),
  assetId: uuid.nullable().optional(),
  url: z.string().url().max(2000).nullable().optional(),
  fileName: z.string().max(400).nullable().optional(),
  contentType: z.string().max(160).nullable().optional(),
  skoolFileId: z.string().max(64).nullable().optional(),
});

const lessonSchema = z.object({
  title: z.string().trim().min(1, "Geef de les een titel.").max(300),
  content: z.object({ type: z.literal("doc"), content: z.array(z.any()).optional() }).passthrough(),
  videoUrl: z.string().trim().url("Vul een geldige video-URL in.").max(2000).nullable().optional().or(z.literal("")),
  resources: z.array(resourceSchema).max(100).default([]),
  isPublished: z.boolean(),
});

/**
 * Les opslaan. De vorige versie wordt eerst als revisie bewaard, zodat een
 * wijziging altijd terug te draaien is.
 */
export async function saveLesson(lessonId: string, input: z.input<typeof lessonSchema>): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireAuthorKennisbank();
    uuid.parse(lessonId);
    const data = lessonSchema.parse(input);
    const json = JSON.stringify(data.content);
    if (json.length > 3_000_000) return { ok: false, message: "De les is te groot om op te slaan." };

    const [current] = await db.select().from(kbLessons).where(eq(kbLessons.id, lessonId)).limit(1);
    if (!current || current.deletedAt) return { ok: false, message: "Les niet gevonden." };

    await db.transaction(async (tx) => {
      await tx.insert(kbLessonRevisions).values({
        lessonId,
        title: current.title,
        content: current.content,
        videoUrl: current.videoUrl,
        resources: current.resources ?? [],
        editedById: viewer.id,
        note: "Versie vóór wijziging",
      });
      await tx
        .update(kbLessons)
        .set({
          title: data.title,
          content: data.content as KbDoc,
          contentText: docToPlainText(data.content as unknown as PMDoc),
          videoUrl: data.videoUrl ? data.videoUrl : null,
          resources: data.resources.map((r) => ({ ...r, assetId: r.assetId ?? null, url: r.url ?? null })),
          isPublished: data.isPublished,
          updatedById: viewer.id,
          updatedAt: new Date(),
        })
        .where(eq(kbLessons.id, lessonId));
    });
    await auditLog({ viewer, action: "kennisbank.lesson.update", entityType: "kb_lesson", entityId: lessonId });
    revalidateKb(current.courseId);
    return { ok: true, message: data.isPublished ? "Opgeslagen en gepubliceerd." : "Opgeslagen als concept." };
  }) as Promise<KbActionResult>;
}

export async function deleteLesson(lessonId: string): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireAuthorKennisbank();
    uuid.parse(lessonId);
    const [row] = await db.update(kbLessons).set({ deletedAt: new Date(), updatedById: viewer.id }).where(eq(kbLessons.id, lessonId)).returning({ courseId: kbLessons.courseId });
    await auditLog({ viewer, action: "kennisbank.lesson.delete", entityType: "kb_lesson", entityId: lessonId });
    revalidateKb(row?.courseId);
    return { ok: true, message: "Les verwijderd." };
  }) as Promise<KbActionResult>;
}

/** Les binnen een hoofdstuk omhoog/omlaag, of naar een ander hoofdstuk verplaatsen. */
export async function moveLesson(lessonId: string, move: { direction?: -1 | 1; toChapterId?: string | null }): Promise<KbActionResult> {
  return guard(async () => {
    const viewer = await requireAuthorKennisbank();
    uuid.parse(lessonId);
    const [lesson] = await db.select().from(kbLessons).where(eq(kbLessons.id, lessonId)).limit(1);
    if (!lesson) return { ok: false, message: "Les niet gevonden." };

    if (move.toChapterId !== undefined) {
      if (move.toChapterId) {
        uuid.parse(move.toChapterId);
        const [ch] = await db.select({ courseId: kbChapters.courseId }).from(kbChapters).where(eq(kbChapters.id, move.toChapterId)).limit(1);
        if (!ch || ch.courseId !== lesson.courseId) return { ok: false, message: "Hoofdstuk hoort niet bij deze cursus." };
        const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${kbLessons.sortOrder}), 0)::int` }).from(kbLessons).where(and(eq(kbLessons.chapterId, move.toChapterId), isNull(kbLessons.deletedAt)));
        await db.update(kbLessons).set({ chapterId: move.toChapterId, sortOrder: max + 10, updatedById: viewer.id }).where(eq(kbLessons.id, lessonId));
      } else {
        const sortOrder = ((await topLevel(lesson.courseId)).at(-1)?.sortOrder ?? 0) + 10;
        await db.update(kbLessons).set({ chapterId: null, sortOrder, updatedById: viewer.id }).where(eq(kbLessons.id, lessonId));
      }
    } else if (move.direction) {
      if (!lesson.chapterId) return moveTopLevel(lesson.courseId, lessonId, move.direction);
      const siblings = await db
        .select({ id: kbLessons.id })
        .from(kbLessons)
        .where(and(eq(kbLessons.chapterId, lesson.chapterId), isNull(kbLessons.deletedAt)))
        .orderBy(asc(kbLessons.sortOrder), asc(kbLessons.createdAt));
      const ids = siblings.map((s) => s.id);
      const i = ids.indexOf(lessonId);
      const j = i + move.direction;
      if (j < 0 || j >= ids.length) return { ok: true };
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      await db.transaction(async (tx) => {
        for (const [k, id] of ids.entries()) await tx.update(kbLessons).set({ sortOrder: (k + 1) * 10 }).where(eq(kbLessons.id, id));
      });
    }
    await auditLog({ viewer, action: "kennisbank.lesson.move", entityType: "kb_lesson", entityId: lessonId });
    revalidateKb(lesson.courseId);
    return { ok: true };
  }) as Promise<KbActionResult>;
}

/** Een eerdere versie van een les terugzetten (de huidige wordt eerst bewaard). */
export async function restoreRevision(revisionId: string): Promise<KbActionResult> {
  return guard(async () => {
    await requireAuthorKennisbank();
    uuid.parse(revisionId);
    const [rev] = await db.select().from(kbLessonRevisions).where(eq(kbLessonRevisions.id, revisionId)).limit(1);
    if (!rev) return { ok: false, message: "Versie niet gevonden." };
    const [lesson] = await db.select({ isPublished: kbLessons.isPublished }).from(kbLessons).where(eq(kbLessons.id, rev.lessonId)).limit(1);
    return saveLesson(rev.lessonId, {
      title: rev.title,
      content: rev.content as { type: "doc"; content?: unknown[] },
      videoUrl: rev.videoUrl,
      resources: rev.resources ?? [],
      isPublished: lesson?.isPublished ?? true,
    });
  }) as Promise<KbActionResult>;
}

/* ------------------------------ SOP-maker ------------------------------ */

/** Hoofdstukken van een cursus — voor de categoriekeuze in de SOP-maker. */
export async function kennisbankChaptersForCourse(courseId: string): Promise<{ ok: boolean; chapters: { id: string; title: string }[] }> {
  try {
    await requireAuthorKennisbank();
    uuid.parse(courseId);
    const rows = await db
      .select({ id: kbChapters.id, title: kbChapters.title })
      .from(kbChapters)
      .where(and(eq(kbChapters.courseId, courseId), isNull(kbChapters.deletedAt)))
      .orderBy(asc(kbChapters.sortOrder), asc(kbChapters.createdAt));
    return { ok: true, chapters: rows };
  } catch {
    return { ok: false, chapters: [] };
  }
}

type SopGen = { intro?: string; sections?: { heading?: string; paragraphs?: string[]; steps?: string[] }[] };

function sopText(t: string) {
  return t ? [{ type: "text", text: t }] : [];
}
function sopPara(t: string) {
  return { type: "paragraph", content: sopText(t) };
}
/** Gestructureerde AI-uitvoer → TipTap-document voor de les-editor. */
function sopToDoc(d: SopGen): KbDoc {
  const content: unknown[] = [];
  if (d.intro?.trim()) content.push(sopPara(d.intro.trim()));
  for (const s of d.sections ?? []) {
    if (s.heading?.trim()) content.push({ type: "heading", attrs: { level: 2 }, content: sopText(s.heading.trim()) });
    for (const p of s.paragraphs ?? []) if (p?.trim()) content.push(sopPara(p.trim()));
    const steps = (s.steps ?? []).filter((x) => x?.trim());
    if (steps.length) {
      content.push({
        type: "orderedList",
        content: steps.map((st) => ({ type: "listItem", content: [sopPara(st.trim())] })),
      });
    }
  }
  if (content.length === 0) content.push(sopPara(""));
  return { type: "doc", content } as KbDoc;
}

export type SopGenResult =
  | { ok: true; content: KbDoc }
  | { ok: false; reason?: "no_provider"; message: string };

/**
 * Genereert automatisch een concept-SOP in onze huisstijl op basis van een korte
 * omschrijving van de taak. Zonder AI-sleutel komt er een nette melding terug en
 * maak je de SOP gewoon handmatig in de editor.
 */
export async function generateSop(input: { title?: string; topic?: string }): Promise<SopGenResult> {
  try {
    await requireAuthorKennisbank();
    const title = (input.title ?? "").trim();
    const topic = (input.topic ?? "").trim();
    if (!title && !topic) return { ok: false, message: "Beschrijf kort waar de SOP over gaat." };

    const house = await centralKnowledgeText(["schrijfstijl", "branding", "algemeen", "productie", "kwaliteit"]);
    const system = `Je bent de interne kennisbank-redacteur van Shortclips, een Nederlands bureau voor korte video's. Je schrijft heldere, praktische SOP's (werkinstructies) in natuurlijk, vlot Nederlands — precies zoals het team zelf schrijft, nooit stijve AI-taal. Je verzint geen feiten, cijfers, namen, tools, prijzen of afspraken; blijf bij wat algemeen geldt voor het beschreven proces en houd het concreet en uitvoerbaar.${house ? `\n\nONZE HUISSTIJL EN WERKWIJZE:\n${house}` : ""}`;
    const user = `Schrijf een complete, praktische SOP voor:\nTitel: ${title || topic}\nOnderwerp/taak: ${topic || title}\n\nBegin met een korte inleiding (1-2 zinnen: waarom en wanneer gebruik je dit). Daarna logische secties met een duidelijke kop. Geef per sectie óf korte genummerde stappen (imperatief: "Doe X") óf korte alinea's. Houd het bondig en direct toepasbaar voor een teamlid.\n\nAntwoord UITSLUITEND als JSON in deze vorm:\n{"intro":"...","sections":[{"heading":"...","steps":["stap 1","stap 2"]},{"heading":"...","paragraphs":["korte uitleg"]}]}`;

    const res = await runJsonPrompt<SopGen>({ system, user, maxTokens: 2500 });
    if (!res.ok) {
      return res.reason === "no_provider"
        ? { ok: false, reason: "no_provider", message: "Er is nog geen AI-sleutel ingesteld. Maak de SOP handmatig aan en schrijf hem in de editor." }
        : { ok: false, message: res.error ?? "Automatisch genereren is niet gelukt." };
    }
    return { ok: true, content: sopToDoc(res.data) };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
