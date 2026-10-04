import type { Metadata } from "next";
import {
  desc,
  eq,
  isNull,
} from "drizzle-orm";
import { db } from "@/db/client";
import { clients, importCandidates, importRuns } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { INTEGRATION_LABEL } from "@/lib/statuses";
import { CandidateRow, ConfirmImportButton, DryRunStarter } from "./wizard";

export const metadata: Metadata = { title: "Importeren" };
export const dynamic = "force-dynamic";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  await requirePermission("import:run");
  const params = await searchParams;

  const runs = await db
    .select()
    .from(importRuns)
    .orderBy(desc(importRuns.createdAt))
    .limit(10);

  const activeRun = params.run
    ? runs.find((r) => r.id === params.run)
    : runs.find((r) => r.status === "dry_run");

  const [candidates, clientList] = await Promise.all([
    activeRun
      ? db.select().from(importCandidates)
          .where(eq(importCandidates.runId, activeRun.id))
          .orderBy(desc(importCandidates.matchScore))
      : Promise.resolve([]),
    db.select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(isNull(clients.deletedAt))
      .orderBy(clients.name),
  ]);

  const summaries =
    (activeRun?.summary as { summaries?: Array<Record<string, unknown>> })?.summaries ?? [];
  const pendingCount = candidates.filter((c) => c.decision === "pending").length;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Bestaande data importeren"
        description="Eerst kijken, dan pas overnemen. Bij twijfel beslis jij."
      />

      <Card className="mb-5">
        <CardHeader
          title="Stap 1 — Dry run"
          subtitle="Kijk wat er in Monday, Frame.io en Drive staat en welke klanten daarbij horen."
        />
        <div className="mt-4">
          <DryRunStarter />
        </div>
      </Card>

      {activeRun ? (
        <>
          <Card className="mb-5">
            <CardHeader
              title="Stap 2 — Resultaat van de dry run"
              subtitle={`Uitgevoerd op ${formatDateTime(activeRun.createdAt)}`}
              action={
                <Badge tone={activeRun.status === "committed" ? "good" : "info"}>
                  {activeRun.status === "committed" ? "uitgevoerd" : "in beoordeling"}
                </Badge>
              }
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {summaries.map((s, i) => {
                const found = (s.found ?? {}) as Record<string, number>;
                const notes = (s.notes ?? []) as string[];
                return (
                  <div key={i} className="rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] p-4">
                    <p className="text-sm font-semibold">
                      {INTEGRATION_LABEL[String(s.provider)] ?? String(s.provider)}
                    </p>
                    <dl className="mt-2 space-y-1 text-sm text-[var(--color-ink-muted)]">
                      {Object.entries(found).map(([key, value]) => (
                        <div key={key} className="flex justify-between">
                          <dt>{key === "boards" ? "boards" : key === "projects" ? "projecten" : "mappen"}</dt>
                          <dd className="font-medium text-[var(--color-ink)]">{value}</dd>
                        </div>
                      ))}
                      <div className="flex justify-between">
                        <dt>voorstellen</dt>
                        <dd className="font-medium text-[var(--color-ink)]">{String(s.suggestions ?? 0)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>conflicten</dt>
                        <dd className="font-medium text-[var(--color-warn)]">{String(s.conflicts ?? 0)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>zonder match</dt>
                        <dd className="font-medium text-[var(--color-ink)]">{String(s.missingMappings ?? 0)}</dd>
                      </div>
                    </dl>
                    {notes.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-[var(--color-warn)]">
                        {notes.map((n, j) => (
                          <li key={j}>{n}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card padded={false}>
            <div className="p-5 pb-3">
              <CardHeader
                title="Stap 3 — Beoordelen en koppelen"
                subtitle="Kies per regel: koppelen aan een bestaande klant, nieuw aanmaken, of overslaan."
              />
            </div>
            {candidates.length === 0 ? (
              <EmptyState
                title="Geen kandidaten gevonden"
                description="Controleer of de koppelingen zijn ingesteld en of er data beschikbaar is."
              />
            ) : (
              <>
                <Table
                  head={
                    <>
                      <th className="sc-th">Extern object</th>
                      <th className="sc-th">Koppelen aan</th>
                      <th className="sc-th text-center">Zekerheid</th>
                      <th className="sc-th">Beslissing</th>
                    </>
                  }
                >
                  {candidates.map((c) => (
                    <CandidateRow key={c.id} candidate={c} clients={clientList} />
                  ))}
                </Table>
                {activeRun.status !== "committed" ? (
                  <div className="border-t border-[var(--color-line)] p-5">
                    <ConfirmImportButton runId={activeRun.id} pendingCount={pendingCount} />
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </>
      ) : null}

      {runs.length > 0 ? (
        <Card className="mt-5" padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Eerdere runs" />
          </div>
          <Table
            head={
              <>
                <th className="sc-th">Systemen</th>
                <th className="sc-th">Status</th>
                <th className="sc-th">Gestart</th>
                <th className="sc-th">Uitgevoerd</th>
              </>
            }
          >
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="sc-td font-medium">{r.provider}</td>
                <td className="sc-td">
                  <Badge tone={r.status === "committed" ? "good" : r.status === "failed" ? "bad" : "info"}>
                    {r.status}
                  </Badge>
                </td>
                <td className="sc-td text-[var(--color-ink-muted)]">{formatDateTime(r.createdAt)}</td>
                <td className="sc-td text-[var(--color-ink-muted)]">
                  {r.committedAt ? formatDateTime(r.committedAt) : "—"}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
