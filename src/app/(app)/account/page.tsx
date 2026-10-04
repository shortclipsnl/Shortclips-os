import type { Metadata } from "next";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { requireViewer } from "@/server/auth/context";
import { Avatar, Badge, Card, CardHeader, PageHeader, Table } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Mijn account" };
export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  owner: "Eigenaar",
  admin: "Beheerder",
  project_coordinator: "Projectcoördinator",
  content_creator: "Content creator",
  videographer: "Videograaf",
  editor: "Editor",
  finance: "Finance",
  client: "Klant",
};

export default async function AccountPage() {
  const viewer = await requireViewer();

  const active = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, viewer.id), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.lastSeenAt))
    .limit(10);

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader title="Mijn account" />

      <div className="space-y-5">
        <Card>
          <div className="flex items-center gap-4">
            <Avatar name={viewer.fullName} size={52} />
            <div>
              <p className="text-lg font-semibold">{viewer.fullName}</p>
              <p className="text-sm text-[var(--color-ink-muted)]">{viewer.email}</p>
              <Badge tone="info" className="mt-1.5">
                {ROLE_LABELS[viewer.primaryRole] ?? viewer.primaryRole}
              </Badge>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Jouw toegang"
            subtitle={
              viewer.clientScope === null
                ? "Je ziet alle klanten."
                : `Je ziet ${viewer.clientScope.length} klant(en).`
            }
          />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[...viewer.permissions].sort().map((p) => (
              <code
                key={p}
                className="rounded bg-[var(--color-surface-sunken)] px-1.5 py-0.5 font-mono text-2xs text-[var(--color-ink-muted)]"
              >
                {p}
              </code>
            ))}
          </div>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader
              title="Actieve sessies"
              subtitle="Herken je een sessie niet? Meld dat bij een beheerder."
            />
          </div>
          <Table
            head={
              <>
                <th className="sc-th">Laatst gezien</th>
                <th className="sc-th">Verloopt</th>
                <th className="sc-th">IP-adres</th>
                <th className="sc-th">Browser</th>
              </>
            }
          >
            {active.map((s) => (
              <tr key={s.id}>
                <td className="sc-td text-[var(--color-ink-muted)]">
                  {formatDateTime(s.lastSeenAt)}
                </td>
                <td className="sc-td text-[var(--color-ink-muted)]">
                  {formatDateTime(s.expiresAt)}
                </td>
                <td className="sc-td font-mono text-xs">{s.ipAddress ?? "—"}</td>
                <td className="sc-td max-w-xs truncate text-xs text-[var(--color-ink-muted)]">
                  {s.userAgent ?? "—"}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}
