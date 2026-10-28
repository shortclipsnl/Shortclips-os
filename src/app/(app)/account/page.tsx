import type { Metadata } from "next";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { requireViewer } from "@/server/auth/context";
import { Avatar, Badge, Card, CardHeader, PageHeader, Table } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { getMyActivity } from "@/server/my-activity";
import { ChangePasswordCard } from "./change-password";

export const metadata: Metadata = { title: "Mijn account" };
export const dynamic = "force-dynamic";

/** Minuten → "Xu Ym" / "Ym" / "0m". */
function fmtDuration(min: number): string {
  const m = Math.round(min);
  if (m <= 0) return "0m";
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return rest === 0 ? `${h}u` : `${h}u ${rest}m`;
}

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

  const activity = await getMyActivity(viewer, 14);

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
              title="Mijn activiteit & uren"
              subtitle="Automatische schatting op basis van je handelingen in het portaal (laatste 14 dagen). Opname-uren zijn gemeten; de rest is een schatting uit de tijd tussen je handelingen."
            />
          </div>
          {activity.days.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-[var(--color-ink-muted)]">Nog geen activiteit vastgelegd in deze periode.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {activity.days.map((d) => (
                <li key={d.date} className="px-5 py-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold capitalize text-[var(--color-ink)]">{d.label}</span>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--color-ink)]">
                      {fmtDuration(d.totalMinutes)}
                      <span className="ml-1 text-2xs font-normal text-[var(--color-ink-faint)]">± totaal</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.shootMinutes > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-600)]/12 px-2 py-0.5 text-2xs font-medium text-[var(--color-brand-700)]">
                        Opnames (gemeten) · {fmtDuration(d.shootMinutes)}
                      </span>
                    ) : null}
                    {d.categories.map((c) => (
                      <span key={c.category} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-2xs text-[var(--color-ink-muted)]">
                        <span className="font-medium text-[var(--color-ink)]">{c.category}</span>
                        <span className="tabular-nums">{fmtDuration(c.minutes)}</span>
                        <span className="text-[var(--color-ink-faint)]">· {c.count}×</span>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <ChangePasswordCard />

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
