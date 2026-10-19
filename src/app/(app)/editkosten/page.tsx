import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { Scissors, Film, Coins, Users } from "lucide-react";
import { requirePermission } from "@/server/auth/context";
import { Card, CardHeader, ClientLogo, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { euro, num } from "@/lib/format";

export const metadata: Metadata = { title: "Editkosten & winst" };
export const dynamic = "force-dynamic";

const rows2 = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "short", year: "numeric" });
}

const TONE_COLOR: Record<string, string> = {
  good: "var(--color-good)", bad: "var(--color-bad)", warn: "var(--color-warn)", info: "var(--color-info)", neutral: "var(--color-ink)",
};
function KpiTile({ label, value, hint, tone = "neutral", big = false }: { label: string; value: string; hint?: string; tone?: "good" | "bad" | "warn" | "info" | "neutral"; big?: boolean }) {
  const c = TONE_COLOR[tone]!;
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4" style={{ boxShadow: `inset 4px 0 0 ${c}` }}>
      <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</div>
      <div className={`mt-1 font-bold tabular-nums leading-none ${big ? "text-3xl" : "text-2xl"}`} style={{ color: c }}>{value}</div>
      {hint ? <div className="mt-1 text-2xs text-[var(--color-ink-faint)]">{hint}</div> : null}
    </div>
  );
}

// Videograafkosten: €16,75 per uur, met maximaal 8 uur filmen per opnamedag.
const VG_RATE = 16.75;
const VG_MAX_HOURS = 8;

