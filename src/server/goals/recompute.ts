import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { goalMilestones, goals, goalSnapshots, goalUpdates, users } from "@/db/schema";
import { notify } from "@/server/notifications";
import { computeGoalStatus, type GoalStatus, type GoalType } from "./status";
import { METRIC_RESOLVERS } from "./metrics";
import { seedGoals } from "./seed";

type GoalRecord = typeof goals.$inferSelect;

/** Bepaalt de actuele stand (current) van één doel: mijlpaal, live of handmatig. */
async function resolveCurrent(goal: GoalRecord, ownerId: string | null, now: Date): Promise<{ current: number; measured: boolean; effectiveTarget: number | null }> {
  const type = goal.type as GoalType;
  const target = goal.target != null ? Number(goal.target) : null;
  if (type === "milestone") {
    const miles = await db.select({ done: goalMilestones.done }).from(goalMilestones).where(eq(goalMilestones.goalId, goal.id));
    return { current: miles.filter((m) => m.done).length, measured: miles.length > 0, effectiveTarget: miles.length || null };
  }
  if (goal.source === "live" && goal.metricKey && METRIC_RESOLVERS[goal.metricKey]) {
    const res = await METRIC_RESOLVERS[goal.metricKey]!({ ownerId, now });
    return { current: res.current, measured: res.measured, effectiveTarget: target };
  }
  const [last] = await db.select({ id: goalUpdates.id }).from(goalUpdates).where(eq(goalUpdates.goalId, goal.id)).limit(1);
  return { current: Number(goal.current), measured: Boolean(last) || Number(goal.current) > 0, effectiveTarget: target };
}

async function normHits(goalId: string, target: number | null): Promise<number> {
  if (target == null) return 0;
  const snaps = await db
    .select({ current: goalSnapshots.current })
    .from(goalSnapshots)
    .where(eq(goalSnapshots.goalId, goalId))
    .orderBy(desc(goalSnapshots.snapshotOn))
    .limit(35);
  let streak = 0;
  for (const s of snaps) {
    if (Number(s.current) >= target) streak++;
    else break;
  }
  return Math.floor(streak / 7);
}

