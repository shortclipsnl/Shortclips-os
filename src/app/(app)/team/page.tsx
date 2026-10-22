import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  teamMembers,
  users,
} from "@/db/schema";
import { requirePermission, isOwner } from "@/server/auth/context";
import { isCoreStaff, coreStaffRank } from "@/server/core-staff";
import { isBoardEditorName } from "@/lib/editors";
import { getEditorHighestAwards } from "@/server/awards/service";
import { awardByKey } from "@/server/awards/config";
import { AwardBadge } from "@/app/(app)/showcase/award-badge";
import { TeamLogins } from "./team-logins";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  Table,
  TeamAvatar,
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
  const owner = isOwner(viewer);

  const [people, editorStats, highestAwards] = await Promise.all([
    db.select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      avatarUrl: users.avatarUrl,
      role: users.primaryRole,
      status: users.status,
      jobTitle: teamMembers.jobTitle,
      color: teamMembers.color,
      weeklyVideoCapacity: teamMembers.weeklyVideoCapacity,
      isInternal: teamMembers.isInternal,
      availabilityNote: users.availabilityNote,
      // Alleen nog nodig voor de beschikbaarheid van editors (ruimte/vol).
      openVideos: sql<number>`(
        select count(*) from deliverables d
        where d.editor_id = users.id and d.deleted_at is null
          and d.status in ('editing','editor_revision','awaiting_editor')
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

    getEditorHighestAwards(),
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
    // Beschikbaarheid tonen we alleen waar het betekenis heeft (editcapaciteit).
    const availability =
      capacity <= 0
        ? null
        : overloaded
          ? { label: `Overbelast · ${pct(load, 0)}`, tone: "bad" as const }
          : load > 80
            ? { label: `Vol · ${pct(load, 0)}`, tone: "warn" as const }
            : { label: `Ruimte · ${pct(load, 0)}`, tone: "good" as const };
    const accent = vast ? "var(--color-indigo-ink)" : "var(--color-warn)";
    return (
      <div
        key={p.id}
        className="relative flex flex-col items-center overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-surface)] px-4 pb-4 pt-6 text-center"
        style={{
          borderColor: vast
            ? "color-mix(in srgb, var(--color-indigo-ink) 30%, var(--color-line))"
            : "var(--color-line)",
        }}
      >
        {/* Kleurstrip bovenaan: navy = vaste medewerker, oranje = freelancer. */}
        <span className="absolute inset-x-0 top-0 h-1.5" style={{ background: accent }} />

        <TeamAvatar name={p.fullName} avatarUrl={p.avatarUrl ?? null} color={p.color} size={vast ? 96 : 76} />

        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          <span className="font-semibold leading-tight">{p.fullName}</span>
          {p.status === "suspended" ? <Badge tone="neutral">Gedeactiveerd</Badge> : null}
        </div>
        {/* De vaste short-video-editors (Quinn, Noah, Sam, Senna, Fabian) tonen
            we als "Short Video Editor", niet als creative. */}
        <div className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{isBoardEditorName(p.fullName) ? "Short Video Editor" : p.jobTitle ?? ROLE_LABELS[p.role] ?? p.role}</div>

        {/* Hoogste behaalde award (Showcase). */}
        {(() => {
          const tier = highestAwards[p.id] ? awardByKey(highestAwards[p.id]!) : null;
          return tier ? (
            <div className="mt-2 flex items-center gap-1.5" title={`Hoogste award: ${tier.name}`}>
              <AwardBadge tier={tier} earned size={26} />
              <span className="text-2xs font-medium text-[var(--color-ink-muted)]">{tier.name}</span>
            </div>
          ) : null;
        })()}

        {availability ? (
          <div className="mt-2">
            <Badge tone={availability.tone}>{availability.label}</Badge>
          </div>
        ) : null}

        {p.availabilityNote ? (
          <p className="mt-2 w-full rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-2.5 py-1.5 text-2xs leading-snug text-[#8a5300]">
            <span className="font-semibold">Niet beschikbaar:</span> {p.availabilityNote}
          </p>
        ) : null}

        {canWrite ? (
          <Link href={`/team/${p.id}/edit`} className="mt-3 text-xs font-medium text-[var(--color-brand-600)] hover:underline">
            Bewerken
          </Link>
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

      {owner ? (
        <TeamLogins
          members={[...core, ...freelancers]
            .filter((p) => p.role !== "owner")
            .map((p) => ({ id: p.id, fullName: p.fullName, email: p.email, role: p.role }))}
        />
      ) : null}

      <div className="mb-3 flex items-center gap-3 border-l-4 border-[var(--color-indigo-ink)] pl-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">Vaste medewerkers</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">Het vaste kernteam</p>
        </div>
        <span className="ml-auto rounded-full bg-[var(--color-indigo-ink)] px-2.5 py-0.5 text-xs font-semibold text-white">{core.length}</span>
      </div>
      {core.length === 0 ? (
        <Card className="mb-6"><EmptyState title="Geen vaste medewerkers gevonden" /></Card>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {core.map((p) => PersonCard(p, true))}
        </div>
      )}

      <div className="mb-3 mt-8 flex items-center gap-3 border-l-4 border-[var(--color-warn)] pl-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">Freelancers &amp; overig team</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">Flexibele inzet</p>
        </div>
        <span className="ml-auto rounded-full bg-[var(--color-warn)] px-2.5 py-0.5 text-xs font-semibold text-white">{freelancers.length}</span>
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
                    <TeamAvatar name={String(e.display_name)} size={24} />
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
