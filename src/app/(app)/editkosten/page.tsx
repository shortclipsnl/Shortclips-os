import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requirePermission } from "@/server/auth/context";
import { Card, CardHeader, ClientLogo, EmptyState, PageHeader, Table } from "@/components/ui";
import { euro } from "@/lib/format";

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
  const [monthAgg, vgAgg, editTotalRes] = await Promise.all([
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
    // Verwachte editkosten/maand, live gekoppeld aan de klanten: Σ prijs/video × shorts.
    db.execute(sql`
      select coalesce(sum(coalesce(edit_cost_per_video,0) * coalesce(monthly_video_quota,0)),0)::float total
      from clients where deleted_at is null and status = 'active'
    `),
  ]);
  const vgByPeriod = new Map<string, { days: number; hours: number; cost: number }>();
  for (const v of rows2<{ period: string; shoot_days: number; hours: number }>(vgAgg)) {
    vgByPeriod.set(v.period, { days: Number(v.shoot_days), hours: Number(v.hours), cost: Number(v.hours) * VG_RATE });
  }
  const liveEditTotal = Number(rows2<{ total: number }>(editTotalRes)[0]?.total ?? 0);

  type MRow = { period: string; rev: number; extra: number; edit: number; shoot: number; strat: number; other: number; n: number };
  const monthsRaw = rows2<MRow>(monthAgg);
  const months = monthsRaw.map((m) => {
    const income = m.rev + m.extra;
    const vg = vgByPeriod.get(m.period)?.cost ?? 0;
    const overige = m.strat + m.other; // directe kosten excl. opname (die zit in vg)
    // Editkosten live gekoppeld aan de contracten (prijs/video × shorts), niet de snapshot.
    const edit = liveEditTotal;
    const net = income - edit - vg - overige;
    return { ...m, income, edit, vg, overige, net, hasOverige: overige > 0, marginPct: income > 0 ? Math.round((net / income) * 100) : 0 };
  });
  const latestPeriod = months.length ? months[months.length - 1]!.period : null;

  // Gekozen maand voor de kerncijfers bovenin (standaard de laatste).
  const selPeriod = sp.maand && months.some((m) => m.period === sp.maand) ? sp.maand : latestPeriod;
  const selIdx = months.findIndex((m) => m.period === selPeriod);
  const sel = selIdx >= 0 ? months[selIdx]! : null;
  const prevPeriod = selIdx > 0 ? months[selIdx - 1]!.period : null;
  const nextPeriod = selIdx >= 0 && selIdx < months.length - 1 ? months[selIdx + 1]!.period : null;
  const selVgInfo = selPeriod ? vgByPeriod.get(selPeriod) : null;

  // Netto per klant voor de gekozen maand: omzet − editkosten − videograafkosten.
  const [perClientRes, vgClientRes] = await Promise.all([
    selPeriod
      ? db.execute(sql`
          select c.id, c.name, c.slug, c.color, c.logo_url,
            (m.revenue + m.extra_revenue)::float income,
            -- Editkosten live gekoppeld aan de klant: prijs/video × shorts per maand.
            (coalesce(c.edit_cost_per_video,0) * coalesce(c.monthly_video_quota,0))::float edit
          from client_finance_months m
          join clients c on c.id = m.client_id and c.deleted_at is null
          where m.period = ${selPeriod}
        `)
      : Promise.resolve(null),
    selPeriod
      ? db.execute(sql`
          select c.id,
            coalesce(sum(least(${VG_MAX_HOURS}::numeric,
              case when pd.start_time is not null and pd.end_time is not null and pd.end_time > pd.start_time
                then extract(epoch from (pd.end_time - pd.start_time))/3600.0
                else ${VG_MAX_HOURS}::numeric end)),0)::float hours
          from production_days pd
          join clients c on c.id = pd.client_id and c.deleted_at is null
          where to_char(pd.scheduled_on,'YYYY-MM') = ${selPeriod} and pd.deleted_at is null and pd.status <> 'cancelled'
          group by c.id
        `)
      : Promise.resolve(null),
  ]);
  const vgByClient = new Map<string, number>();
  for (const v of (vgClientRes ? rows2<{ id: string; hours: number }>(vgClientRes) : [])) {
    vgByClient.set(String(v.id), Number(v.hours) * VG_RATE);
  }
  type PRow = { id: string; name: string; slug: string; color: string | null; logo_url: string | null; income: number; edit: number };
  const perClient = (perClientRes ? rows2<PRow>(perClientRes) : [])
    .map((r) => {
      const vg = vgByClient.get(String(r.id)) ?? 0;
      const net = r.income - r.edit - vg;
      return { ...r, vg, net, margin: r.income > 0 ? Math.round((net / r.income) * 100) : 0 };
    })
    .sort((a, b) => b.net - a.net);

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
      <Card padded={false} className="mb-5">
        <CardHeader title="Winst per maand (alle klanten)" subtitle="Omzet − editkosten − videograafkosten − overige directe kosten. Elke maand komt er automatisch een regel bij." className="p-5 pb-2" />
        {months.length === 0 ? (
          <EmptyState title="Nog geen maandstaten" description="Zodra de maand-snapshot heeft gedraaid, verschijnt hier de winst per maand." />
        ) : (
          <div className="px-5 pb-5">
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

      {/* Netto per klant — gekozen maand */}
      {perClient.length > 0 ? (
        <Card padded={false} className="mb-5">
          <CardHeader title={`Netto per klant${selPeriod ? ` · ${monthLabel(selPeriod)}` : ""}`} subtitle="Wie is het meest en minst winstgevend deze maand: omzet − editkosten − videograafkosten." className="p-5 pb-2" />
          <Table head={<><th className="sc-th">Klant</th><th className="sc-th text-right">Omzet</th><th className="sc-th text-right">Editkosten</th><th className="sc-th text-right">Videograafkosten</th><th className="sc-th text-right">Netto</th><th className="sc-th text-right">Marge</th></>}>
            {perClient.map((r) => {
              const attention = r.net < 0 || r.margin < 20;
              return (
                <tr key={r.slug} className="sc-row-link" style={attention ? { boxShadow: `inset 3px 0 0 ${r.net < 0 ? "var(--color-bad)" : "var(--color-warn)"}` } : undefined}>
                  <td className="sc-td"><Link href={`/clients/${r.slug}?tab=financieel`} className="flex items-center gap-2 font-medium hover:underline"><ClientLogo name={r.name} logoUrl={r.logo_url} color={r.color} size={20} />{r.name}</Link></td>
                  <td className="sc-td text-right tabular-nums">{euro(r.income)}</td>
                  <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">−{euro(r.edit)}</td>
                  <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{r.vg > 0 ? `−${euro(r.vg)}` : "—"}</td>
                  <td className="sc-td text-right font-semibold tabular-nums" style={{ color: r.net > 0 ? "var(--color-good)" : r.net < 0 ? "var(--color-bad)" : undefined }}>{euro(r.net)}</td>
                  <td className="sc-td text-right font-semibold tabular-nums" style={{ color: r.margin >= 50 ? "var(--color-good)" : r.margin >= 20 ? "var(--color-warn)" : "var(--color-bad)" }}>{r.margin}%</td>
                </tr>
              );
            })}
          </Table>
          <p className="px-5 py-3 text-xs text-[var(--color-ink-muted)]">Editkosten zijn de verwachte editkosten van de maand (afspraak per klant). Videograafkosten zijn berekend uit de opnamedagen van die maand (€16,75/uur, max 8 uur per dag). De editkosten per editor en per klant zijn hierin al verwerkt.</p>
        </Card>
      ) : null}
    </div>
  );
}
