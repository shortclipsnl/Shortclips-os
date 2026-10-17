import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  teamMembers,
  users,
} from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { isCoreStaff, coreStaffRank } from "@/server/core-staff";
import {
  Avatar,
  Badge,
  Card,
  CardHeader,
  EmptyState,
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

function MiniStat({ label, value, tone, hint }: { label: string; value: number; tone?: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] py-1.5">
      <div className="text-base font-bold leading-none tabular-nums" style={tone ? { color: tone } : undefined}>{value || "—"}</div>
      <div className="mt-0.5 text-2xs text-[var(--color-ink-faint)]">{label}</div>
      {hint ? <div className="text-2xs font-medium text-[var(--color-bad)]">{hint}</div> : null}
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Eigenaar",
  admin: "Beheerder",
  project_coordinator: "Projectcoördinator",
  content_creator: "Content creator",
  videographer: "Videograaf",
  editor: "Editor",
  finance: "Finance",
};

/**
 * Echte portretfoto's uit public/team/ (bron: shortclips.nl), gekoppeld op
 * voornaam. Let op: het bestand voor Jiska heet historisch "jeska.png".
 * Zonder match toont de Avatar initialen op de persoonskleur.
 */
const TEAM_PHOTO_FILE: Record<string, string> = {
  fabian: "fabian", jarno: "jarno", jiska: "jeska", jeska: "jeska",
  max: "max", milou: "milou", nynke: "nynke", quinn: "quinn",
  rutger: "rutger", sem: "sem",
};
function teamPhoto(fullName: string): string | undefined {
  const first = fullName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const file = TEAM_PHOTO_FILE[first];
  return file ? `/team/${file}.png` : undefined;
}

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

  // Vaste medewerkers = het kernteam (Janno, Milou, Jiska, Rutger). De rest
  // (editors, content creators, overige videografen) tonen we als freelancers.
  const core = people
    .filter((p) => isCoreStaff(p.email))
    .sort((a, b) => coreStaffRank(a.email) - coreStaffRank(b.email));
  const freelancers = people
    .filter((p) => !isCoreStaff(p.email))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const PersonCard = (p: (typeof people)[number], vast: boolean) => {
    const open = Number(p.openVideos);
    const capacity = p.weeklyVideoCapacity;
    const load = capacity > 0 ? (open / capacity) * 100 : 0;
    const overloaded = capacity > 0 && open > capacity;
    const availability =
      capacity === 0
        ? { label: "Geen editcapaciteit", tone: "neutral" as const }
        : overloaded
          ? { label: `Overbelast · ${pct(load, 0)}`, tone: "bad" as const }
          : load > 80
            ? { label: `Vol · ${pct(load, 0)}`, tone: "warn" as const }
            : { label: `Ruimte · ${pct(load, 0)}`, tone: "good" as const };
    const overdue = Number(p.overdueTasks);
    return (
      <div
        key={p.id}
        className="flex flex-col rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-4"
        style={
          vast
            ? { borderColor: "color-mix(in srgb, var(--color-indigo-ink) 30%, var(--color-line))", boxShadow: "inset 3px 0 0 var(--color-indigo-ink)" }
            : { borderColor: "var(--color-line)" }
        }
      >
        <div className="flex items-start gap-3">
          <Avatar name={p.fullName} color={p.color} size={42} src={teamPhoto(p.fullName)} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-semibold">{p.fullName}</span>
              {p.status === "suspended" ? <Badge tone="neutral">Gedeactiveerd</Badge> : null}
            </div>
            <div className="truncate text-xs text-[var(--color-ink-muted)]">{p.jobTitle ?? ROLE_LABELS[p.role] ?? p.role}</div>
            <div className="mt-1.5">
              <Badge tone={availability.tone}>{availability.label}</Badge>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
          <MiniStat label="Open taken" value={Number(p.openTasks)} tone={overdue > 0 ? "var(--color-bad)" : undefined} hint={overdue > 0 ? `${overdue} te laat` : undefined} />
          <MiniStat label="In bewerking" value={open} />
          <MiniStat label="Opnames" value={Number(p.upcomingShoots)} />
        </div>

        {canWrite ? (
          <div className="mt-3 flex justify-end border-t border-[var(--color-line)] pt-2">
            <Link href={`/team/${p.id}/edit`} className="text-xs font-medium text-[var(--color-brand-600)] hover:underline">Bewerken</Link>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="Team"
        description="Vaste medewerkers en freelancers, met beschikbaarheid en openstaand werk in één oogopslag."
        actions={canWrite ? <LinkButton href="/team/new">Nieuw teamlid</LinkButton> : undefined}
      />

      <div className="mb-2 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-indigo-ink)]" />
        <h2 className="text-sm font-semibold tracking-tight">Vaste medewerkers</h2>
        <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]">{core.length}</span>
      </div>
      {core.length === 0 ? (
        <Card className="mb-6"><EmptyState title="Geen vaste medewerkers gevonden" /></Card>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {core.map((p) => PersonCard(p, true))}
        </div>
      )}

      <div className="mb-2 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-warn)]" />
        <h2 className="text-sm font-semibold tracking-tight">Freelancers &amp; overig team</h2>
        <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]">{freelancers.length}</span>
      </div>
      {freelancers.length === 0 ? (
        <Card className="mb-6"><EmptyState title="Geen freelancers" /></Card>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {freelancers.map((p) => PersonCard(p, false))}
        </div>
      )}

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
