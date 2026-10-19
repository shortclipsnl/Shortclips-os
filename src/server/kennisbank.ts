import "server-only";
import { and, asc, eq, inArray, isNull, or, ilike, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { kbChapters, kbCourses, kbLessons, kbProgress, type KbDoc, type KbResource } from "@/db/schema";
import { isOwner, type Viewer } from "@/server/auth/context";

/**
 * Leeslaag van de Shortclips Kennisbank.
 *
 * Lezen: iedere interne gebruiker (medewerkers en freelancers).
 * Beheren: uitsluitend de eigenaar — afgedwongen in `src/server/actions/kennisbank.ts`
 * en in de upload-route, niet alleen in de interface.
 */

export function canManageKennisbank(viewer: Viewer | null): boolean {
  return isOwner(viewer);
}

type CourseRow = typeof kbCourses.$inferSelect;

/** Mag deze viewer deze cursus zien? (afgeschermde cursussen + concepten) */
export function canSeeCourse(viewer: Viewer, course: Pick<CourseRow, "isRestricted" | "allowedRoles" | "isPublished">): boolean {
  if (canManageKennisbank(viewer)) return true;
  if (!course.isPublished) return false;
  if (!course.isRestricted) return true;
  return (course.allowedRoles ?? []).includes(viewer.primaryRole);
}

export type CourseCard = {
  id: string;
  title: string;
  description: string;
  coverAssetId: string | null;
  isRestricted: boolean;
  allowedRoles: string[];
  isPublished: boolean;
  lessonCount: number;
  completedCount: number;
};

export async function listCourses(viewer: Viewer): Promise<CourseCard[]> {
  const manage = canManageKennisbank(viewer);
  const rows = await db
    .select()
    .from(kbCourses)
    .where(isNull(kbCourses.deletedAt))
    .orderBy(asc(kbCourses.sortOrder), asc(kbCourses.createdAt));
  const visible = rows.filter((c) => canSeeCourse(viewer, c));
  if (visible.length === 0) return [];

  const ids = visible.map((c) => c.id);
  const counts = await db
    .select({
      courseId: kbLessons.courseId,
      // Voortgang telt alleen gepubliceerde lessen (concepten tellen niet mee,
      // ook niet voor de eigenaar), net als in Skool.
      total: sql<number>`(count(*) filter (where ${kbLessons.isPublished}))::int`,
      done: sql<number>`(count(${kbProgress.id}) filter (where ${kbLessons.isPublished}))::int`,
    })
    .from(kbLessons)
    .leftJoin(kbChapters, eq(kbChapters.id, kbLessons.chapterId))
    .leftJoin(kbProgress, and(eq(kbProgress.lessonId, kbLessons.id), eq(kbProgress.userId, viewer.id)))
    .where(
      and(
        inArray(kbLessons.courseId, ids),
        isNull(kbLessons.deletedAt),
        isNull(kbChapters.deletedAt),
        manage ? undefined : eq(kbLessons.isPublished, true),
      ),
    )
    .groupBy(kbLessons.courseId);
  const byCourse = new Map(counts.map((c) => [c.courseId, c]));

  return visible.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    coverAssetId: c.coverAssetId,
    isRestricted: c.isRestricted,
    allowedRoles: c.allowedRoles ?? [],
    isPublished: c.isPublished,
    lessonCount: byCourse.get(c.id)?.total ?? 0,
    completedCount: byCourse.get(c.id)?.done ?? 0,
  }));
}

export type OutlineLesson = {
  id: string;
  title: string;
  isPublished: boolean;
  completed: boolean;
  sortOrder: number;
  chapterId: string | null;
};
export type OutlineItem =
  | { kind: "chapter"; id: string; title: string; sortOrder: number; lessons: OutlineLesson[] }
  | { kind: "lesson"; lesson: OutlineLesson; sortOrder: number };

export type CourseDetail = {
  course: CourseRow;
  outline: OutlineItem[];
  lessonOrder: OutlineLesson[];
  lessonCount: number;
  completedCount: number;
};

