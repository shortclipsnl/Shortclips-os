import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { Card, CardHeader, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { euro, num } from "@/lib/format";

export const metadata: Metadata = { title: "Editkosten & winst" };
export const dynamic = "force-dynamic";

const rows2 = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "short", year: "numeric" });
}

export default async function EditCostsPage() {
  await requirePermission("finance:read");

  // Maandoverzicht: winst per maand over alle klanten (uit de maandstaten).
  const monthAgg = await db.execute(sql`
    select period,
      coalesce(sum(revenue),0)::float rev, coalesce(sum(extra_revenue),0)::float extra,
      coalesce(sum(edit_cost),0)::float edit, coalesce(sum(shoot_cost),0)::float shoot,
      coalesce(sum(strategy_cost),0)::float strat, coalesce(sum(other_cost),0)::float other,
      count(*)::int n
    from client_finance_months group by period order by period
  `);
  type MRow = { period: string; rev: number; extra: number; edit: number; shoot: number; strat: number; other: number; n: number };
  const monthsRaw = rows2<MRow>(monthAgg);
  const months = monthsRaw.map((m) => {
    const income = m.rev + m.extra;
    const manualCosts = m.shoot + m.strat + m.other;
    const net = income - m.edit - manualCosts;
    return { ...m, income, manualCosts, net, hasManual: manualCosts > 0, marginPct: income > 0 ? Math.round((net / income) * 100) : 0 };
  });
  const maxNet = Math.max(1, ...months.map((m) => Math.abs(m.net)));

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
        title="Editkosten & winst"
        description="Editkosten uit Monday en de winst per maand over alle klanten (uit de maandstaten)."
      />

      {/* Winst per maand — alle klanten samen, bouwt zich op naarmate er maanden bijkomen. */}
      <Card padded={false} className="mb-5 overflow-hidden ring-1 ring-[var(--color-indigo-ink)]/15">
        <div className="bg-[var(--color-indigo-ink)] px-5 py-3 text-white">
          <h2 className="text-base font-bold tracking-tight">Winst per maand (alle klanten)</h2>
          <p className="text-xs text-white/70">Omzet + meerwerk − editkosten − directe kosten. De vergelijking groeit elke maand automatisch.</p>
        </div>
        {months.length === 0 ? (
          <EmptyState title="Nog geen maandstaten" description="Zodra de maand-snapshot heeft gedraaid, verschijnt hier de winst per maand." />
        ) : (
          <div className="p-5">
            {/* Staafdiagram netto per maand */}
            <div className="mb-4 flex items-end gap-3 overflow-x-auto" style={{ minHeight: 120 }}>
              {months.map((m) => (
                <div key={m.period} className="flex min-w-14 flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-2xs font-semibold tabular-nums">{euro(m.net)}</span>
                  <span className="w-full rounded-t-[4px] bg-[var(--color-indigo-ink)]" style={{ height: `${Math.max(4, (Math.abs(m.net) / maxNet) * 90)}px` }} />
                  <span className="text-2xs text-[var(--color-ink-muted)]">{monthLabel(m.period)}</span>
                </div>
              ))}
            </div>
            <Table head={<><th className="sc-th">Maand</th><th className="sc-th text-right">Omzet</th><th className="sc-th text-right">Editkosten</th><th className="sc-th text-right">Directe kosten</th><th className="sc-th text-right">Netto</th><th className="sc-th text-right">Marge</th><th className="sc-th text-right">vs vorige</th></>}>
              {months.map((m, i) => {
                const prev = months[i - 1];
                const delta = prev && prev.net !== 0 ? Math.round(((m.net - prev.net) / Math.abs(prev.net)) * 100) : null;
                return (
                  <tr key={m.period}>
                    <td className="sc-td font-medium">{monthLabel(m.period)}</td>
                    <td className="sc-td text-right tabular-nums">{euro(m.income)}</td>
                    <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">−{euro(m.edit)}</td>
                    <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{m.hasManual ? `−${euro(m.manualCosts)}` : <span className="text-[var(--color-ink-faint)]">nog niet ingevuld</span>}</td>
                    <td className="sc-td text-right font-bold tabular-nums">{euro(m.net)}</td>
                    <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{m.marginPct}%</td>
                    <td className="sc-td text-right tabular-nums">{delta == null ? "—" : <span style={{ color: delta >= 0 ? "var(--color-good)" : "var(--color-bad)" }}>{delta >= 0 ? "+" : ""}{delta}%</span>}</td>
                  </tr>
                );
              })}
            </Table>
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">Zolang de directe kosten (opname, strategie, overig) van een maand nog niet zijn ingevuld, is "Netto" de opbrengst ná editkosten — nog niet de volledige nettowinst.</p>
          </div>
        )}
      </Card>

      <div className="mb-3 text-sm font-semibold text-[var(--color-ink-muted)]">Editkosten (verwacht, uit de contracten)</div>
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
