import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/server/auth/context";
import { listScripts } from "@/server/scripts";
import { Avatar, Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { formatDate, relativeDays } from "@/lib/format";
import { SCRIPT_STATUS } from "@/lib/statuses";

export const metadata: Metadata = { title: "Scripts" };
export const dynamic = "force-dynamic";

const STATUS_FILTERS = ["idea", "concept", "internal_review", "client_review", "revising", "approved", "ready_to_shoot", "shot"];

export default async function ScriptsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; klant?: string }>;
}) {
  const viewer = await requireInternal();
  const params = await searchParams;
  const rows = await listScripts(viewer, { status: params.status, clientSlug: params.klant });

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Scripts" description={`${rows.length} scripts`} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/scripts"
          className={
            !params.status
              ? "rounded-full bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white"
              : "rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)]"
          }
        >
          Alle
        </Link>
        {STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={`/scripts?status=${s}`}
            className={
              params.status === s
                ? "rounded-full bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white"
                : "rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            }
          >
            {SCRIPT_STATUS[s]?.label ?? s}
          </Link>
        ))}
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="Geen scripts in deze selectie" />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Script</th>
                <th className="sc-th">Klant</th>
                <th className="sc-th">Pijler</th>
                <th className="sc-th">Status</th>
                <th className="sc-th">Opname</th>
                <th className="sc-th">Versie</th>
                <th className="sc-th">Bijgewerkt</th>
              </>
            }
          >
            {rows.map((s) => (
              <tr key={s.id} className="sc-row-link">
                <td className="sc-td">
                  <Link href={`/scripts/${s.id}`} className="font-medium hover:underline">
                    {s.title}
                  </Link>
                </td>
                <td className="sc-td">
                  <span className="flex items-center gap-2 text-[var(--color-ink-muted)]">
                    <Avatar name={s.clientName} color={s.clientColor} size={20} />
                    {s.clientName}
                  </span>
                </td>
                <td className="sc-td text-[var(--color-ink-muted)]">{s.pillar ?? "—"}</td>
                <td className="sc-td">
                  <Badge tone={SCRIPT_STATUS[s.status]?.tone ?? "neutral"}>
                    {SCRIPT_STATUS[s.status]?.label ?? s.status}
                  </Badge>
                </td>
                <td className="sc-td text-[var(--color-ink-muted)]">
                  {s.shootOn ? formatDate(s.shootOn) : "—"}
                </td>
                <td className="sc-td tabular-nums">v{s.currentVersion}</td>
                <td className="sc-td text-[var(--color-ink-muted)]">{relativeDays(s.updatedAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
