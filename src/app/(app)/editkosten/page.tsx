import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requirePermission } from "@/server/auth/context";
import { Card, CardHeader, ClientLogo, EmptyState, PageHeader, Table, TeamAvatar } from "@/components/ui";
import { euro } from "@/lib/format";
import { VG_DAY, VG_MAX_HOURS, VG_RATE } from "@/lib/videographer-cost";

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

type ExpectedData = { list: Array<{ editor: string; shorts: number; cost: number; clients: string[] }>; totalShorts: number; totalCost: number };
function ExpectedBlock({ title, badge, data }: { title: string; badge?: string; data: ExpectedData }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      {/* Donkerblauwe kop met witte tekst — totaal aantal shorts + editkosten
          meteen in het oog, per editor eronder uitgesplitst. */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--color-indigo-ink)] px-4 py-3 text-white">
        <span className="text-sm font-bold tracking-tight">{title}{badge ? <span className="ml-2 text-2xs font-medium text-white/60">· {badge}</span> : null}</span>
        <span className="flex items-center gap-4 text-right">
          <span><span className="block text-lg font-bold tabular-nums leading-none">{data.totalShorts}</span><span className="text-2xs text-white/60">shorts</span></span>
          <span><span className="block text-lg font-bold tabular-nums leading-none">{euro(data.totalCost)}</span><span className="text-2xs text-white/60">editkosten</span></span>
        </span>
      </div>
      {data.list.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-[var(--color-ink-faint)]">Geen opnames gepland deze maand.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {data.list.map((e) => (
            <li key={e.editor} className="flex items-center gap-3 px-4 py-2.5">
              <TeamAvatar name={e.editor} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{e.editor}</span>
                <span className="block truncate text-2xs text-[var(--color-ink-faint)]">{e.clients.join(" · ")}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-base font-bold tabular-nums leading-none">{euro(e.cost)}</span>
                <span className="text-2xs text-[var(--color-ink-faint)]">{e.shorts} shorts</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Videograafkosten (uurtarief, max uren/dag, standaarddag) uit één gedeelde bron,
// zodat editkosten en winstgevendheid exact dezelfde cijfers gebruiken.

export default async function EditCostsPage({ searchParams }: { searchParams: Promise<{ maand?: string }> }) {
  await requirePermission("finance:read");
  const sp = await searchParams;

  // Maandoverzicht: winst per maand over alle klanten (uit de maandstaten).
  const [monthAgg, vgCPAgg, financePairsRes, editTotalRes] = await Promise.all([
    db.execute(sql`
      select period,
        coalesce(sum(revenue),0)::float rev, coalesce(sum(extra_revenue),0)::float extra,
        coalesce(sum(edit_cost),0)::float edit, coalesce(sum(shoot_cost),0)::float shoot,
        coalesce(sum(strategy_cost),0)::float strat, coalesce(sum(other_cost),0)::float other,
        count(*)::int n
      from client_finance_months group by period order by period
    `),
    // Videograafkosten per klant per maand uit de opnamedagen: uren (max 8/dag).
    db.execute(sql`
      select client_id, to_char(scheduled_on,'YYYY-MM') period,
        count(*)::int days,
        coalesce(sum(least(${VG_MAX_HOURS}::numeric,
          case when start_time is not null and end_time is not null and end_time > start_time
            then extract(epoch from (end_time - start_time))/3600.0
            else ${VG_MAX_HOURS}::numeric end)),0)::float hours
      from production_days
      where deleted_at is null and status <> 'cancelled'
      group by 1, 2
    `),
    // Welke klant-maanden bestaan (hebben een maandstaat) — bron voor de €134-aanname.
    db.execute(sql`select client_id, period from client_finance_months`),
    // Verwachte editkosten/maand, live gekoppeld aan de klanten: Σ prijs/video × shorts.
    db.execute(sql`
      select coalesce(sum(coalesce(edit_cost_per_video,0) * coalesce(monthly_video_quota,0)),0)::float total
      from clients where deleted_at is null and status = 'active'
    `),
  ]);
  // VG per (klant|maand) uit echte opnamedagen.
  const vgCP = new Map<string, { days: number; hours: number; cost: number }>();
  for (const v of rows2<{ client_id: string; period: string; days: number; hours: number }>(vgCPAgg)) {
    vgCP.set(`${v.client_id}|${v.period}`, { days: Number(v.days), hours: Number(v.hours), cost: Number(v.hours) * VG_RATE });
  }
  // Videograafkosten per maand mét €134-aanname voor klant-maanden zonder opnamedag.
  const vgByPeriod = new Map<string, { days: number; hours: number; cost: number; assumed: number }>();
  for (const p of rows2<{ client_id: string; period: string }>(financePairsRes)) {
    const cur = vgByPeriod.get(p.period) ?? { days: 0, hours: 0, cost: 0, assumed: 0 };
    const cp = vgCP.get(`${p.client_id}|${p.period}`);
    if (cp) {
      cur.days += cp.days;
      cur.hours += cp.hours;
      cur.cost += cp.cost;
    } else {
      cur.cost += VG_DAY;
      cur.assumed += 1;
    }
    vgByPeriod.set(p.period, cur);
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

  // Standaard tonen we de laatste VOLLEDIG afgeronde maand (de vorige maand),
  // niet de lopende maand — die omzet is nog onvolledig. Elke 1e van de maand
  // schuift dit vanzelf een maand op. Met ←/→ kun je alsnog elke maand kiezen.
  const nowPeriod = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
  const completedMonths = months.filter((m) => m.period < nowPeriod);
  const defaultPeriod = completedMonths.length ? completedMonths[completedMonths.length - 1]!.period : latestPeriod;

  // Gekozen maand voor de kerncijfers bovenin (standaard de laatste afgeronde).
  const selPeriod = sp.maand && months.some((m) => m.period === sp.maand) ? sp.maand : defaultPeriod;
  const selIdx = months.findIndex((m) => m.period === selPeriod);
  const sel = selIdx >= 0 ? months[selIdx]! : null;
  const prevPeriod = selIdx > 0 ? months[selIdx - 1]!.period : null;
  const nextPeriod = selIdx >= 0 && selIdx < months.length - 1 ? months[selIdx + 1]!.period : null;
  const selVgInfo = selPeriod ? vgByPeriod.get(selPeriod) : null;

  // Netto per klant voor de gekozen maand: omzet − editkosten − videograafkosten.
  // En editkosten per editor: welke editor factureert deze maand hoeveel, voor
  // hoeveel video's. Effectieve prijs per video = afwijkend tarief op de video
  // (als gezet), anders het afgesproken tarief van de klant.
  const [perClientRes, perEditorRes] = selPeriod
    ? await Promise.all([
        db.execute(sql`
          select c.id, c.name, c.slug, c.color, c.logo_url,
            (m.revenue + m.extra_revenue)::float income,
            -- Editkosten live gekoppeld aan de klant: prijs/video × shorts per maand.
            (coalesce(c.edit_cost_per_video,0) * coalesce(c.monthly_video_quota,0))::float edit
          from client_finance_months m
          join clients c on c.id = m.client_id and c.deleted_at is null
          where m.period = ${selPeriod}
        `),
        db.execute(sql`
          select u.id, u.full_name as name, u.avatar_url,
            count(*)::int videos,
            -- Editkosten = wat we de editor betalen: afwijkend tarief op de video
            -- indien gezet, anders het eigen tarief van de editor (editor_rates),
            -- en als laatste terugval het klanttarief.
            coalesce(sum(coalesce(nullif(d.edit_cost,0), er.rate_per_video, c.edit_cost_per_video, 0)),0)::float total
          from deliverables d
          join users u on u.id = d.editor_id
          join clients c on c.id = d.client_id and c.deleted_at is null
          left join editor_rates er on er.user_id = d.editor_id
          where d.deleted_at is null and d.editor_id is not null
            and d.status in ('published','approved','scheduled','ready_to_publish','analysis_available')
            and to_char((coalesce(d.published_at, d.status_changed_at)) at time zone 'Europe/Amsterdam', 'YYYY-MM') = ${selPeriod}
          group by u.id, u.full_name, u.avatar_url
          order by total desc, videos desc
        `),
      ])
    : [null, null];
  type PRow = { id: string; name: string; slug: string; color: string | null; logo_url: string | null; income: number; edit: number };
  const perClient = (perClientRes ? rows2<PRow>(perClientRes) : [])
    .map((r) => {
      // Geen vastgelegde opnamedag deze maand? Dan rekenen we één standaard dag (€134).
      const cp = selPeriod ? vgCP.get(`${r.id}|${selPeriod}`) : undefined;
      const vg = cp ? cp.cost : VG_DAY;
      const assumedVg = !cp;
      const net = r.income - r.edit - vg;
      return { ...r, vg, assumedVg, net, margin: r.income > 0 ? Math.round((net / r.income) * 100) : 0 };
    })
    .sort((a, b) => b.net - a.net);

  // Editkosten per editor voor de gekozen maand (hoogste factuur bovenaan).
  type ERow = { id: string; name: string; avatar_url: string | null; videos: number; total: number };
  const perEditor = (perEditorRes ? rows2<ERow>(perEditorRes) : []).map((e) => ({
    ...e,
    videos: Number(e.videos),
    total: Number(e.total),
    perVideo: Number(e.videos) > 0 ? Number(e.total) / Number(e.videos) : 0,
  }));
  const editorTotal = perEditor.reduce((a, e) => a + e.total, 0);
  const editorVideos = perEditor.reduce((a, e) => a + e.videos, 0);

  // Verwachte editkosten per editor op basis van de OPNAMES: welke klanten hebben
  // deze (en volgende) maand een opname gepland, hoeveel shorts leveren die op
  // (het maandquotum van de klant), welke vaste editor is eraan verbonden
  // (clients.editorName) en wat kost dat (prijs/short × shorts). Zo zie je vooraf
  // de te verwachten editingkosten per editor.
  const nextPeriod2 = (() => {
    const [y, m] = nowPeriod.split("-").map(Number);
    const d = new Date(y!, m!, 1); // m is 1-based → eerste dag volgende maand
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const expectedQuery = (period: string) =>
    db.execute(sql`
      select c.name, coalesce(nullif(trim(c.editor_name), ''), '— geen editor') editor,
        coalesce(c.edit_cost_per_video,0)::float cost_per_video,
        coalesce(c.monthly_video_quota,0)::int quota
      from clients c
      where c.deleted_at is null and c.status = 'active'
        and exists (
          select 1 from production_days pd
          where pd.client_id = c.id and pd.deleted_at is null and pd.status <> 'cancelled'
            and to_char(pd.scheduled_on, 'YYYY-MM') = ${period}
        )
      order by c.editor_name nulls last, c.name
    `);
  const [expCurRes, expNextRes] = await Promise.all([expectedQuery(nowPeriod), expectedQuery(nextPeriod2)]);
  type ExpRow = { name: string; editor: string; cost_per_video: number; quota: number };
  const buildExpected = (res: unknown) => {
    const rows = rows2<ExpRow>(res);
    const byEditor = new Map<string, { editor: string; shorts: number; cost: number; clients: string[] }>();
    for (const r of rows) {
      const shorts = Number(r.quota);
      const cost = shorts * Number(r.cost_per_video);
      const cur = byEditor.get(r.editor) ?? { editor: r.editor, shorts: 0, cost: 0, clients: [] };
      cur.shorts += shorts;
      cur.cost += cost;
      cur.clients.push(r.name);
      byEditor.set(r.editor, cur);
    }
    const list = [...byEditor.values()].sort((a, b) => b.cost - a.cost);
    return { list, totalShorts: list.reduce((a, e) => a + e.shorts, 0), totalCost: list.reduce((a, e) => a + e.cost, 0) };
  };
  const expCur = buildExpected(expCurRes);
  const expNext = buildExpected(expNextRes);

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
            <h2 className="text-base font-bold tracking-tight">
              Maand: {monthLabel(sel.period)}
              {sel.period === defaultPeriod ? <span className="ml-2 text-xs font-medium text-[var(--color-ink-faint)]">· laatste afgeronde maand</span> : null}
            </h2>
            <div className="inline-flex items-center gap-1">
              {prevPeriod ? <Link href={`/editkosten?maand=${prevPeriod}`} className="sc-card px-2.5 py-1 text-sm hover:bg-[var(--color-surface-sunken)]">←</Link> : <span className="sc-card px-2.5 py-1 text-sm opacity-40">←</span>}
              {nextPeriod ? <Link href={`/editkosten?maand=${nextPeriod}`} className="sc-card px-2.5 py-1 text-sm hover:bg-[var(--color-surface-sunken)]">→</Link> : <span className="sc-card px-2.5 py-1 text-sm opacity-40">→</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Omzet" value={euro(sel.income)} tone="info" />
            <KpiTile label="Editkosten" value={`−${euro(sel.edit)}`} tone="warn" />
            <KpiTile label="Videograafkosten" value={`−${euro(sel.vg)}`} tone="warn" hint={selVgInfo ? `${selVgInfo.days} opnamedagen${selVgInfo.assumed ? ` · ${selVgInfo.assumed}× €134 geschat` : ""}` : "€16,75/u · max 8u/dag"} />
            <KpiTile label="Winst" value={euro(sel.net)} tone={sel.net > 0 ? "good" : sel.net < 0 ? "bad" : "neutral"} hint={`marge ${sel.marginPct}%`} big />
          </div>
          {sel.hasOverige ? <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">Winst is ná editkosten, videograafkosten en overige directe kosten (−{euro(sel.overige)} strategie/overig deze maand).</p> : <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">Winst = omzet − editkosten − videograafkosten. Overige directe kosten (strategie/overig) zijn deze maand nog niet ingevuld.</p>}
        </section>
      ) : null}

      {/* Editkosten per editor — bovenin: eerst de verwachting (op basis van de
          geplande opnames) voor deze en volgende maand, dan de werkelijke kosten
          per editor van de gekozen (afgeronde) maand. */}
      <section className="mb-5">
        <h2 className="mb-2 text-base font-bold tracking-tight">Editkosten per editor</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <ExpectedBlock title="Verwacht deze maand" badge={monthLabel(nowPeriod)} data={expCur} />
          <ExpectedBlock title="Verwacht volgende maand" badge={monthLabel(nextPeriod2)} data={expNext} />
        </div>
        <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
          Verwachting op basis van de geplande opnames: elke actieve klant met een opname die maand levert zijn maandaantal shorts op, tegen de afgesproken prijs per short, toegekend aan de vaste editor van de klant.
        </p>
      </section>

      {perEditor.length > 0 ? (
        <Card padded={false} className="mb-5">
          <CardHeader
            title={`Werkelijk per editor${selPeriod ? ` · ${monthLabel(selPeriod)}` : ""}`}
            subtitle={`Wat er die maand daadwerkelijk is opgeleverd en gefactureerd — totaal ${euro(editorTotal)} over ${editorVideos} ${editorVideos === 1 ? "video" : "video's"}, hoogste factuur bovenaan.`}
            className="p-5 pb-2"
          />
          <Table head={<><th className="sc-th">Editor</th><th className="sc-th text-right">Video&apos;s</th><th className="sc-th text-right">Per video (gem.)</th><th className="sc-th text-right">Editkosten</th><th className="sc-th text-right">Aandeel</th></>}>
            {perEditor.map((e) => {
              const share = editorTotal > 0 ? Math.round((e.total / editorTotal) * 100) : 0;
              return (
                <tr key={e.id}>
                  <td className="sc-td"><span className="flex items-center gap-2 font-medium"><TeamAvatar name={e.name} avatarUrl={e.avatar_url} size={22} />{e.name}</span></td>
                  <td className="sc-td text-right tabular-nums">{e.videos}</td>
                  <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{euro(e.perVideo)}</td>
                  <td className="sc-td text-right font-bold tabular-nums">{euro(e.total)}</td>
                  <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{share}%</td>
                </tr>
              );
            })}
          </Table>
          <p className="px-5 py-3 text-xs text-[var(--color-ink-muted)]">Op basis van de video&apos;s die deze maand zijn opgeleverd (gepubliceerd of goedgekeurd). Prijs per video = afwijkend tarief op de video indien gezet, anders het eigen tarief van de editor (zoals Senna €40), anders het klanttarief.</p>
        </Card>
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
                  <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]" title={r.assumedVg ? "Geen opnamedag vastgelegd deze maand — gerekend als 1 standaard opnamedag (€134)." : undefined}>
                    −{euro(r.vg)}{r.assumedVg ? <span className="ml-0.5 text-[var(--color-ink-faint)]">*</span> : null}
                  </td>
                  <td className="sc-td text-right font-semibold tabular-nums" style={{ color: r.net > 0 ? "var(--color-good)" : r.net < 0 ? "var(--color-bad)" : undefined }}>{euro(r.net)}</td>
                  <td className="sc-td text-right font-semibold tabular-nums" style={{ color: r.margin >= 50 ? "var(--color-good)" : r.margin >= 20 ? "var(--color-warn)" : "var(--color-bad)" }}>{r.margin}%</td>
                </tr>
              );
            })}
          </Table>
          <p className="px-5 py-3 text-xs text-[var(--color-ink-muted)]">Editkosten zijn de verwachte editkosten van de maand (afspraak per klant). Videograafkosten zijn berekend uit de opnamedagen van die maand (€16,75/uur, max 8 uur per dag). <span className="text-[var(--color-ink-faint)]">*</span> = geen opnamedag vastgelegd, gerekend als 1 standaard opnamedag (€134).</p>
        </Card>
      ) : null}

    </div>
  );
}
