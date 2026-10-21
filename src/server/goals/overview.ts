import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { goalMilestones, goals, goalSnapshots, goalUpdates, users } from "@/db/schema";
import { isOwner, type Viewer } from "@/server/auth/context";
import { computeGoalStatus, type GoalStatus, type GoalType } from "./status";
import { METRIC_RESOLVERS } from "./metrics";
import { PILLARS, PILLAR_LABEL, Q4_END, Q4_START } from "./catalog";

export type GoalMilestoneRow = { id: string; title: string; done: boolean };
export type GoalRow = {
  id: string;
  pillar: string;
  pillarLabel: string;
  title: string;
  type: GoalType;
  source: "live" | "manual";
  metricKey: string | null;
  unit: string | null;
  ownerId: string | null;
  ownerName: string | null;
  current: number;
  target: number | null;
  measured: boolean;
  status: GoalStatus;
  expected: number | null;
  shortfallPct: number | null;
  startDate: string;
  endDate: string;
  visibility: "team" | "founders";
  lastUpdateAt: string | null;
  milestones: GoalMilestoneRow[];
  causeLabels: string[];
  causeHref: string | null;
};

export type PillarBlock = { key: string; label: string; rows: GoalRow[]; counts: Record<GoalStatus, number> };
export type GoalsOverview = {
  rows: GoalRow[];
  pillars: PillarBlock[];
  counts: Record<GoalStatus, number>;
  weekOfQuarter: number;
  totalWeeks: number;
  quarterPct: number;
};

const ALL_STATUSES: GoalStatus[] = ["op_koers", "risico", "achter", "niet_bijgewerkt", "gepland", "gehaald"];
const emptyCounts = (): Record<GoalStatus, number> => Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<GoalStatus, number>;

const DAY = 86_400_000;
function dayMs(d: string): number {
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).getTime();
}

