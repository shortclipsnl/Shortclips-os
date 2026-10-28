"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { goalMilestones, goals, goalUpdates } from "@/db/schema";
import { ForbiddenError, requireInternal, requireOwner } from "@/server/auth/context";
import { recomputeAllGoals, recomputeAndNotify } from "@/server/goals/recompute";
import { seedGoals } from "@/server/goals/seed";

export type GoalActionResult = { ok: boolean; message?: string };

function revalidateGoals() {
  revalidatePath("/doelen");
  revalidatePath("/dashboard");
  revalidatePath("/kwaliteit");
}

/** De 22 Q4-doelen plaatsen (alleen Jarno). Idempotent: doet niets als ze er al staan. */
export async function seedGoalsNow(): Promise<GoalActionResult> {
  try {
    await requireOwner();
    const { inserted } = await seedGoals();
    if (inserted > 0) await recomputeAllGoals();
    revalidateGoals();
    return { ok: true, message: inserted > 0 ? `${inserted} doelen geplaatst.` : "De doelen stonden er al." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

const standSchema = z.object({ value: z.number().finite(), note: z.string().trim().max(1000).optional() });

/** Handmatige stand bijwerken (team). Logt de update en herberekent de status. */
export async function updateGoalStand(goalId: string, input: { value: number; note?: string }): Promise<GoalActionResult> {
  try {
    const viewer = await requireInternal();
    const parsed = standSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Vul een geldige waarde in." };
    const [goal] = await db.select({ id: goals.id }).from(goals).where(eq(goals.id, goalId)).limit(1);
    if (!goal) return { ok: false, message: "Doel niet gevonden." };
    await db.insert(goalUpdates).values({ goalId, value: String(parsed.data.value), note: parsed.data.note ?? null, userId: viewer.id });
    await db.update(goals).set({ current: String(parsed.data.value), updatedAt: new Date() }).where(eq(goals.id, goalId));
    await recomputeAndNotify(goalId);
    revalidateGoals();
    return { ok: true, message: "Stand bijgewerkt." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Mijlpaal afvinken of terugzetten (team). Herberekent de doelstatus. */
export async function toggleGoalMilestone(milestoneId: string, done: boolean): Promise<GoalActionResult> {
  try {
    await requireInternal();
    const [m] = await db.select({ id: goalMilestones.id, goalId: goalMilestones.goalId }).from(goalMilestones).where(eq(goalMilestones.id, milestoneId)).limit(1);
    if (!m) return { ok: false, message: "Mijlpaal niet gevonden." };
    await db.update(goalMilestones).set({ done, doneAt: done ? new Date() : null, updatedAt: new Date() }).where(eq(goalMilestones.id, milestoneId));
    await recomputeAndNotify(m.goalId);
    revalidateGoals();
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Doel handmatig als "behaald" afvinken of weer vrijgeven (team). Pint de
 *  status op "gehaald"; terugzetten laat de automatische berekening weer bepalen. */
export async function toggleGoalAchieved(goalId: string, achieved: boolean): Promise<GoalActionResult> {
  try {
    await requireInternal();
    const [goal] = await db.select({ id: goals.id }).from(goals).where(eq(goals.id, goalId)).limit(1);
    if (!goal) return { ok: false, message: "Doel niet gevonden." };
    await db
      .update(goals)
      .set({ achievedManually: achieved, achievedAt: achieved ? new Date() : null, updatedAt: new Date() })
      .where(eq(goals.id, goalId));
    await recomputeAndNotify(goalId);
    revalidateGoals();
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Eigenaar toewijzen of wijzigen (alleen Jarno). */
export async function setGoalOwner(goalId: string, ownerId: string | null): Promise<GoalActionResult> {
  try {
    await requireOwner();
    await db.update(goals).set({ ownerId: ownerId || null, updatedAt: new Date() }).where(eq(goals.id, goalId));
    await recomputeAndNotify(goalId);
    revalidateGoals();
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Doel (per week/norm) een target geven (alleen Jarno) — bijv. leads per week. */
export async function setGoalTarget(goalId: string, target: number | null): Promise<GoalActionResult> {
  try {
    await requireOwner();
    if (target != null && (!Number.isFinite(target) || target < 0)) return { ok: false, message: "Vul een geldig doel in." };
    await db.update(goals).set({ target: target != null ? String(target) : null, updatedAt: new Date() }).where(eq(goals.id, goalId));
    await recomputeAndNotify(goalId);
    revalidateGoals();
    return { ok: true, message: "Doel ingesteld." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Doel archiveren (alleen Jarno). */
export async function archiveGoal(goalId: string): Promise<GoalActionResult> {
  try {
    await requireOwner();
    await db.update(goals).set({ archived: true, updatedAt: new Date() }).where(eq(goals.id, goalId));
    revalidateGoals();
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
