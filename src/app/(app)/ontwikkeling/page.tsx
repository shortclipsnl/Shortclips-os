import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, EmptyState, PageHeader, Stat, Table, TeamAvatar } from "@/components/ui";
import { requireInternal } from "@/server/auth/context";
import { canSeeTeamDevelopment, listTeamDevelopment } from "@/server/development";

export const metadata: Metadata = { title: "Ontwikkeling" };
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "Eigenaar", admin: "Beheer", project_coordinator: "Coördinator",
  content_creator: "Content", videographer: "Videograaf", editor: "Editor", finance: "Finance",
};

export default async function DevelopmentOverviewPage() {
  const viewer = await requireInternal();
  // Medewerkers zonder teaminzicht gaan direct naar hun eigen ontwikkelpunten.
  if (!canSeeTeamDevelopment(viewer)) redirect(`/ontwikkeling/${viewer.id}`);

  const people = await listTeamDevelopment();
  const metFouten = people.filter((p) => p.openFouten > 0).length;
  const metPunten = people.filter((p) => p.openPunten > 0).length;

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Ontwikkeling"
        description="Persoonlijke ontwikkelpunten per medewerker, op basis van de echte cijfers, feedback en correctierondes. Help iedereen groeien en zie of terugkerende fouten minder vaak voorkomen."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Medewerkers" value={String(people.length)} />
        <Stat label="Met open ontwikkelpunten" value={String(metPunten)} />
        <Stat label="Met open fouten" value={String(metFouten)} tone={metFouten > 0 ? "warn" : "good"} />
      </div>

      <Card padded={false}>
        <CardHeader title="Per medewerker" subtitle="Klik een medewerker aan voor de ontwikkelpunten, AI-analyse en voortgang." className="p-5 pb-2" />
        {people.length === 0 ? (
          <EmptyState title="Geen medewerkers gevonden" description="Zodra er actieve interne medewerkers zijn, verschijnen ze hier." />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Medewerker</th>
                <th className="sc-th text-right">Open punten</th>
                <th className="sc-th text-right">Open fouten</th>
                <th className="sc-th text-right">Laatste analyse</th>
              </>
            }
          >
            {people.map((p) => (
              <tr key={p.id} style={p.openFouten > 0 ? { boxShadow: "inset 3px 0 0 var(--color-warn)" } : undefined}>
                <td className="sc-td">
                  <Link href={`/ontwikkeling/${p.id}`} className="flex items-center gap-2 font-medium hover:underline">
                    <TeamAvatar name={p.fullName} avatarUrl={p.avatarUrl} size={24} />
                    <span>
                      {p.fullName}
                      <span className="ml-1.5 text-2xs font-normal text-[var(--color-ink-faint)]">{ROLE_LABEL[p.role] ?? p.role}</span>
                    </span>
                  </Link>
                </td>
                <td className="sc-td text-right font-semibold tabular-nums">{p.openPunten}</td>
                <td className="sc-td text-right tabular-nums">
                  {p.openFouten > 0 ? <span className="font-bold text-[var(--color-warn)]">{p.openFouten}</span> : <span className="text-[var(--color-ink-faint)]">0</span>}
                </td>
                <td className="sc-td text-right text-xs text-[var(--color-ink-muted)]">
                  {p.laatsteAnalyse ? new Date(p.laatsteAnalyse).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="px-5 py-3 text-xs text-[var(--color-ink-muted)]">
          Ontwikkelpunten komen uit de AI-analyse van de eigen cijfers (interne revisies, deadlines, feedback) en uit handmatige invoer. Klantvoorkeuren worden nooit als fout van de medewerker geteld. De AI trekt geen conclusies zonder voldoende gegevens.
        </p>
      </Card>
    </div>
  );
}
