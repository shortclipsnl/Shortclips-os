import "server-only";
import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveRequests, teamMembers, users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { workingDaysBetween } from "@/lib/workdays";

export type LeaveBalance = {
  userId: string;
  name: string;
  isStaff: boolean;
  totalHours: number;
  takenHours: number;
  remainingHours: number;
  requests: number;
};

const HOURS_PER_DAY = 8;

/**
 * Vakantiesaldo per teamlid, op uren (overgenomen uit Monday): beschikbaar
 * (contract), opgenomen (goedgekeurd verlof dit jaar × 8u per werkdag) en wat er
 * nog over is. Het hele team is zichtbaar, dus Milou, Jiska en Rutger staan er
 * standaard bij.
 */
export async function getLeaveBalances(): Promise<LeaveBalance[]> {
  await requireInternal();
  const yearStart = `${new Date().getFullYear()}-01-01`;

  const [team, approved] = await Promise.all([
    db
      .select({ id: users.id, name: users.fullName, isStaff: sql<boolean>`coalesce(${teamMembers.isInternal}, true)`, total: users.leaveHoursTotal })
      .from(users)
      .leftJoin(teamMembers, and(eq(teamMembers.userId, users.id), isNull(teamMembers.deletedAt)))
      .where(and(isNull(users.deletedAt), eq(users.status, "active"), ne(users.primaryRole, "client")))
      .orderBy(users.fullName),
    db
      .select({ userId: leaveRequests.userId, startOn: leaveRequests.startOn, endOn: leaveRequests.endOn })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.status, "approved"), gte(leaveRequests.startOn, yearStart))),
  ]);

  const takenByUser = new Map<string, { hours: number; count: number }>();
  for (const r of approved) {
    const hours = workingDaysBetween(r.startOn, r.endOn) * HOURS_PER_DAY;
    const cur = takenByUser.get(r.userId) ?? { hours: 0, count: 0 };
    cur.hours += hours;
    cur.count += 1;
    takenByUser.set(r.userId, cur);
  }

  return team.map((u) => {
    const t = takenByUser.get(u.id) ?? { hours: 0, count: 0 };
    return {
      userId: u.id,
      name: u.name,
      isStaff: u.isStaff,
      totalHours: u.total,
      takenHours: t.hours,
      remainingHours: u.total - t.hours,
      requests: t.count,
    };
  });
}
