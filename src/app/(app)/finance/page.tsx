import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  invoices,
  revenueSnapshots,
} from "@/db/schema";
import { requirePermission, scopeToClients } from "@/server/auth/context";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { currentPeriod, euro, formatDate, periodLabel, pct } from "@/lib/format";
import { INVOICE_STATUS } from "@/lib/statuses";

export const metadata: Metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const viewer = await requirePermission("finance:read");
  const canSeeCosts = viewer.permissions.has("finance:read_costs");
  const period = currentPeriod();

  const [invoiceRows, clientRevenue, history] = await Promise.all([
    db.select({
      id: invoices.id, number: invoices.number, status: invoices.status,
      total: invoices.total, amountPaid: invoices.amountPaid,
      issuedOn: invoices.issuedOn, dueOn: invoices.dueOn, period: invoices.period,
      clientName: clients.name, clientSlug: clients.slug, clientColor: clients.color,
    })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(and(isNull(invoices.deletedAt), scopeToClients(viewer, invoices.clientId)))
      .orderBy(desc(invoices.issuedOn))
      .limit(60),

    db.select({
      id: clients.id, name: clients.name, slug: clients.slug, color: clients.color,
      status: clients.status, monthlyRevenue: clients.monthlyRevenue,
      quota: clients.monthlyVideoQuota,
      editorCost: sql<string>`(
        select coalesce(sum(ec.amount), 0) from editor_costs ec
        where ec.client_id = clients.id and ec.period = ${period}
      )`,
      deliveredThisMonth: sql<number>`(
        select count(*) from deliverables d
        where d.client_id = clients.id and d.deleted_at is null
          and d.published_at >= date_trunc('month', now())
      )`,
    })
      .from(clients)
      .where(and(isNull(clients.deletedAt), eq(clients.status, "active"), scopeToClients(viewer, clients.id)))
      .orderBy(desc(clients.monthlyRevenue)),


    db.select({
      period: revenueSnapshots.period,
      mrr: sql<string>`coalesce(sum(${revenueSnapshots.mrr}), 0)`,
      editorCost: sql<string>`coalesce(sum(${revenueSnapshots.editorCost}), 0)`,
      videos: sql<number>`coalesce(sum(${revenueSnapshots.videosDelivered}), 0)`,
    })
      .from(revenueSnapshots)
      .groupBy(revenueSnapshots.period)
      .orderBy(desc(revenueSnapshots.period))
      .limit(6),
  ]);

  const mrr = clientRevenue.reduce((s, c) => s + Number(c.monthlyRevenue), 0);
  const outstanding = invoiceRows
    .filter((i) => ["sent", "overdue", "partially_paid"].includes(i.status))
    .reduce((s, i) => s + Number(i.total) - Number(i.amountPaid), 0);
  const overdueRows = invoiceRows.filter((i) => i.status === "overdue");
  const overdue = overdueRows.reduce((s, i) => s + Number(i.total), 0);
  const monthCosts = clientRevenue.reduce((s, c) => s + Number(c.editorCost), 0);
  const margin = mrr > 0 ? ((mrr - monthCosts) / mrr) * 100 : 0;

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="Finance"
        description={`${periodLabel(period)} · alleen zichtbaar voor rollen met financiële rechten`}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="MRR" value={euro(mrr)} hint="terugkerende maandomzet" />
        <Stat label="Openstaand" value={euro(outstanding)} hint={`${invoiceRows.filter((i) => i.status !== "paid" && i.status !== "draft").length} facturen`} />
        <Stat
          label="Vervallen"
          value={euro(overdue)}
          hint={`${overdueRows.length} facturen`}
          tone={overdue > 0 ? "bad" : "good"}
        />
        {canSeeCosts ? (
          <>
            <Stat label="Editorkosten" value={euro(monthCosts)} hint="deze maand" />
            <Stat label="Brutomarge" value={pct(margin, 1)} hint="omzet min editkosten" tone={margin > 60 ? "good" : "warn"} />
          </>
        ) : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Per klant" subtitle="Deze maand" />
          </div>
          <Table
            head={
              <>
                <th className="sc-th">Klant</th>
                <th className="sc-th text-right">Omzet</th>
                {canSeeCosts ? <th className="sc-th text-right">Editkosten</th> : null}
                {canSeeCosts ? <th className="sc-th text-right">Marge</th> : null}
                <th className="sc-th text-right">Video&apos;s</th>
              </>
            }
          >
            {clientRevenue.map((c) => {
              const revenue = Number(c.monthlyRevenue);
              const cost = Number(c.editorCost);
              const clientMargin = revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0;
              return (
                <tr key={c.id} className="sc-row-link">
                  <td className="sc-td">
                    <Link href={`/clients/${c.slug}`} className="flex items-center gap-2 hover:underline">
                      <Avatar name={c.name} color={c.color} size={22} />
                      {c.name}
                    </Link>
                  </td>
                  <td className="sc-td text-right tabular-nums">{euro(revenue)}</td>
                  {canSeeCosts ? (
                    <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">
                      {euro(cost)}
                    </td>
                  ) : null}
                  {canSeeCosts ? (
                    <td className="sc-td text-right tabular-nums">
                      <span className={clientMargin < 50 ? "text-[var(--color-warn)]" : undefined}>
                        {pct(clientMargin, 0)}
                      </span>
                    </td>
                  ) : null}
                  <td className="sc-td text-right tabular-nums">
                    {Number(c.deliveredThisMonth)}
                    <span className="text-[var(--color-ink-faint)]">/{c.quota}</span>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Verloop per maand" subtitle="Op basis van maandelijkse snapshots." />
          </div>
          {history.length === 0 ? (
            <EmptyState title="Nog geen historie" />
          ) : (
            <Table
              head={
                <>
                  <th className="sc-th">Periode</th>
                  <th className="sc-th text-right">MRR</th>
                  {canSeeCosts ? <th className="sc-th text-right">Editkosten</th> : null}
                  {canSeeCosts ? <th className="sc-th text-right">Marge</th> : null}
                  <th className="sc-th text-right">Video&apos;s</th>
                </>
              }
            >
              {history.map((h) => {
                const revenue = Number(h.mrr);
                const cost = Number(h.editorCost);
                const m = revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0;
                return (
                  <tr key={h.period}>
                    <td className="sc-td font-medium">{periodLabel(h.period)}</td>
                    <td className="sc-td text-right tabular-nums">{euro(revenue)}</td>
                    {canSeeCosts ? (
                      <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">
                        {euro(cost)}
                      </td>
                    ) : null}
                    {canSeeCosts ? (
                      <td className="sc-td text-right tabular-nums">{pct(m, 0)}</td>
                    ) : null}
                    <td className="sc-td text-right tabular-nums">{Number(h.videos)}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-5" padded={false}>
        <div className="p-5 pb-3">
          <CardHeader title="Facturen" />
        </div>
        {invoiceRows.length === 0 ? (
          <EmptyState title="Geen facturen" />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Nummer</th>
                <th className="sc-th">Klant</th>
                <th className="sc-th">Periode</th>
                <th className="sc-th">Vervalt</th>
                <th className="sc-th text-right">Bedrag</th>
                <th className="sc-th">Status</th>
              </>
            }
          >
            {invoiceRows.map((i) => (
              <tr key={i.id}>
                <td className="sc-td font-medium">{i.number}</td>
                <td className="sc-td">
                  <Link href={`/clients/${i.clientSlug}`} className="flex items-center gap-2 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                    <Avatar name={i.clientName} color={i.clientColor} size={20} />
                    {i.clientName}
                  </Link>
                </td>
                <td className="sc-td text-[var(--color-ink-muted)]">
                  {i.period ? periodLabel(i.period) : "—"}
                </td>
                <td className={`sc-td ${i.status === "overdue" ? "font-medium text-[var(--color-bad)]" : "text-[var(--color-ink-muted)]"}`}>
                  {formatDate(i.dueOn)}
                </td>
                <td className="sc-td text-right tabular-nums">{euro(i.total, true)}</td>
                <td className="sc-td">
                  <Badge tone={INVOICE_STATUS[i.status]?.tone ?? "neutral"}>
                    {INVOICE_STATUS[i.status]?.label ?? i.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