export default async function EditCostsPage({ searchParams }: { searchParams: Promise<{ maand?: string }> }) {
  await requirePermission("finance:read");
  const sp = await searchParams;

  // Maandoverzicht: winst per maand over alle klanten (uit de maandstaten).
  const [monthAgg, vgAgg] = await Promise.all([
    db.execute(sql`
      select period,
        coalesce(sum(revenue),0)::float rev, coalesce(sum(extra_revenue),0)::float extra,
        coalesce(sum(edit_cost),0)::float edit, coalesce(sum(shoot_cost),0)::float shoot,
        coalesce(sum(strategy_cost),0)::float strat, coalesce(sum(other_cost),0)::float other,
        count(*)::int n
      from client_finance_months group by period order by period
    `),
    // Videograafkosten per maand uit de opnamedagen: uren (max 8/dag) × €16,75.
    db.execute(sql`
      select to_char(scheduled_on,'YYYY-MM') period,
        count(*)::int shoot_days,
        coalesce(sum(least(${VG_MAX_HOURS}::numeric,
          case when start_time is not null and end_time is not null and end_time > start_time
            then extract(epoch from (end_time - start_time))/3600.0
            else ${VG_MAX_HOURS}::numeric end)),0)::float hours
      from production_days
      where deleted_at is null and status <> 'cancelled'
      group by 1
    `),
  ]);
  const vgByPeriod = new Map<string, { days: number; hours: number; cost: number }>();
  for (const v of rows2<{ period: string; shoot_days: number; hours: number }>(vgAgg)) {
    vgByPeriod.set(v.period, { days: Number(v.shoot_days), hours: Number(v.hours), cost: Number(v.hours) * VG_RATE });
  }

  type MRow = { period: string; rev: number; extra: number; edit: number; shoot: number; strat: number; other: number; n: number };
  const monthsRaw = rows2<MRow>(monthAgg);
  const months = monthsRaw.map((m) => {
    const income = m.rev + m.extra;
    const vg = vgByPeriod.get(m.period)?.cost ?? 0;
    const overige = m.strat + m.other; // directe kosten excl. opname (die zit in vg)
    const net = income - m.edit - vg - overige;
    return { ...m, income, vg, overige, net, hasOverige: overige > 0, marginPct: income > 0 ? Math.round((net / income) * 100) : 0 };
  });
  const maxNet = Math.max(1, ...months.map((m) => Math.abs(m.net)));
  const latestPeriod = months.length ? months[months.length - 1]!.period : null;

  // Gekozen maand voor de kerncijfers bovenin (standaard de laatste).
  const selPeriod = sp.maand && months.some((m) => m.period === sp.maand) ? sp.maand : latestPeriod;
  const selIdx = months.findIndex((m) => m.period === selPeriod);
  const sel = selIdx >= 0 ? months[selIdx]! : null;
  const prevPeriod = selIdx > 0 ? months[selIdx - 1]!.period : null;
  const nextPeriod = selIdx >= 0 && selIdx < months.length - 1 ? months[selIdx + 1]!.period : null;
  const selVgInfo = selPeriod ? vgByPeriod.get(selPeriod) : null;

  // Netto per klant voor de laatste maand (wie is het meest/minst winstgevend).
  const perClientRes = latestPeriod
    ? await db.execute(sql`
        select c.name, c.slug, c.color, c.logo_url,
          (m.revenue + m.extra_revenue)::float income,
          m.edit_cost::float edit,
          (m.shoot_cost + m.strategy_cost + m.other_cost)::float manual
        from client_finance_months m
        join clients c on c.id = m.client_id and c.deleted_at is null
        where m.period = ${latestPeriod}
      `)
    : null;
  type PRow = { name: string; slug: string; color: string | null; logo_url: string | null; income: number; edit: number; manual: number };
  const perClient = (perClientRes ? rows2<PRow>(perClientRes) : [])
    .map((r) => ({ ...r, net: r.income - r.edit - r.manual, margin: r.income > 0 ? Math.round(((r.income - r.edit - r.manual) / r.income) * 100) : 0 }))
    .sort((a, b) => b.net - a.net);

  const rows = await db
    .select({
      slug: clients.slug,
      name: clients.name,
      color: clients.color,
      logoUrl: clients.logoUrl,
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
        description="Omzet, editkosten en videograafkosten per maand — met de winst per maand over alle klanten."
      />

      {/* Kerncijfers van de gekozen maand, groot en in kleur. */}
      {sel ? (
        <section className="mb-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold tracking-tight">Maand: {monthLabel(sel.period)}</h2>
            <div className="inline-flex items-center gap-1">
              {prevPeriod ? <Link href={`/editkosten?maand=${prevPeriod}`} className="sc-card px-2.5 py-1 text-sm hover:bg-[var(--color-surface-sunken)]">←</Link> : <span className="sc-card px-2.5 py-1 text-sm opacity-40">←</span>}
              {nextPeriod ? <Link href={`/editkosten?maand=${nextPeriod}`} className="sc-card px-2.5 py-1 text-sm hover:bg-[var(--color-surface-sunken)]">→</Link> : <span className="sc-card px-2.5 py-1 text-sm opacity-40">→</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Omzet" value={euro(sel.income)} tone="info" />
            <KpiTile label="Editkosten" value={`−${euro(sel.edit)}`} tone="warn" />
            <KpiTile label="Videograafkosten" value={`−${euro(sel.vg)}`} tone="warn" hint={selVgInfo ? `${selVgInfo.days} opnamedagen · ${Math.round(selVgInfo.hours)} u × €16,75` : "€16,75/u · max 8u/dag"} />
            <KpiTile label="Winst" value={euro(sel.net)} tone={sel.net > 0 ? "good" : sel.net < 0 ? "bad" : "neutral"} hint={`marge ${sel.marginPct}%`} big />
          </div>
          {sel.hasOverige ? <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">Winst is ná editkosten, videograafkosten en overige directe kosten (−{euro(sel.overige)} strategie/overig deze maand).</p> : <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">Winst = omzet − editkosten − videograafkosten. Overige directe kosten (strategie/overig) zijn deze maand nog niet ingevuld.</p>}
        </section>
      ) : null}

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
            <Table head={<><th className="sc-th">Maand</th><th className="sc-th text-right">Omzet</th><th className="sc-th text-right">Editkosten</th><th className="sc-th text-right">Videograafkosten</th><th className="sc-th text-right">Overige</th><th className="sc-th text-right">Winst</th><th className="sc-th text-right">Marge</th><th className="sc-th text-right">vs vorige</th></>}>
              {months.map((m, i) => {
                const prev = months[i - 1];
                const delta = prev && prev.net !== 0 ? Math.round(((m.net - prev.net) / Math.abs(prev.net)) * 100) : null;
                const isSel = m.period === selPeriod;
                return (
                  <tr key={m.period} style={isSel ? { background: "var(--color-surface-sunken)" } : undefined}>
                    <td className="sc-td font-medium">{monthLabel(m.period)}</td>
                    <td className="sc-td text-right tabular-nums">{euro(m.income)}</td>
                    <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">−{euro(m.edit)}</td>
                    <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{m.vg > 0 ? `−${euro(m.vg)}` : "—"}</td>
                    <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{m.hasOverige ? `−${euro(m.overige)}` : <span className="text-[var(--color-ink-faint)]">—</span>}</td>
                    <td className="sc-td text-right font-bold tabular-nums" style={{ color: m.net > 0 ? "var(--color-good)" : m.net < 0 ? "var(--color-bad)" : undefined }}>{euro(m.net)}</td>
                    <td className="sc-td text-right font-semibold tabular-nums" style={{ color: m.marginPct >= 50 ? "var(--color-good)" : m.marginPct >= 20 ? "var(--color-warn)" : "var(--color-bad)" }}>{m.marginPct}%</td>
                    <td className="sc-td text-right tabular-nums">{delta == null ? "—" : <span style={{ color: delta >= 0 ? "var(--color-good)" : "var(--color-bad)" }}>{delta >= 0 ? "+" : ""}{delta}%</span>}</td>
                  </tr>
                );
              })}
            </Table>
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">Videograafkosten zijn berekend uit de opnamedagen (€16,75/uur, max 8 uur per dag). Overige directe kosten (strategie/overig) tellen mee zodra ze per maand zijn ingevuld.</p>
          </div>
        )}
      </Card>

      {/* Netto per klant — laatste maand */}
      {perClient.length > 0 ? (
        <Card padded={false} className="mb-5">
          <CardHeader title={`Netto per klant · ${monthLabel(latestPeriod!)}`} subtitle="Wie is het meest en minst winstgevend deze maand (na editkosten en ingevulde directe kosten)." className="p-5 pb-2" />
          <Table head={<><th className="sc-th">Klant</th><th className="sc-th text-right">Omzet</th><th className="sc-th text-right">Editkosten</th><th className="sc-th text-right">Directe kosten</th><th className="sc-th text-right">Netto</th><th className="sc-th text-right">Marge</th></>}>
            {perClient.map((r) => {
              const attention = r.net < 0 || r.margin < 20;
              return (
                <tr key={r.slug} className="sc-row-link" style={attention ? { boxShadow: `inset 3px 0 0 ${r.net < 0 ? "var(--color-bad)" : "var(--color-warn)"}` } : undefined}>
                  <td className="sc-td"><Link href={`/clients/${r.slug}?tab=financieel`} className="flex items-center gap-2 font-medium hover:underline"><ClientLogo name={r.name} logoUrl={r.logo_url} color={r.color} size={20} />{r.name}</Link></td>
                  <td className="sc-td text-right tabular-nums">{euro(r.income)}</td>
                  <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">−{euro(r.edit)}</td>
                  <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{r.manual > 0 ? `−${euro(r.manual)}` : "—"}</td>
                  <td className="sc-td text-right font-semibold tabular-nums" style={{ color: r.net > 0 ? "var(--color-good)" : r.net < 0 ? "var(--color-bad)" : undefined }}>{euro(r.net)}</td>
                  <td className="sc-td text-right font-semibold tabular-nums" style={{ color: r.margin >= 50 ? "var(--color-good)" : r.margin >= 20 ? "var(--color-warn)" : "var(--color-bad)" }}>{r.margin}%</td>
                </tr>
              );
            })}
          </Table>
        </Card>
      ) : null}

      <div className="mb-3 text-sm font-semibold text-[var(--color-ink-muted)]">Editkosten (verwacht, uit de contracten)</div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Totale editkosten / maand" value={euro(totalMonth)} hint="actieve klanten" tone="warn" icon={<Scissors />} />
        <Stat label="Shorts per maand" value={num(totalShorts)} hint="afgerekende edits/maand" tone="info" icon={<Film />} />
        <Stat label="Gem. per short" value={euro(avgPerShort)} icon={<Coins />} />
        <Stat label="Editors actief" value={num(byEditor.filter((e) => e.name !== "Niet toegewezen").length)} icon={<Users />} />
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
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{euro(e.cost)}<span className="text-2xs font-normal text-[var(--color-ink-faint)]">/mnd</span></span>
                  <span className="shrink-0 text-2xs text-[var(--color-ink-faint)]">{e.shorts} shorts{e.shorts > 0 ? ` · ${euro(e.cost / e.shorts)}/short` : ""} · {e.clients} klanten</span>
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
                  <td className="sc-td"><Link href={`/clients/${r.slug}?tab=financieel`} className="flex items-center gap-2 font-medium hover:underline"><ClientLogo name={r.name} logoUrl={r.logoUrl} color={r.color} size={20} />{r.name}</Link></td>
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
              <Link key={r.slug} href={`/clients/${r.slug}?tab=financieel`} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-neutral-soft)] px-3 py-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><ClientLogo name={r.name} logoUrl={r.logoUrl} color={r.color} size={16} />{r.name}</Link>
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
