import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { Card, CardHeader, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { euro, num } from "@/lib/format";

export const metadata: Metadata = { title: "Editkosten" };
export const dynamic = "force-dynamic";

export default async function EditCostsPage() {
  await requirePermission("finance:read");

  const rows = await db
    .select({
      slug: clients.slug,
      name: clients.name,
      color: clients.color,
      shorts: clients.monthlyVideoQuota,
      editPer: clients.editCostPerVideo,
      editor: clients.editorName,
      revenue: clients.monthlyRevenue,
    })
    .from(clients)
    .where(and(isNull(clients.deletedAt), eq(clients.status, "active")))
    .orderBy(asc(clients.name));

  type Row = (typeof rows)[number] & { cost: number; known: boolean };
  const enriched: Row[] = rows.map((r) => {
    const editPer = r.editPer != null ? Number(r.editPer) : null;
    const known = editPer != null && r.shorts > 0;
    return { ...r, cost: known ? editPer! * r.shorts : 0, known };
  });

  const withCost = enriched.filter((r) => r.known);
  const missing = enriched.filter((r) => !r.known);
  const totalMonth = withCost.reduce((a, r) => a + r.cost, 0);
  const totalShorts = withCost.reduce((a, r) => a + r.shorts, 0);
  const avgPerShort = totalShorts > 0 ? totalMonth / totalShorts : 0;

  // Per editor aggregeren.
  const byEditorMap = new Map<string, { cost: number; shorts: number; clients: number }>();
  for (const r of withCost) {
    const key = r.editor?.trim() || "Niet toegewezen";
    const e = byEditorMap.get(key) ?? { cost: 0, shorts: 0, clients: 0 };
    e.cost += r.cost;
    e.shorts += r.shorts;
    e.clients += 1;
    byEditorMap.set(key, e);
  }
  const byEditor = [...byEditorMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cost - a.cost);
  const maxEditor = Math.max(1, ...byEditor.map((e) => e.cost));

  const topClients = [...withCost].sort((a, b) => b.cost - a.cost);
  const maxClient = Math.max(1, ...topClients.map((r) => r.cost));

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Editkosten"
        description="Verwachte maandelijkse editkosten op basis van de contracten in Monday (editkosten per short × shorts per maand)."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Totale editkosten / maand" value={euro(totalMonth)} hint="actieve klanten" />
        <Stat label="Shorts per maand" value={num(totalShorts)} hint="afgerekende edits/maand" />
        <Stat label="Gem. per short" value={euro(avgPerShort)} />
        <Stat label="Editors actief" value={num(byEditor.filter((e) => e.name !== "Niet toegewezen").length)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* Per editor */}
        <Card padded={false}>
          <CardHeader title="Editkosten per editor" className="p-5 pb-2" />
          {byEditor.length === 0 ? (
            <EmptyState title="Nog geen gegevens" />
          ) : (
            <div className="space-y-2.5 p-5 pt-1">
              {byEditor.map((e) => (
                <div key={e.name} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-sm font-medium">{e.name}</span>
                  <span className="h-4 rounded-full bg-[var(--color-indigo-ink)]" style={{ width: `${Math.max(4, (e.cost / maxEditor) * 100)}%` }} />
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{euro(e.cost)}</span>
                  <span className="shrink-0 text-2xs text-[var(--color-ink-faint)]">{e.shorts} shorts · {e.clients} klanten</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Per klant */}
        <Card padded={false}>
          <CardHeader title="Editkosten per klant" className="p-5 pb-2" />
          {topClients.length === 0 ? (
            <EmptyState title="Nog geen gegevens" />
          ) : (
            <Table head={<><th className="sc-th">Klant</th><th className="sc-th">Editor</th><th className="sc-th text-right">Shorts</th><th className="sc-th text-right">Per short</th><th className="sc-th text-right">Per maand</th></>}>
              {topClients.map((r) => (
                <tr key={r.slug} className="sc-row-link">
                  <td className="sc-td"><Link href={`/clients/${r.slug}?tab=financieel`} className="font-medium hover:underline">{r.name}</Link></td>
                  <td className="sc-td text-[var(--color-ink-muted)]">{r.editor ?? "—"}</td>
                  <td className="sc-td text-right tabular-nums">{r.shorts}</td>
                  <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{euro(Number(r.editPer))}</td>
                  <td className="sc-td text-right font-semibold tabular-nums">{euro(r.cost)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {missing.length > 0 ? (
        <Card className="mt-5" padded={false}>
          <CardHeader title={`Nog geen editkosten bekend (${missing.length})`} subtitle="Deze klanten missen editkosten per short of shorts per maand in Monday — niet meegeteld." className="p-5 pb-2" />
          <div className="flex flex-wrap gap-1.5 p-5 pt-1">
            {missing.map((r) => (
              <Link key={r.slug} href={`/clients/${r.slug}?tab=financieel`} className="rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">{r.name}</Link>
            ))}
          </div>
        </Card>
      ) : null}

      <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
        Dit zijn de <strong>verwachte</strong> editkosten per maand op basis van de afspraken in Monday, zonder dubbeltelling
        (één bedrag per klant). De werkelijke afgerekende edits per maand en de vergelijking tussen maanden worden pas mogelijk
        zodra elke afgeronde edit als kostenregel wordt vastgelegd — die historie is nog niet beschikbaar.
      </p>
    </div>
  );
}
