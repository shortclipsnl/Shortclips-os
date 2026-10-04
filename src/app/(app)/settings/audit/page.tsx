import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { Badge, Card, EmptyState, Table } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requirePermission("audit:read");

  const rows = await db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.occurredAt))
    .limit(200);

  return (
    <Card padded={false}>
      {rows.length === 0 ? (
        <EmptyState title="Nog geen registraties" />
      ) : (
        <Table
          head={
            <>
              <th className="sc-th">Wanneer</th>
              <th className="sc-th">Wie</th>
              <th className="sc-th">Actie</th>
              <th className="sc-th">Object</th>
              <th className="sc-th">Wijziging</th>
              <th className="sc-th">Resultaat</th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="sc-td whitespace-nowrap text-[var(--color-ink-muted)]">
                {formatDateTime(r.occurredAt)}
              </td>
              <td className="sc-td">{r.actorEmail ?? "systeem"}</td>
              <td className="sc-td font-mono text-xs">{r.action}</td>
              <td className="sc-td text-[var(--color-ink-muted)]">
                {r.entityType ? `${r.entityType}` : "—"}
              </td>
              <td className="sc-td max-w-xs truncate font-mono text-2xs text-[var(--color-ink-muted)]">
                {Object.keys(r.changes as object).length > 0
                  ? JSON.stringify(r.changes)
                  : "—"}
              </td>
              <td className="sc-td">
                <Badge tone={r.outcome === "allow" ? "good" : "bad"}>
                  {r.outcome === "allow" ? "toegestaan" : "geweigerd"}
                </Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
