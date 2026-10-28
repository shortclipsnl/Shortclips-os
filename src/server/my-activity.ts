import "server-only";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, productionDays } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";

/**
 * Eigen activiteit + geschatte gewerkte uren per dag, automatisch afgeleid uit de
 * handelingen die de medewerker in het portaal doet (`audit_logs`). Er wordt
 * nergens een echte tijdsduur opgeslagen, dus de uren zijn een SCHATTING: per
 * handeling tellen we de tijd tot de volgende handeling van diezelfde persoon,
 * met een plafond per gat (langere pauzes tellen niet mee). Gemeten opname-uren
 * (start-/eindtijd van opnamedagen waarop de persoon videograaf was) worden als
 * harde uren meegeteld.
 */

const TZ = "Europe/Amsterdam";
const CAP_MIN = 30; // max. minuten toegekend aan één handeling (daarna: pauze)
const MIN_MIN = 1; // ondergrens per handeling
const TAIL_MIN = 5; // laatste handeling van een dagcluster: afrondtijd

/** action-prefix → leesbare activiteitscategorie. */
const CATEGORY: Record<string, string> = {
  client: "Klanten", clients: "Klanten",
  calendar: "Contentplanning", content: "Contentplanning",
  production: "Opnameplanning",
  editproject: "Editing", editing: "Editing",
  portal: "Klantportaal",
  script: "Scripting", scripts: "Scripting",
  kennisbank: "Kennisbank",
  ai: "AI-tools",
  sales: "Sales",
  goal: "Doelen", goals: "Doelen",
  task: "Taken", tasks: "Taken",
  finance: "Financiën",
  report: "Rapportage", reports: "Rapportage",
  deliverable: "Video's", video: "Video's",
  user: "Team", users: "Team",
  meeting: "Meetings", meetings: "Meetings",
};

function categoryFor(action: string): string {
  const prefix = action.split(".")[0] ?? action;
  return CATEGORY[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

export type ActivityCategory = { category: string; count: number; minutes: number };
export type ActivityDay = {
  date: string; // YYYY-MM-DD (lokaal)
  label: string; // "ma 27 okt"
  categories: ActivityCategory[];
  estimatedMinutes: number; // uit activiteit (schatting)
  shootMinutes: number; // gemeten opname-uren
  totalMinutes: number;
};
export type MyActivity = { days: ActivityDay[]; totalMinutes: number; from: string };

export async function getMyActivity(viewer: Viewer, daysBack = 14): Promise<MyActivity> {
  const since = new Date(Date.now() - daysBack * 86_400_000);
  const localDate = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });

  const events = await db
    .select({ action: auditLogs.action, occurredAt: auditLogs.occurredAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorUserId, viewer.id), eq(auditLogs.outcome, "allow"), gte(auditLogs.occurredAt, since)))
    .orderBy(asc(auditLogs.occurredAt));

  // Per dag: categorie → { count, minutes }. Duur = tijd tot de volgende
  // handeling diezelfde dag (met plafond); de laatste handeling krijgt afrondtijd.
  const byDay = new Map<string, Map<string, { count: number; minutes: number }>>();
  for (let i = 0; i < events.length; i++) {
    const cur = events[i]!;
    const curAt = cur.occurredAt as unknown as Date;
    const day = localDate(curAt);
    const next = events[i + 1];
    let durMin: number;
    if (next && localDate(next.occurredAt as unknown as Date) === day) {
      const gap = (new Date(next.occurredAt as unknown as Date).getTime() - new Date(curAt).getTime()) / 60000;
      durMin = Math.min(CAP_MIN, Math.max(MIN_MIN, gap));
    } else {
      durMin = TAIL_MIN;
    }
    const cat = categoryFor(cur.action);
    const dayMap = byDay.get(day) ?? new Map<string, { count: number; minutes: number }>();
    const c = dayMap.get(cat) ?? { count: 0, minutes: 0 };
    c.count += 1;
    c.minutes += durMin;
    dayMap.set(cat, c);
    byDay.set(day, dayMap);
  }

  // Gemeten opname-uren per dag (als de medewerker videograaf was).
  const shootRes = await db.execute(sql`
    select to_char(scheduled_on, 'YYYY-MM-DD') as day,
      coalesce(sum(least(8::numeric,
        case when start_time is not null and end_time is not null and end_time > start_time
          then extract(epoch from (end_time - start_time)) / 3600.0 else 0 end)), 0)::float hours
    from production_days
    where deleted_at is null and status <> 'cancelled'
      and videographer_id = ${viewer.id}
      and scheduled_on >= ${localDate(since)}
    group by scheduled_on`);
  const shootRows = ((shootRes as { rows?: unknown[] }).rows ?? (shootRes as unknown as unknown[])) as Array<{ day: string; hours: number }>;
  const shootByDay = new Map(shootRows.map((r) => [r.day, Math.round(Number(r.hours) * 60)]));

  const allDays = new Set<string>([...byDay.keys(), ...shootByDay.keys()]);
  const days: ActivityDay[] = [...allDays]
    .sort((a, b) => (a < b ? 1 : -1)) // nieuwste dag eerst
    .map((date) => {
      const dayMap = byDay.get(date) ?? new Map<string, { count: number; minutes: number }>();
      const categories: ActivityCategory[] = [...dayMap.entries()]
        .map(([category, v]) => ({ category, count: v.count, minutes: Math.round(v.minutes) }))
        .sort((a, b) => b.minutes - a.minutes);
      const estimatedMinutes = categories.reduce((s, c) => s + c.minutes, 0);
      const shootMinutes = shootByDay.get(date) ?? 0;
      const label = new Date(`${date}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
      return { date, label, categories, estimatedMinutes, shootMinutes, totalMinutes: estimatedMinutes + shootMinutes };
    });

  const totalMinutes = days.reduce((s, d) => s + d.totalMinutes, 0);
  return { days, totalMinutes, from: localDate(since) };
}
