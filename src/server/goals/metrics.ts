import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { Q4_END } from "./catalog";

/** Resultaat van een live-meting voor een doel. */
export type MetricResult = {
  /** Huidige stand. */
  current: number;
  /** Onwaar = nog geen data om op te meten (toon "Nog niet gemeten"). */
  measured: boolean;
  /** Concrete oorzaak voor een rij die achterloopt (namen). */
  causeLabels?: string[];
  /** Waar de bijbehorende actieknop heen gaat. */
  causeHref?: string;
};

type Ctx = { ownerId: string | null; now: Date };

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const num = (v: unknown) => Number(v ?? 0);

/** YYYY-MM-01 van de lopende maand (Europe/Amsterdam). */
function monthStart(now: Date): string {
  const d = now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  return `${d.slice(0, 7)}-01`;
}
/** Maandag (ISO) van de lopende week, als YYYY-MM-DD (Europe/Amsterdam). */
function weekStart(now: Date): string {
  const iso = now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = maandag
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export const METRIC_RESOLVERS: Record<string, (ctx: Ctx) => Promise<MetricResult>> = {
  // 1. Nieuwe klanten dit kwartaal met een contract van minimaal 3 maanden.
  async new_clients_q4() {
    const r = await db.execute(sql`
      select count(*)::int n from clients
      where deleted_at is null and status not in ('prospect','churned')
        and started_on >= '2026-10-01' and started_on <= ${Q4_END}
        and coalesce(contract_months, 0) >= 3
    `);
    return { current: num(rows<{ n: number }>(r)[0]?.n), measured: true };
  },

  // 6. Nieuwe leads deze week.
  async leads_weekly({ now }) {
    const ws = weekStart(now);
    const r = await db.execute(sql`
      select count(*)::int n from sales_leads
      where coalesce(first_contact_on, created_at::date) >= ${ws}
    `);
    return { current: num(rows<{ n: number }>(r)[0]?.n), measured: true };
  },

  // 7. Scriptkwaliteit zonder Jarno: % goedgekeurde scripts deze maand waarbij
  //    Jarno niet de beoordelaar was.
  async scripts_without_jarno({ ownerId, now }) {
    const ms = monthStart(now);
    const r = await db.execute(sql`
      select
        count(*)::int total,
        count(*) filter (where approved_by_id is distinct from ${ownerId})::int zonder
      from scripts
      where deleted_at is null and approved_by_id is not null
        and approved_at is not null and approved_at >= ${ms}
    `);
    const row = rows<{ total: number; zonder: number }>(r)[0];
    const total = num(row?.total);
    if (total === 0) return { current: 0, measured: false };
    return { current: Math.round((num(row?.zonder) / total) * 100), measured: true };
  },

  // 8. Alle actieve klanten met opnames gepland tot en met december.
  async shoots_through_dec({ now }) {
    const today = now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
    const r = await db.execute(sql`
      with actief as (select id, name from clients where deleted_at is null and status = 'active'),
      gepland as (
        select distinct client_id from production_days
        where deleted_at is null and status <> 'cancelled'
          and scheduled_on >= ${today} and scheduled_on <= ${Q4_END}
      )
      select a.id, a.name, (g.client_id is not null) as heeft from actief a
      left join gepland g on g.client_id = a.id
    `);
    const list = rows<{ id: string; name: string; heeft: boolean }>(r);
    if (list.length === 0) return { current: 0, measured: false };
    const met = list.filter((x) => x.heeft).length;
    const zonder = list.filter((x) => !x.heeft).map((x) => x.name);
    return {
      current: Math.round((met / list.length) * 100),
      measured: true,
      causeLabels: zonder,
      causeHref: "/productions",
    };
  },

  // 11. 95% binnen de deadline opgeleverd (lopende maand).
  async ontime_rate({ now }) {
    const ms = monthStart(now);
    const r = await db.execute(sql`
      select
        count(*)::int total,
        count(*) filter (where coalesce(published_at, approved_at)::date <= due_on)::int optijd
      from deliverables
      where deleted_at is null and due_on is not null
        and status in ('published','approved','scheduled','ready_to_publish','analysis_available')
        and coalesce(published_at, approved_at, status_changed_at) >= ${ms}
    `);
    const row = rows<{ total: number; optijd: number }>(r)[0];
    const total = num(row?.total);
    if (total === 0) return { current: 0, measured: false };
    // Namen van video's die over de deadline gingen.
    const late = await db.execute(sql`
      select title from deliverables
      where deleted_at is null and due_on is not null
        and status in ('published','approved','scheduled','ready_to_publish','analysis_available')
        and coalesce(published_at, approved_at, status_changed_at) >= ${ms}
        and coalesce(published_at, approved_at)::date > due_on
      order by due_on asc limit 8
    `);
    return {
      current: Math.round((num(row?.optijd) / total) * 100),
      measured: true,
      causeLabels: rows<{ title: string }>(late).map((x) => x.title),
      causeHref: "/videos",
    };
  },

  // 14. 90% van de dagelijkse productie zonder Jarno (deze week). Goedkeuringen
  //     uit approvals (betrouwbaar) plus afgeronde taken op toewijzing (proxy:
  //     er is geen veld "afgerond door", dus we gebruiken de toegewezen persoon).
  async production_without_jarno({ ownerId, now }) {
    const ws = weekStart(now);
    const r = await db.execute(sql`
      with appr as (
        select count(*)::int total, count(*) filter (where decided_by_user_id is distinct from ${ownerId})::int zonder
        from approvals where decided_at is not null and decided_at >= ${ws}
      ),
      tsk as (
        select count(*)::int total, count(*) filter (where assignee_id is distinct from ${ownerId})::int zonder
        from tasks where deleted_at is null and status = 'done' and completed_at is not null and completed_at >= ${ws}
      )
      select (appr.total + tsk.total)::int total, (appr.zonder + tsk.zonder)::int zonder from appr, tsk
    `);
    const row = rows<{ total: number; zonder: number }>(r)[0];
    const total = num(row?.total);
    if (total === 0) return { current: 0, measured: false };
    return { current: Math.round((num(row?.zonder) / total) * 100), measured: true };
  },

  // 20. Alle actieve klanten met actuele resultaten (laatste 30 dagen).
  async results_coverage() {
    const r = await db.execute(sql`
      with actief as (select id, name from clients where deleted_at is null and status = 'active'),
      metr as (
        select distinct client_id from daily_metrics
        where measured_on >= current_date - interval '30 days'
      )
      select a.id, a.name, (m.client_id is not null) as heeft from actief a
      left join metr m on m.client_id = a.id
    `);
    const list = rows<{ id: string; name: string; heeft: boolean }>(r);
    if (list.length === 0) return { current: 0, measured: false };
    const met = list.filter((x) => x.heeft).length;
    const zonder = list.filter((x) => !x.heeft).map((x) => x.name);
    return {
      current: Math.round((met / list.length) * 100),
      measured: true,
      causeLabels: zonder,
      causeHref: "/analytics",
    };
  },
};
