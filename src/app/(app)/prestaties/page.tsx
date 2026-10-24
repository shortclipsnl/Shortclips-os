import type { Metadata } from "next";
import { AlertTriangle, Clock } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader, Stat, Table, TeamAvatar } from "@/components/ui";
import { getDeadlinePerformance, getDeadlinePerformanceTotals } from "@/server/deadline-performance";

export const metadata: Metadata = { title: "Deadlineprestaties" };
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "Eigenaar", admin: "Beheer", project_coordinator: "Coördinator",
  content_creator: "Content", videographer: "Videograaf", editor: "Editor", finance: "Finance",
};

export default async function DeadlinePerformancePage() {
  const [rows, totals] = await Promise.all([getDeadlinePerformance(), getDeadlinePerformanceTotals()]);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Deadlineprestaties"
        description="Hoe vaak een deadline is gemist en hoeveel dagen te laat, per editor en medewerker. Automatisch bijgehouden uit video's en taken; de historie blijft bewaard."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Nu te laat" value={String(totals.currentlyLate)} tone={totals.currentlyLate > 0 ? "bad" : "good"} />
        <Stat label="Gemiste deadlines (totaal)" value={String(totals.totalMisses)} />
        <Stat label="Personen met missers" value={String(totals.people)} />
      </div>

      <Card padded={false}>
        <CardHeader
          title="Per editor & medewerker"
          subtitle="Meeste openstaande te-laat-gevallen bovenaan. 'Gemiddeld te laat' en 'Langst te laat' tellen zowel afgeronde als lopende missers mee."
          className="p-5 pb-2"
        />
        {rows.length === 0 ? (
          <EmptyState
            title="Nog geen gemiste deadlines geregistreerd"
            description="Zodra een video of taak over de deadline gaat, verschijnt het hier. De registratie draait elke nacht automatisch."
          />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Persoon</th>
                <th className="sc-th text-right">Nu te laat</th>
                <th className="sc-th text-right">Totaal gemist</th>
                <th className="sc-th text-right">Video&apos;s / taken</th>
                <th className="sc-th text-right">Gem. te laat</th>
                <th className="sc-th text-right">Langst te laat</th>
              </>
            }
          >
            {rows.map((r) => (
              <tr key={r.userId ?? r.name} style={r.currentlyLate > 0 ? { boxShadow: "inset 3px 0 0 var(--color-bad)" } : undefined}>
                <td className="sc-td">
                  <span className="flex items-center gap-2 font-medium">
                    <TeamAvatar name={r.name} avatarUrl={r.avatarUrl} size={24} />
                    <span>
                      {r.name}
                      {r.role ? <span className="ml-1.5 text-2xs font-normal text-[var(--color-ink-faint)]">{ROLE_LABEL[r.role] ?? r.role}</span> : null}
                    </span>
                  </span>
                </td>
                <td className="sc-td text-right tabular-nums">
                  {r.currentlyLate > 0 ? (
                    <span className="inline-flex items-center gap-1 font-bold text-[var(--color-bad)]"><AlertTriangle className="size-3.5" />{r.currentlyLate}</span>
                  ) : <span className="text-[var(--color-ink-faint)]">0</span>}
                </td>
                <td className="sc-td text-right font-semibold tabular-nums">{r.totalMisses}</td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{r.videoMisses} / {r.taskMisses}</td>
                <td className="sc-td text-right tabular-nums">
                  <span className="inline-flex items-center gap-1" style={{ color: r.avgDaysLate >= 3 ? "var(--color-bad)" : r.avgDaysLate >= 1 ? "var(--color-warn)" : "var(--color-ink)" }}>
                    <Clock className="size-3.5 opacity-70" />{r.avgDaysLate} d
                  </span>
                </td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{r.maxDaysLate} d</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="px-5 py-3 text-xs text-[var(--color-ink-muted)]">
          Een gemiste deadline wordt geteld zodra een eerste videoversie over de interne deadline (opname + 7 werkdagen) gaat, of een taak over zijn deadline. &quot;Dagen te laat&quot; loopt op tot het is afgerond en wordt dan vastgezet.
        </p>
      </Card>
    </div>
  );
}
