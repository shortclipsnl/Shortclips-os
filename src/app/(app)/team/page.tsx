import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  teamMembers,
  users,
} from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import {
  Avatar,
  Badge,
  Card,
  CardHeader,
  LinkButton,
  PageHeader,
  Table,
} from "@/components/ui";
import {
  euro,
  pct,
} from "@/lib/format";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  owner: "Eigenaar",
  admin: "Beheerder",
  project_coordinator: "Projectcoördinator",
  content_creator: "Content creator",
  videographer: "Videograaf",
  editor: "Editor",
  finance: "Finance",
};

export default async function TeamPage() {
  const viewer = await requirePermission("team:read");
  const canSeeCosts = viewer.permissions.has("finance:read_costs");
  const canWrite = viewer.permissions.has("team:write");

  const [people, editorStats] = await Promise.all([
    db.select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.primaryRole,
      status: users.status,
      jobTitle: teamMembers.jobTitle,
      color: teamMembers.color,
      weeklyVideoCapacity: teamMembers.weeklyVideoCapacity,
      isInternal: teamMembers.isInternal,
      openTasks: sql<number>`(
        select count(*) from tasks t
        where t.assignee_id = users.id and t.deleted_at is null
          and t.status in ('todo','in_progress','blocked')
      )`,
      overdueTasks: sql<number>`(
        select count(*) from tasks t
        where t.assignee_id = users.id and t.deleted_at is null
          and t.status in ('todo','in_progress','blocked') and t.due_on < current_date
      )`,
      openVideos: sql<number>`(
        select count(*) from deliverables d
        where d.editor_id = users.id and d.deleted_at is null
          and d.status in ('editing','editor_revision','awaiting_editor')
      )`,
      upcomingShoots: sql<number>`(
        select count(*) from production_days pd
        where pd.videographer_id = users.id and pd.deleted_at is null
          and pd.scheduled_on >= current_date and pd.status <> 'cancelled'
      )`,
    })
      .from(users)
      .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
      .where(and(isNull(users.deletedAt), isNull(teamMembers.deletedAt)))
      .orderBy(users.fullName),

    viewer.permissions.has("editors:read")
      ? db.execute(sql`
          select
            e.id, e.display_name, e.is_freelance, e.weekly_capacity, e.rate_per_video,
            count(d.id) filter (where d.status in ('editing','editor_revision'))::int as lopend,
            count(d.id) filter (where d.status in ('published','approved','scheduled','ready_to_publish'))::int as opgeleverd,
            count(d.id) filter (where d.due_on < current_date and d.status not in ('published','approved','scheduled','ready_to_publish'))::int as te_laat,
            round(avg(d.internal_revision_rounds)::numeric, 2) as gem_intern,
            round(avg(d.client_revision_rounds)::numeric, 2) as gem_klant,
            coalesce((select sum(ec.amount) from editor_costs ec where ec.editor_id = e.id), 0) as kosten
          from editors e
          left join users u on u.id = e.user_id
          left join deliverables d on d.editor_id = u.id and d.deleted_at is null
          where e.deleted_at is null and e.is_active = true
          group by e.id, e.display_name, e.is_freelance, e.weekly_capacity, e.rate_per_video
          order by opgeleverd desc
        `)
      : Promise.resolve([]),
  ]);

  const stats = ((editorStats as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
    (editorStats as unknown as Array<Record<string, unknown>>)) as Array<Record<string, unknown>>;

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="Team"
        description="Bezetting, openstaand werk en editorprestaties."
        actions={canWrite ? <LinkButton href="/team/new">Nieuw teamlid</LinkButton> : undefined}
      />

      <Card padded={false} className="mb-5">
        <div className="p-5 pb-3">
          <CardHeader title="Bezetting" subtitle="Wie heeft wat openstaan." />
        </div>
        <Table
          head={
            <>
              <th className="sc-th">Naam</th>
              <th className="sc-th">Rol</th>
              <th className="sc-th text-right">Open taken</th>
              <th className="sc-th text-right">Video&apos;s in bewerking</th>
              <th className="sc-th text-right">Capaciteit/week</th>
              <th className="sc-th text-right">Opnames gepland</th>
              <th className="sc-th">Belasting</th>
              {canWrite ? <th className="sc-th" /> : null}
            </>
          }
        >
          {people.map((p) => {
            const open = Number(p.openVideos);
            const capacity = p.weeklyVideoCapacity;
            const load = capacity > 0 ? (open / capacity) * 100 : 0;
            const overloaded = capacity > 0 && open > capacity;
            return (
              <tr key={p.id}>
                <td className="sc-td">
                  <span className="flex items-center gap-2.5">
                    <Avatar name={p.fullName} color={p.color} size={26} />
                    <span>
                      <span className="flex items-center gap-2 font-medium">
                        {p.fullName}
                        {p.status !== "active" ? <Badge tone="neutral">Gedeactiveerd</Badge> : null}
                      </span>
                      <span className="block text-xs text-[var(--color-ink-muted)]">
                        {p.jobTitle ?? ROLE_LABELS[p.role] ?? p.role}
                        {!p.isInternal ? " · freelance" : ""}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="sc-td text-[var(--color-ink-muted)]">
                  {ROLE_LABELS[p.role] ?? p.role}
                </td>
                <td className="sc-td text-right tabular-nums">
                  {Number(p.openTasks)}
                  {Number(p.overdueTasks) > 0 ? (
                    <span className="ml-1.5 text-xs font-medium text-[var(--color-bad)]">
                      ({Number(p.overdueTasks)} te laat)
                    </span>
                  ) : null}
                </td>
                <td className="sc-td text-right tabular-nums">{open || "—"}</td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">
                  {capacity || "—"}
                </td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">
                  {Number(p.upcomingShoots) || "—"}
                </td>
                <td className="sc-td">
                  {capacity === 0 ? (
                    <span className="text-[var(--color-ink-faint)]">n.v.t.</span>
                  ) : overloaded ? (
                    <Badge tone="bad">overbelast ({pct(load, 0)})</Badge>
                  ) : load > 80 ? (
                    <Badge tone="warn">vol ({pct(load, 0)})</Badge>
                  ) : (
                    <Badge tone="good">ruimte ({pct(load, 0)})</Badge>
                  )}
                </td>
                {canWrite ? (
                  <td className="sc-td text-right">
                    <Link href={`/team/${p.id}/edit`} className="text-sm text-[var(--color-brand-600)] hover:underline">
                      Bewerken
                    </Link>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </Table>
      </Card>

      {stats.length > 0 ? (
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader
              title="Editorprestaties"
              subtitle="Alle cijfers komen rechtstreeks uit de pipeline; interpretatie blijft mensenwerk."
            />
          </div>
          <Table
            head={
              <>
                <th className="sc-th">Editor</th>
                <th className="sc-th text-right">Lopend</th>
                <th className="sc-th text-right">Opgeleverd</th>
                <th className="sc-th text-right">Te laat</th>
                <th className="sc-th text-right">Gem. interne revisies</th>
                <th className="sc-th text-right">Gem. klantrevisies</th>
                {canSeeCosts ? <th className="sc-th text-right">Kosten</th> : null}
              </>
            }
          >
            {stats.map((e) => (
              <tr key={String(e.id)}>
                <td className="sc-td">
                  <span className="flex items-center gap-2.5">
                    <Avatar name={String(e.display_name)} size={24} />
                    <span>
                      <span className="block font-medium">{String(e.display_name)}</span>
                      {e.is_freelance ? (
                        <span className="block text-xs text-[var(--color-ink-muted)]">freelance</span>
                      ) : null}
                    </span>
                  </span>
                </td>
                <td className="sc-td text-right tabular-nums">{Number(e.lopend)}</td>
                <td className="sc-td text-right tabular-nums">{Number(e.opgeleverd)}</td>
                <td className="sc-td text-right tabular-nums">
                  {Number(e.te_laat) > 0 ? (
                    <span className="font-medium text-[var(--color-bad)]">{Number(e.te_laat)}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">
                  {e.gem_intern ? Number(e.gem_intern).toFixed(2) : "—"}
                </td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">
                  {e.gem_klant ? Number(e.gem_klant).toFixed(2) : "—"}
                </td>
                {canSeeCosts ? (
                  <td className="sc-td text-right tabular-nums">{euro(String(e.kosten))}</td>
                ) : null}
              </tr>
            ))}
          </Table>
          <p className="border-t border-[var(--color-line)] px-5 py-3 text-xs text-[var(--color-ink-muted)]">
            Let op: aantallen zeggen niets over de moeilijkheidsgraad van een
            opdracht. Gebruik deze cijfers als gespreksstof, niet als oordeel.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
