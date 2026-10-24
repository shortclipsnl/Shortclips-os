"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { developmentPoints, kbCourses, kbLessons } from "@/db/schema";
import { requireInternal, ForbiddenError } from "@/server/auth/context";
import { canReviewDevelopment, generateUserDevelopment } from "@/server/development";

export type ActionResult = { ok: boolean; message?: string };

function wrap<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message } as ActionResult;
    throw e;
  });
}

const STATUSES = new Set(["open", "in_progress", "resolved", "dismissed"]);
const TYPES = new Set(["fout", "vaardigheid", "feedback"]);

/** AI-ontwikkelanalyse voor een medewerker genereren (zelf of leidinggevende). */
export async function generateDevelopment(userId: string): Promise<ActionResult> {
  return wrap(async () => {
    await requireInternal();
    const res = await generateUserDevelopment(userId);
    revalidatePath(`/ontwikkeling/${userId}`);
    revalidatePath("/ontwikkeling");
    if (res.ok) return { ok: true };
    if (res.reason === "no_provider") return { ok: false, message: "AI-koppeling staat uit (ANTHROPIC_API_KEY ontbreekt)." };
    if (res.reason === "no_data") return { ok: false, message: res.message };
    if (res.reason === "forbidden") return { ok: false, message: res.message ?? "Geen toegang." };
    return { ok: false, message: res.message ?? "Analyse mislukt." };
  });
}

/**
 * Een ontwikkelpunt bijwerken.
 * - Leidinggevende: alle velden + elke status (beoordelen/aanpassen).
 * - De medewerker zelf: mag alleen de status op "in_progress" (ik pak dit op)
 *   of terug naar "open" zetten; niet afronden/afwijzen.
 */
export async function updateDevelopmentPoint(
  pointId: string,
  patch: {
    status?: string;
    type?: string;
    category?: string;
    title?: string;
    description?: string;
    advies?: string;
    kbLessonId?: string | null;
  },
): Promise<ActionResult> {
  return wrap(async () => {
    const viewer = await requireInternal();
    const [point] = await db
      .select({ id: developmentPoints.id, userId: developmentPoints.userId, status: developmentPoints.status })
      .from(developmentPoints)
      .where(and(eq(developmentPoints.id, pointId), isNull(developmentPoints.deletedAt)))
      .limit(1);
    if (!point) return { ok: false, message: "Ontwikkelpunt niet gevonden." };

    const isManager = canReviewDevelopment(viewer);
    const isSelf = point.userId === viewer.id;
    if (!isManager && !isSelf) return { ok: false, message: "Geen toegang." };

    const set: Record<string, unknown> = { updatedAt: new Date() };

    if (!isManager) {
      // Medewerker zelf: uitsluitend status open <-> in_progress.
      if (patch.status && (patch.status === "in_progress" || patch.status === "open")) {
        set.status = patch.status;
      } else {
        return { ok: false, message: "Je kunt alleen aangeven dat je hiermee bezig bent." };
      }
    } else {
      if (patch.status && STATUSES.has(patch.status)) {
        set.status = patch.status;
        set.resolvedAt = patch.status === "resolved" ? new Date() : null;
      }
      if (patch.type && TYPES.has(patch.type)) set.type = patch.type;
      if (patch.category != null) set.category = String(patch.category).slice(0, 40);
      if (patch.title != null) set.title = String(patch.title).slice(0, 240);
      if (patch.description != null) set.description = String(patch.description);
      if (patch.advies != null) set.advies = String(patch.advies);
      if (patch.kbLessonId !== undefined) {
        if (patch.kbLessonId) {
          const [lesson] = await db
            .select({ id: kbLessons.id, courseId: kbLessons.courseId })
            .from(kbLessons)
            .where(and(eq(kbLessons.id, patch.kbLessonId), isNull(kbLessons.deletedAt)))
            .limit(1);
          if (lesson) {
            set.kbLessonId = lesson.id;
            set.kbCourseId = lesson.courseId;
          }
        } else {
          set.kbLessonId = null;
          set.kbCourseId = null;
        }
      }
      // Een leidinggevende die aanpast, geldt als beoordelaar.
      set.reviewedById = viewer.id;
      set.reviewedAt = new Date();
    }

    await db.update(developmentPoints).set(set).where(eq(developmentPoints.id, pointId));
    revalidatePath(`/ontwikkeling/${point.userId}`);
    revalidatePath("/ontwikkeling");
    return { ok: true };
  });
}

/** Handmatig een ontwikkelpunt toevoegen (alleen leidinggevende). */
export async function addDevelopmentPoint(
  userId: string,
  data: { type: string; category?: string; title: string; description?: string; advies?: string },
): Promise<ActionResult> {
  return wrap(async () => {
    const viewer = await requireInternal();
    if (!canReviewDevelopment(viewer)) return { ok: false, message: "Alleen een leidinggevende kan punten toevoegen." };
    const title = String(data.title ?? "").trim();
    if (!title) return { ok: false, message: "Geef een titel op." };
    await db.insert(developmentPoints).values({
      userId,
      type: TYPES.has(data.type) ? data.type : "vaardigheid",
      category: String(data.category ?? "kwaliteit").slice(0, 40),
      title: title.slice(0, 240),
      description: String(data.description ?? ""),
      advies: String(data.advies ?? ""),
      zekerheid: "bewezen",
      source: "manual",
      status: "open",
      reviewedById: viewer.id,
      reviewedAt: new Date(),
      createdById: viewer.id,
    });
    revalidatePath(`/ontwikkeling/${userId}`);
    revalidatePath("/ontwikkeling");
    return { ok: true };
  });
}

/** Lijst met trainingen (lessen) voor de koppel-dropdown van de leidinggevende. */
export async function listTrainings(): Promise<{ id: string; label: string }[]> {
  await requireInternal();
  const list = await db
    .select({ id: kbLessons.id, title: kbLessons.title, course: kbCourses.title })
    .from(kbLessons)
    .leftJoin(kbCourses, eq(kbCourses.id, kbLessons.courseId))
    .where(and(isNull(kbLessons.deletedAt), eq(kbLessons.isPublished, true)))
    .orderBy(kbCourses.title, kbLessons.title)
    .limit(200);
  return list.map((l) => ({ id: l.id, label: l.course ? `${l.course} — ${l.title}` : l.title }));
}