export async function getGoalsOverview(viewer: Viewer, now = new Date()): Promise<GoalsOverview> {
  const owner = isOwner(viewer);

  const startMs = dayMs(Q4_START);
  const endMs = dayMs(Q4_END);
  const weekOfQuarter = Math.min(13, Math.max(1, Math.floor((now.getTime() - startMs) / (7 * DAY)) + 1));
  const quarterPct = Math.min(100, Math.max(0, Math.round(((now.getTime() - startMs) / (endMs - startMs)) * 100)));

  // Editors zien geen doelen.
  if (viewer.isEditorOnly) {
    return { rows: [], pillars: [], counts: emptyCounts(), weekOfQuarter, totalWeeks: 13, quarterPct };
  }

  const goalRows = await db
    .select()
    .from(goals)
    .where(eq(goals.archived, false))
    .orderBy(asc(goals.pillar), asc(goals.sortOrder), asc(goals.createdAt));

  // Founders-doelen alleen voor de eigenaar.
  const visibleGoals = goalRows.filter((g) => owner || g.visibility !== "founders");
  if (visibleGoals.length === 0) {
    return { rows: [], pillars: PILLARS.map((p) => ({ key: p.key, label: p.label, rows: [], counts: emptyCounts() })), counts: emptyCounts(), weekOfQuarter, totalWeeks: 13, quarterPct };
  }
  const ids = visibleGoals.map((g) => g.id);
  const ownerIds = [...new Set(visibleGoals.map((g) => g.ownerId).filter((x): x is string => Boolean(x)))];

  const [mileRows, updateRows, snapRows, ownerRows] = await Promise.all([
    db.select().from(goalMilestones).where(inArray(goalMilestones.goalId, ids)).orderBy(asc(goalMilestones.sortOrder)),
    db
      .select({ goalId: goalUpdates.goalId, createdAt: goalUpdates.createdAt })
      .from(goalUpdates)
      .where(inArray(goalUpdates.goalId, ids))
      .orderBy(desc(goalUpdates.createdAt)),
    db
      .select({ goalId: goalSnapshots.goalId, snapshotOn: goalSnapshots.snapshotOn, current: goalSnapshots.current })
      .from(goalSnapshots)
      .where(inArray(goalSnapshots.goalId, ids))
      .orderBy(desc(goalSnapshots.snapshotOn)),
    ownerIds.length
      ? db.select({ id: users.id, fullName: users.fullName }).from(users).where(and(inArray(users.id, ownerIds), isNull(users.deletedAt)))
      : Promise.resolve([] as { id: string; fullName: string }[]),
  ]);

  const milesByGoal = new Map<string, typeof mileRows>();
  for (const m of mileRows) (milesByGoal.get(m.goalId) ?? milesByGoal.set(m.goalId, []).get(m.goalId)!).push(m);
  const latestUpdate = new Map<string, Date>();
  for (const u of updateRows) if (!latestUpdate.has(u.goalId)) latestUpdate.set(u.goalId, u.createdAt as Date);
  const snapsByGoal = new Map<string, { snapshotOn: string; current: number }[]>();
  for (const s of snapRows) (snapsByGoal.get(s.goalId) ?? snapsByGoal.set(s.goalId, []).get(s.goalId)!).push({ snapshotOn: s.snapshotOn, current: Number(s.current) });
  const ownerName = new Map(ownerRows.map((o) => [o.id, o.fullName]));

  // Eigenaar (Jarno) voor de live-metingen.
  const [ownerUser] = await db.select({ id: users.id }).from(users).where(eq(users.primaryRole, "owner")).limit(1);
  const ownerId = ownerUser?.id ?? null;

  const rows: GoalRow[] = [];
  for (const g of visibleGoals) {
    const type = g.type as GoalType;
    const target = g.target != null ? Number(g.target) : null;
    const miles = (milesByGoal.get(g.id) ?? []).map((m) => ({ id: m.id, title: m.title, done: m.done }));

    let current = Number(g.current);
    let measured = true;
    let causeLabels: string[] = [];
    let causeHref: string | null = null;

    if (type === "milestone") {
      current = miles.filter((m) => m.done).length;
      measured = miles.length > 0;
    } else if (g.source === "live" && g.metricKey && METRIC_RESOLVERS[g.metricKey]) {
      const res = await METRIC_RESOLVERS[g.metricKey]!({ ownerId, now });
      current = res.current;
      measured = res.measured;
      causeLabels = res.causeLabels ?? [];
      causeHref = res.causeHref ?? null;
    } else {
      // Handmatig: "Nog niet gemeten" tot de eerste update.
      measured = latestUpdate.has(g.id) || Number(g.current) > 0;
    }

    // norm: hoeveel weken op rij is de norm gehaald (uit snapshots).
    let normConsecutiveHits = 0;
    if (type === "norm" && target != null) {
      const snaps = snapsByGoal.get(g.id) ?? [];
      let streak = 0;
      for (const s of snaps) {
        if (s.current >= target) streak++;
        else break;
      }
      normConsecutiveHits = Math.floor(streak / 7);
    }

    const effectiveTarget = type === "milestone" ? miles.length || null : target;
    const result = computeGoalStatus(
      { type, source: g.source as "live" | "manual", startDate: g.startDate, endDate: g.endDate, current, target: effectiveTarget, lastUpdateAt: latestUpdate.get(g.id) ?? g.updatedAt, normConsecutiveHits },
      now,
    );
    let status = result.status;
    // Geen data om op te meten en al gestart: stand ontbreekt.
    if (!measured && status !== "gepland" && status !== "gehaald") status = "niet_bijgewerkt";

    rows.push({
      id: g.id,
      pillar: g.pillar,
      pillarLabel: PILLAR_LABEL[g.pillar] ?? g.pillar,
      title: g.title,
      type,
      source: g.source as "live" | "manual",
      metricKey: g.metricKey ?? null,
      unit: g.unit,
      ownerId: g.ownerId,
      ownerName: g.ownerId ? ownerName.get(g.ownerId) ?? null : null,
      current,
      target: effectiveTarget,
      measured,
      status,
      expected: result.expected,
      shortfallPct: result.shortfallPct,
      startDate: g.startDate,
      endDate: g.endDate,
      visibility: g.visibility as "team" | "founders",
      lastUpdateAt: (latestUpdate.get(g.id) ?? null)?.toISOString() ?? null,
      milestones: miles,
      causeLabels,
      causeHref,
    });
  }

  const counts = emptyCounts();
  for (const r of rows) counts[r.status]++;

  const pillars: PillarBlock[] = PILLARS.map((p) => {
    const pr = rows.filter((r) => r.pillar === p.key);
    const c = emptyCounts();
    for (const r of pr) c[r.status]++;
    return { key: p.key, label: p.label, rows: pr, counts: c };
  }).filter((p) => p.rows.length > 0);

  return { rows, pillars, counts, weekOfQuarter, totalWeeks: 13, quarterPct };
}
