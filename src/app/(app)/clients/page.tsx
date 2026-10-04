import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/server/auth/context";
import { listClients } from "@/server/clients";
import { Avatar, Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import {
  euro,
  formatDate,
  num,
} from "@/lib/format";
import { CLIENT_STATUS, RISK_LEVEL } from "@/lib/statuses";

export const metadata: Metadata = { title: "Klanten" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const viewer = await requireInternal();
  const rows = await listClients(viewer);
  const canSeeFinance = viewer.permissions.has("finance:read");

  const totalRevenue = rows
    .filter((r) => r.status === "active")
    .reduce((s, r) => s + Number(r.monthlyRevenue), 0);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Klanten"
        description={
          canSeeFinance
            ? `${rows.length} klanten · ${euro(totalRevenue)} terugkerende maandomzet`
            : `${rows.length} klanten`
        }
      />

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            title="Nog geen klanten"
            description="Klanten verschijnen hier zodra ze zijn aangemaakt of geïmporteerd uit Monday."
          />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Klant</th>
                <th className="sc-th">Coördinator</th>
                <th className="sc-th text-right">Deze maand</th>
                <th className="sc-th text-right">In productie</th>
                <th className="sc-th text-right">Bij klant</th>
                <th className="sc-th">Volgende opname</th>
                {canSeeFinance ? <th className="sc-th text-right">Per maand</th> : null}
                <th className="sc-th">Status</th>
              </>
            }
          >
            {rows.map((c) => {
              const published = Number(c.publishedThisMonth);
              const behind = published < c.monthlyVideoQuota;
              return (
                <tr key={c.id} className="sc-row-link">
                  <td className="sc-td">
                    <Link href={`/clients/${c.slug}`} className="flex items-center gap-3">
                      <Avatar name={c.name} color={c.color} size={30} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                          {c.sector ?? "—"}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="sc-td text-[var(--color-ink-muted)]">
                    {c.coordinatorName ?? "—"}
                  </td>
                  <td className="sc-td text-right tabular-nums">
                    <span className={behind ? "text-[var(--color-warn)]" : undefined}>
                      {published}
                    </span>
                    <span className="text-[var(--color-ink-faint)]">/{c.monthlyVideoQuota}</span>
                  </td>
                  <td className="sc-td text-right tabular-nums">{num(Number(c.inProduction))}</td>
                  <td className="sc-td text-right tabular-nums">
                    {Number(c.awaitingClient) > 0 ? (
                      <Badge tone="lime">{Number(c.awaitingClient)}</Badge>
                    ) : (
                      <span className="text-[var(--color-ink-faint)]">–</span>
                    )}
                  </td>
                  <td className="sc-td">
                    {c.nextShoot ? (
                      <span className="text-[var(--color-ink-muted)]">
                        {formatDate(c.nextShoot)}
                      </span>
                    ) : (
                      <Badge tone="warn">niet gepland</Badge>
                    )}
                  </td>
                  {canSeeFinance ? (
                    <td className="sc-td text-right tabular-nums">{euro(c.monthlyRevenue)}</td>
                  ) : null}
                  <td className="sc-td">
                    {c.riskLevel !== "none" ? (
                      <Badge tone={RISK_LEVEL[c.riskLevel]?.tone ?? "neutral"}>
                        {RISK_LEVEL[c.riskLevel]?.label}
                      </Badge>
                    ) : (
                      <Badge tone={CLIENT_STATUS[c.status]?.tone ?? "neutral"}>
                        {CLIENT_STATUS[c.status]?.label ?? c.status}
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