export async function getCourse(viewer: Viewer, courseId: string): Promise<CourseDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(courseId)) return null;
  const [course] = await db
    .select()
    .from(kbCourses)
    .where(and(eq(kbCourses.id, courseId), isNull(kbCourses.deletedAt)))
    .limit(1);
  if (!course || !canSeeCourse(viewer, course)) return null;
  const manage = canManageKennisbank(viewer);

  const [chapters, lessons, done] = await Promise.all([
    db
      .select({ id: kbChapters.id, title: kbChapters.title, sortOrder: kbChapters.sortOrder })
      .from(kbChapters)
      .where(and(eq(kbChapters.courseId, courseId), isNull(kbChapters.deletedAt)))
      .orderBy(asc(kbChapters.sortOrder)),
    db
      .select({
        id: kbLessons.id,
        title: kbLessons.title,
        chapterId: kbLessons.chapterId,
        sortOrder: kbLessons.sortOrder,
        isPublished: kbLessons.isPublished,
      })
      .from(kbLessons)
      .where(
        and(
          eq(kbLessons.courseId, courseId),
          isNull(kbLessons.deletedAt),
          manage ? undefined : eq(kbLessons.isPublished, true),
        ),
      )
      .orderBy(asc(kbLessons.sortOrder), asc(kbLessons.createdAt)),
    db
      .select({ lessonId: kbProgress.lessonId })
      .from(kbProgress)
      .innerJoin(kbLessons, eq(kbLessons.id, kbProgress.lessonId))
      .where(and(eq(kbProgress.userId, viewer.id), eq(kbLessons.courseId, courseId))),
  ]);
  const doneSet = new Set(done.map((d) => d.lessonId));
  const chapterIds = new Set(chapters.map((c) => c.id));

  const outline: OutlineItem[] = chapters.map((ch) => ({
    kind: "chapter" as const,
    id: ch.id,
    title: ch.title,
    sortOrder: ch.sortOrder,
    lessons: [],
  }));
  const byChapter = new Map(outline.map((o) => [(o as { id: string }).id, o]));
  for (const l of lessons) {
    const ol: OutlineLesson = { ...l, completed: doneSet.has(l.id) };
    if (l.chapterId && chapterIds.has(l.chapterId)) {
      (byChapter.get(l.chapterId) as Extract<OutlineItem, { kind: "chapter" }>).lessons.push(ol);
    } else if (!l.chapterId) {
      outline.push({ kind: "lesson", lesson: ol, sortOrder: l.sortOrder });
    }
  }
  outline.sort((a, b) => a.sortOrder - b.sortOrder);

  const lessonOrder: OutlineLesson[] = [];
  for (const item of outline) {
    if (item.kind === "chapter") lessonOrder.push(...item.lessons);
    else lessonOrder.push(item.lesson);
  }
  return {
    course,
    outline,
    lessonOrder,
    lessonCount: lessonOrder.filter((l) => l.isPublished).length,
    completedCount: lessonOrder.filter((l) => l.isPublished && l.completed).length,
  };
}

export type LessonDetail = {
  id: string;
  courseId: string;
  chapterId: string | null;
  title: string;
  content: KbDoc;
  videoUrl: string | null;
  videoAssetId: string | null;
  resources: KbResource[];
  isPublished: boolean;
  sourceRef: string | null;
  sourceUrl: string | null;
  migrationNotes: string | null;
  updatedAt: Date;
};

export async function getLesson(viewer: Viewer, courseId: string, lessonId: string): Promise<LessonDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(lessonId)) return null;
  const [row] = await db
    .select()
    .from(kbLessons)
    .where(and(eq(kbLessons.id, lessonId), eq(kbLessons.courseId, courseId), isNull(kbLessons.deletedAt)))
    .limit(1);
  if (!row) return null;
  if (!row.isPublished && !canManageKennisbank(viewer)) return null;
  return {
    id: row.id,
    courseId: row.courseId,
    chapterId: row.chapterId,
    title: row.title,
    content: row.content,
    videoUrl: row.videoUrl,
    videoAssetId: row.videoAssetId,
    resources: row.resources ?? [],
    isPublished: row.isPublished,
    sourceRef: row.sourceRef,
    sourceUrl: row.sourceUrl,
    migrationNotes: row.migrationNotes,
    updatedAt: row.updatedAt,
  };
}

