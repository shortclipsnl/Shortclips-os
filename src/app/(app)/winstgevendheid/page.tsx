import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Info, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardHeader, ClientLogo, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { requireOwner } from "@/server/auth/context";
import { computeProfitabilitySignals, currentPeriod, getClientProfitability, getProfitabilityMonthly, prevPeriod } from "@/server/profitability";
import { ThresholdForm } from "./threshold-form";
import { RecalcButton } from "./recalc-button";

export const metadata: Metadata = { title: "Winstgevendheid" };
export const dynamic = "force-dynamic";

const eur = (v: number) => `€${Math.round(v).toLocaleString("nl-NL")}`;
const DOT: Record<string, string> = { good: "var(--color-good)", warn: "var(--color-warn)", bad: "var(--color-bad)" };
function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}
function nextPeriod(period: string) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}

export default async function WinstgevendheidPage({ searchParams }: { searchParams: Promise<{ maand?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.maand ?? "") ? sp.maand! : currentPeriod();

  const [overview, monthly] = await Promise.all([getClientProfitability(period), getProfitabilityMonthly(6)]);
  const signals = computeProfitabilitySignals(overview, "live");
  const { rows, totals, settings, overhead } = overview;

  // Ontwikkeling t.o.v. vorige maand (bedrijfsbreed).
  const thisM = monthly.find((m) => m.period === period) ?? null;
  const prevM = monthly.find((m) => m.period === prevPeriod(period)) ?? null;
  const omzetDelta = thisM && prevM && prevM.omzet > 0 ? Math.round(((thisM.omzet - prevM.omzet) / prevM.omzet) * 100) : null;
  const margeDelta = thisM?.brutomarge != null && prevM?.brutomarge != null ? Math.round((thisM.brutomarge - prevM.brutomarge) * 10) / 10 : null;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Winstgevendheid per klant"
        description="In één oogopslag welke klanten geld opleveren en waar de marge aandacht vraagt. Omzet telt alleen voor klanten met een geplande opname die maand (op basis van de agenda) — niet elke klant draait elke maand. Directe kosten zijn geregistreerd; overhead en nettowinst zijn geschat (toegerekend)."
        actions={<ThresholdForm green={settings.marginGreenPct} orange={settings.marginOrangePct} includeOverhead={settings.includeOverhead} />}
      />

      {/* Maandkiezer */}
      <div className="mb-4 flex items-center gap-2">
        <Link href={`/winstgevendheid?maand=${prevPeriod(period)}`} className="inline-flex size-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"><ChevronLeft className="size-4" /></Link>
        <span className="min-w-[9rem] text-center text-sm font-semibold capitalize">{monthLabel(period)}</span>
        <Link href={`/winstgevendheid?maand=${nextPeriod(period)}`} className="inline-flex size-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"><ChevronRight className="size-4" /></Link>
        <span className="ml-auto"><RecalcButton period={period} /></span>
      </div>

      {/* Signalen */}
      {signals.length > 0 ? (
        <div className="mb-5 space-y-2">
          {signals.map((s, i) => (
            <div key={i} className={`flex items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3 ${s.level === "critical" ? "border-[var(--color-bad)]/30 bg-[var(--color-bad-soft)]" : "border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)]"}`}>
              <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${s.level === "critical" ? "text-[var(--color-bad)]" : "text-[var(--color-warn)]"}`} />
              <div className="min-w-0 flex-1 text-sm">
                <Link href={`/clients/${rows.find((r) => r.clientId === s.clientId)?.slug ?? ""}?tab=financieel`} className="font-semibold text-[var(--color-ink)] hover:underline">{s.title}</Link>
                <p className="text-[var(--color-ink-muted)]">{s.oorzaak}</p>
                <p className="text-[var(--color-ink-muted)]"><strong className="font-semibold text-[var(--color-ink)]">Voorstel:</strong> {s.voorstel}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Maandtotalen + ontwikkeling */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Totale omzet" value={eur(totals.omzet)} hint={omzetDelta != null ? `${omzetDelta >= 0 ? "+" : ""}${omzetDelta}% vs vorige maand` : undefined} />
        <Stat label="Directe kosten" value={eur(totals.directeKosten)} />
        <Stat label="Brutowinst" value={eur(totals.brutowinst)} tone={totals.brutowinst >= 0 ? "good" : "bad"} />
        <Stat
          label="Gem. brutomarge"
          value={totals.brutomarge != null ? `${totals.brutomarge}%` : "—"}
          hint={margeDelta != null ? `${margeDelta >= 0 ? "+" : ""}${margeDelta}pt vs vorige maand` : undefined}
          tone={totals.brutomarge == null ? "neutral" : totals.brutomarge >= settings.marginGreenPct ? "good" : totals.brutomarge >= settings.marginOrangePct ? "warn" : "bad"}
        />
      </div>

      {/* Ranglijst per klant */}
      <Card padded={false} className="mb-5">
        <CardHeader title={`Per klant — ${monthLabel(period)}`} subtitle="Gesorteerd op brutowinst. Kleur = brutomarge t.o.v. de ingestelde grenswaarden." className="p-5 pb-2" />
        {rows.length === 0 ? (
          <EmptyState title="Geen maandcijfers voor deze maand" description="Zodra de maandstaten gevuld zijn (automatisch elke nacht), verschijnt de winstgevendheid hier." />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Klant</th>
                <th className="sc-th text-right">Omzet</th>
                <th className="sc-th text-right">Shorts</th>
                <th className="sc-th text-right">Directe kosten</th>
                <th className="sc-th text-right">Brutowinst</th>
                <th className="sc-th text-right">Marge</th>
                <th className="sc-th text-right">Netto (geschat)</th>
              </>
            }
          >
            {rows.map((r) => (
              <tr key={r.clientId} style={{ boxShadow: `inset 3px 0 0 ${DOT[r.kleur]}` }}>
                <td className="sc-td">
                  <Link href={`/clients/${r.slug}?tab=financieel`} className="flex items-center gap-2 font-medium hover:underline">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: DOT[r.kleur] }} />
                    <ClientLogo name={r.name} logoUrl={r.logoUrl} color={r.color} size={22} />
                    {r.name}
                  </Link>
                </td>
                <td className="sc-td text-right tabular-nums">{eur(r.omzet)}</td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{r.shorts}{r.gemOmzetPerShort ? <span className="block text-2xs text-[var(--color-ink-faint)]">{eur(r.gemOmzetPerShort)}/short</span> : null}</td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]" title={`Edit ${eur(r.editCost)} · Videograaf ${eur(r.videographerCost)} · Opname ${eur(r.shootCost)} · Strategie ${eur(r.strategyCost)} · Overig ${eur(r.otherCost)}`}>{eur(r.directeKosten)}</td>
                <td className="sc-td text-right font-semibold tabular-nums" style={{ color: r.brutowinst >= 0 ? "var(--color-ink)" : "var(--color-bad)" }}>{eur(r.brutowinst)}</td>
                <td className="sc-td text-right font-semibold tabular-nums" style={{ color: DOT[r.kleur] }}>{r.brutomarge != null ? `${r.brutomarge}%` : "—"}</td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{eur(r.nettoGeschat)}<span className="block text-2xs text-[var(--color-ink-faint)]">na overhead</span></td>
              </tr>
            ))}
          </Table>
        )}
        <div className="flex flex-wrap items-center gap-4 px-5 py-3 text-2xs text-[var(--color-ink-muted)]">
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--color-good)]" /> Gezond (≥{settings.marginGreenPct}%)</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--color-warn)]" /> Aandacht ({settings.marginOrangePct}–{settings.marginGreenPct}%)</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--color-bad)]" /> Te laag (&lt;{settings.marginOrangePct}%)</span>
          <span className="ml-auto inline-flex items-center gap-1"><Info className="size-3.5" /> {overhead.heeftData && settings.includeOverhead ? `Overhead ${eur(overhead.pool)} toegerekend ${overhead.methode} (geschat)` : "Overhead niet toegerekend (geen data of uitgezet)"}</span>
        </div>
      </Card>

      {/* Maandoverzicht / ontwikkeling */}
      <Card padded={false}>
        <CardHeader title="Ontwikkeling per maand" subtitle="Omzet, directe kosten, brutowinst en marge over de laatste maanden (alle klanten)." className="p-5 pb-2" />
        {monthly.length === 0 ? (
          <EmptyState title="Nog geen maandhistorie" description="" />
        ) : (
          <Table head={<><th className="sc-th">Maand</th><th className="sc-th text-right">Omzet</th><th className="sc-th text-right">Directe kosten</th><th className="sc-th text-right">Brutowinst</th><th className="sc-th text-right">Marge</th></>}>
            {[...monthly].reverse().map((m) => (
              <tr key={m.period} className={m.period === period ? "bg-[var(--color-surface-sunken)]" : undefined}>
                <td className="sc-td font-medium capitalize">{monthLabel(m.period)}</td>
                <td className="sc-td text-right tabular-nums">{eur(m.omzet)}</td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{eur(m.directeKosten)}</td>
                <td className="sc-td text-right font-semibold tabular-nums" style={{ color: m.brutowinst >= 0 ? "var(--color-ink)" : "var(--color-bad)" }}>{eur(m.brutowinst)}</td>
                <td className="sc-td text-right tabular-nums">
                  {m.brutomarge != null ? (
                    <span className="inline-flex items-center gap-1" style={{ color: m.brutomarge >= settings.marginGreenPct ? "var(--color-good)" : m.brutomarge >= settings.marginOrangePct ? "var(--color-warn)" : "var(--color-bad)" }}>
                      {m.brutomarge >= settings.marginOrangePct ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}{m.brutomarge}%
                    </span>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="px-5 py-3 text-xs text-[var(--color-ink-muted)]">
          De directe kosten (edit, videograaf, opname, strategie, overig) komen uit de geregistreerde maandstaten per klant; de videograafkosten worden automatisch berekend uit de opnamedagen (uren × uurtarief). De toegerekende overhead en de nettowinst daarna zijn een schatting — niet de definitieve boekhoudkundige winst.
        </p>
      </Card>
    </div>
  );
}