/** Herbereken status van één doel (en sla op). Retourneert de statuswissel. */
export async function recomputeGoal(goalId: string, now = new Date(), opts: { snapshot?: boolean } = {}): Promise<{ changed: boolean; from: GoalStatus | null; to: GoalStatus; goal: GoalRecord } | null> {
  const [goal] = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
  if (!goal || goal.archived) return null;
  const [ownerUser] = await db.select({ id: users.id }).from(users).where(eq(users.primaryRole, "owner")).limit(1);
  const ownerId = ownerUser?.id ?? null;

  const { current, measured, effectiveTarget } = await resolveCurrent(goal, ownerId, now);
  const [lastUpd] = await db.select({ createdAt: goalUpdates.createdAt }).from(goalUpdates).where(eq(goalUpdates.goalId, goal.id)).orderBy(desc(goalUpdates.createdAt)).limit(1);
  const result = computeGoalStatus(
    { type: goal.type as GoalType, source: goal.source as "live" | "manual", startDate: goal.startDate, endDate: goal.endDate, current, target: effectiveTarget, lastUpdateAt: lastUpd?.createdAt ?? goal.updatedAt, normConsecutiveHits: await normHits(goal.id, effectiveTarget) },
    now,
  );
  let status = result.status;
  if (!measured && status !== "gepland" && status !== "gehaald") status = "niet_bijgewerkt";

  const from = (goal.status as GoalStatus) ?? null;
  const changed = from !== status;
  await db
    .update(goals)
    .set({
      current: String(current),
      status,
      ...(changed ? { previousStatus: from, statusChangedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(goals.id, goal.id));

  if (opts.snapshot) {
    const snapshotOn = now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
    await db
      .insert(goalSnapshots)
      .values({ goalId: goal.id, snapshotOn, current: String(current), status })
      .onConflictDoNothing({ target: [goalSnapshots.goalId, goalSnapshots.snapshotOn] });
  }

  return { changed, from, to: status, goal: { ...goal, status, current: String(current) } };
}

/** Meldingen bij een statuswissel, volgens de routeringsregels. */
async function notifyStatusChange(goal: GoalRecord, to: GoalStatus, now: Date): Promise<void> {
  const [ownerUser] = await db.select({ id: users.id }).from(users).where(eq(users.primaryRole, "owner")).limit(1);
  const jarnoId = ownerUser?.id ?? null;
  const dayKey = now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const href = "/doelen";
  const title = goal.title;

  if (to === "risico" && goal.ownerId) {
    await notify({ userIds: [goal.ownerId], type: "goal_risico", level: "warning", title: `Doel loopt risico: ${title}`, body: "Dit doel dreigt achter te lopen. Bekijk de stand en stuur bij.", href, dedupeKey: `goal_risico:${goal.id}:${dayKey}` });
  } else if (to === "achter") {
    const to_ids = [goal.ownerId, jarnoId].filter((x): x is string => Boolean(x));
    if (to_ids.length) await notify({ userIds: [...new Set(to_ids)], type: "goal_achter", level: "critical", title: `Doel achter: ${title}`, body: "Dit doel loopt achter op schema en vraagt directe actie.", href, dedupeKey: `goal_achter:${goal.id}:${dayKey}` });
  } else if (to === "niet_bijgewerkt" && goal.ownerId) {
    await notify({ userIds: [goal.ownerId], type: "goal_stand_ontbreekt", level: "info", title: `Stand ontbreekt: ${title}`, body: "Werk de stand van dit doel even bij.", href, dedupeKey: `goal_stand:${goal.id}:${dayKey}` });
  } else if (to === "gehaald") {
    await notify({ roles: ["owner", "project_coordinator", "content_creator", "videographer"], type: "goal_gehaald", level: "success", title: `Doel gehaald: ${title}`, body: "Dit doel is gehaald. Mooi werk, team.", href, dedupeKey: `goal_gehaald:${goal.id}` });
  }

  // Eigenaar ontbreekt: altijd een signaal aan Jarno (eenmalig per dag).
  if (!goal.ownerId && jarnoId) {
    await notify({ userIds: [jarnoId], type: "goal_geen_eigenaar", level: "info", title: `Doel zonder eigenaar: ${title}`, body: "Wijs een eigenaar toe aan dit doel.", href, dedupeKey: `goal_geen_eigenaar:${goal.id}:${dayKey}` });
  }
}

/** Eén doel herberekenen en direct melden bij een wissel (na handmatige update). */
export async function recomputeAndNotify(goalId: string, now = new Date()): Promise<void> {
  const r = await recomputeGoal(goalId, now, { snapshot: false });
  if (r && r.changed) await notifyStatusChange(r.goal, r.to, now);
}

/** Nachtelijke job: alle doelen herberekenen, snapshot opslaan, melden bij wissel.
 *  Op maandagochtend ook een herinnering voor doelen met status niet_bijgewerkt. */
export async function recomputeAllGoals(now = new Date()): Promise<{ processed: number; changed: number }> {
  // Vangnet: als er nog geen doelen staan (bijv. net na een deploy), plaats ze.
  // seedGoals is idempotent en doet niets zodra er al doelen bestaan.
  await seedGoals();
  const all = await db.select({ id: goals.id }).from(goals).where(eq(goals.archived, false));
  let changed = 0;
  const isMonday = now.toLocaleDateString("en-US", { weekday: "short", timeZone: "Europe/Amsterdam" }) === "Mon";
  for (const g of all) {
    const r = await recomputeGoal(g.id, now, { snapshot: true });
    if (!r) continue;
    if (r.changed) {
      changed++;
      await notifyStatusChange(r.goal, r.to, now);
    } else if (isMonday && r.to === "niet_bijgewerkt" && r.goal.ownerId) {
      // Maandagochtend-herinnering (wekelijks, los van een wissel).
      const weekKey = now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
      await notify({ userIds: [r.goal.ownerId], type: "goal_stand_ontbreekt", level: "info", title: `Stand ontbreekt: ${r.goal.title}`, body: "Werk de stand van dit doel even bij.", href: "/doelen", dedupeKey: `goal_stand_ma:${r.goal.id}:${weekKey}` });
    }
  }
  return { processed: all.length, changed };
}
