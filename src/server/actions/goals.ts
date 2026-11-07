"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { goalMilestones, goals, goalUpdates } from "@/db/schema";
import { ForbiddenError, requireOwner, requireTeamMember } from "@/server/auth/context";
import { recomputeAllGoals, recomputeAndNotify } from "@/server/goals/recompute";
import { seedGoals } from "@/server/goals/seed";
import { Q4_END, Q4_START } from "@/server/goals/catalog";

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
    const viewer = await requireTeamMember();
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
    await requireTeamMember();
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
    await requireTeamMember();
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

const detailsSchema = z.object({
  title: z.string().trim().min(3, "Geef het doel een omschrijving.").max(240),
  target: z.number().finite().min(0).nullable().optional(),
});

/** Omschrijving en/of doelwaarde van een doel aanpassen (alleen Jarno). */
export async function updateGoalDetails(goalId: string, input: { title: string; target?: number | null }): Promise<GoalActionResult> {
  try {
    await requireOwner();
    const parsed = detailsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Ongeldige invoer." };
    const [goal] = await db.select({ id: goals.id, type: goals.type }).from(goals).where(eq(goals.id, goalId)).limit(1);
    if (!goal) return { ok: false, message: "Doel niet gevonden." };
    const patch: Partial<typeof goals.$inferInsert> = { title: parsed.data.title, updatedAt: new Date() };
    // Mijlpaaldoelen rekenen met hun stappen, niet met een doelwaarde.
    if (parsed.data.target !== undefined && goal.type !== "milestone") {
      patch.target = parsed.data.target != null ? String(parsed.data.target) : null;
    }
    await db.update(goals).set(patch).where(eq(goals.id, goalId));
    await recomputeAndNotify(goalId);
    revalidateGoals();
    return { ok: true, message: "Doel bijgewerkt." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

const createSchema = z.object({
  pillar: z.enum(["sales", "productie", "team", "systemen"]),
  title: z.string().trim().min(3, "Geef het doel een omschrijving.").max(240),
  target: z.number().finite().min(0).nullable().optional(),
});

/** Nieuw handmatig doel toevoegen aan een pijler (alleen Jarno). Loopt t/m het
 *  einde van het lopende kwartaal en start op "nog niet bijgewerkt". */
export async function createGoal(input: { pillar: string; title: string; target?: number | null }): Promise<GoalActionResult> {
  try {
    await requireOwner();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Ongeldige invoer." };
    const existing = await db.select({ sortOrder: goals.sortOrder }).from(goals).where(eq(goals.pillar, parsed.data.pillar));
    const nextOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder), 0) + 1;
    const [row] = await db
      .insert(goals)
      .values({
        pillar: parsed.data.pillar,
        title: parsed.data.title,
        type: "count",
        source: "manual",
        target: parsed.data.target != null ? String(parsed.data.target) : null,
        startDate: Q4_START,
        endDate: Q4_END,
        visibility: "team",
        sortOrder: nextOrder,
      })
      .returning({ id: goals.id });
    if (row) await recomputeAndNotify(row.id);
    revalidateGoals();
    return { ok: true, message: "Doel toegevoegd." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