/** Mag deze viewer dit bestand zien? Alleen als het in een zichtbare cursus hangt. */
export async function canViewAsset(viewer: Viewer, assetId: string): Promise<boolean> {
  if (canManageKennisbank(viewer)) return true;
  const courses = await db
    .select({ isRestricted: kbCourses.isRestricted, allowedRoles: kbCourses.allowedRoles, isPublished: kbCourses.isPublished })
    .from(kbCourses)
    .where(
      and(
        isNull(kbCourses.deletedAt),
        or(
          eq(kbCourses.coverAssetId, assetId),
          sql`exists (select 1 from kb_lessons l where l.course_id = ${kbCourses.id} and l.deleted_at is null and l.is_published = true and (
            l.video_asset_id = ${assetId}
            or l.content::text like ${"%" + assetId + "%"}
            or l.resources::text like ${"%" + assetId + "%"}
          ))`,
        ),
      ),
    );
  return courses.some((c) => canSeeCourse(viewer, c));
}

export type KbSearchHit = {
  lessonId: string;
  courseId: string;
  lessonTitle: string;
  courseTitle: string;
  snippet: string;
};

function snippetAround(text: string, q: string, size = 110): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, size).replace(/\s+/g, " ");
  const start = Math.max(0, i - Math.floor(size / 3));
  return (start > 0 ? "…" : "") + text.slice(start, start + size).replace(/\s+/g, " ") + "…";
}

/** Zoeken in lestitels én in de tekst van de lessen. */
export async function searchKennisbank(viewer: Viewer, rawQuery: string, limit = 8): Promise<KbSearchHit[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const manage = canManageKennisbank(viewer);
  const rows = await db
    .select({
      lessonId: kbLessons.id,
      courseId: kbLessons.courseId,
      lessonTitle: kbLessons.title,
      contentText: kbLessons.contentText,
      courseTitle: kbCourses.title,
      isRestricted: kbCourses.isRestricted,
      allowedRoles: kbCourses.allowedRoles,
      coursePublished: kbCourses.isPublished,
      titleHit: sql<boolean>`${kbLessons.title} ilike ${like}`,
    })
    .from(kbLessons)
    .innerJoin(kbCourses, eq(kbCourses.id, kbLessons.courseId))
    .leftJoin(kbChapters, eq(kbChapters.id, kbLessons.chapterId))
    .where(
      and(
        isNull(kbLessons.deletedAt),
        isNull(kbCourses.deletedAt),
        isNull(kbChapters.deletedAt),
        manage ? undefined : eq(kbLessons.isPublished, true),
        or(ilike(kbLessons.title, like), ilike(kbLessons.contentText, like), ilike(kbCourses.title, like)),
      ),
    )
    .orderBy(sql`(${kbLessons.title} ilike ${like}) desc`, asc(kbCourses.sortOrder), asc(kbLessons.sortOrder))
    .limit(limit * 3);

  return rows
    .filter((r) => canSeeCourse(viewer, { isRestricted: r.isRestricted, allowedRoles: r.allowedRoles, isPublished: r.coursePublished }))
    .slice(0, limit)
    .map((r) => ({
      lessonId: r.lessonId,
      courseId: r.courseId,
      lessonTitle: r.lessonTitle,
      courseTitle: r.courseTitle,
      snippet: r.titleHit ? snippetAround(r.contentText, q, 90) : snippetAround(r.contentText, q),
    }));
}

/**
 * Basis voor de interne AI: relevante SOP-passages mét bronverwijzing.
 * Alleen lezen — deze functie verandert nooit inhoud.
 */
export async function kennisbankContextForAi(viewer: Viewer, question: string, limit = 5) {
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9à-ÿ]+/i)
    .filter((w) => w.length > 3)
    .slice(0, 6);
  const seen = new Map<string, KbSearchHit>();
  for (const w of words) {
    for (const hit of await searchKennisbank(viewer, w, limit)) seen.set(hit.lessonId, hit);
    if (seen.size >= limit * 2) break;
  }
  const ids = [...seen.keys()].slice(0, limit);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: kbLessons.id, title: kbLessons.title, text: kbLessons.contentText, sourceRef: kbLessons.sourceRef, courseTitle: kbCourses.title, chapterTitle: kbChapters.title })
    .from(kbLessons)
    .innerJoin(kbCourses, eq(kbCourses.id, kbLessons.courseId))
    .leftJoin(kbChapters, eq(kbChapters.id, kbLessons.chapterId))
    .where(inArray(kbLessons.id, ids));
  return rows.map((r) => ({
    source: [r.courseTitle, r.chapterTitle, r.title].filter(Boolean).join(" › "),
    sourceRef: r.sourceRef,
    href: `/kennisbank/${seen.get(r.id)!.courseId}?les=${r.id}`,
    text: r.text,
  }));
}
