import "server-only";
import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveRequests, users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { workingDaysBetween } from "@/lib/workdays";
import { CORE_STAFF_EMAILS, coreStaffRank } from "@/server/core-staff";

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
 * Vakantiesaldo van de vaste medewerkers (Milou, Jiska, Rutger). Per persoon:
 * beschikbaar (contract), opgenomen (goedgekeurd verlof dit jaar × 8u per
 * werkdag) en wat er nog over is. De eigenaar (Jarno) houdt hier geen saldo bij,
 * en freelancers/losse content creators blijven bewust buiten beeld.
 */
export async function getLeaveBalances(): Promise<LeaveBalance[]> {
  await requireInternal();
  const yearStart = `${new Date().getFullYear()}-01-01`;

  const [team, approved] = await Promise.all([
    db
      .select({ id: users.id, name: users.fullName, email: users.email, total: users.leaveHoursTotal })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          eq(users.status, "active"),
          // De eigenaar (Jarno) houdt hier geen vakantiesaldo bij.
          ne(users.primaryRole, "owner"),
          sql`lower(${users.email}) in (${sql.join(CORE_STAFF_EMAILS.map((e) => sql`${e}`), sql`, `)})`,
        ),
      ),
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

  return team
    .map((u) => {
      const t = takenByUser.get(u.id) ?? { hours: 0, count: 0 };
      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        isStaff: true,
        totalHours: u.total,
        takenHours: t.hours,
        remainingHours: u.total - t.hours,
        requests: t.count,
      };
    })
    .sort((a, b) => coreStaffRank(a.email) - coreStaffRank(b.email))
    .map(({ email: _email, ...rest }) => rest);
}
