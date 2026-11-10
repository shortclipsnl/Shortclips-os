import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { Card, CardHeader, ClientLogo, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { requireFinanceOwner } from "@/server/auth/finance-guard";
import { currentPeriod, getClientProfitabilityDetail, prevPeriod } from "@/server/profitability";

export const metadata: Metadata = { title: "Winstgevendheid klant" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const eur = (v: number) => `€${Math.round(v).toLocaleString("nl-NL")}`;
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
const dag = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : "–");

export default async function WinstgevendheidKlantPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ maand?: string }> }) {
  await requireFinanceOwner();
  const { slug } = await params;
  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.maand ?? "") ? sp.maand! : currentPeriod();

  const detail = await getClientProfitabilityDetail(slug, period);
  if (!detail) notFound();
  const { client, month, shorts, opnames, history, settings } = detail;
  const overheadOn = month ? month.overhead > 0 || settings.includeOverhead : settings.includeOverhead;

  return (
    <div className="mx-auto max-w-[1100px]">
      <Link href={`/winstgevendheid?maand=${period}`} className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><ArrowLeft className="size-4" /> Winstgevendheid</Link>
      <PageHeader
        title={<span className="flex items-center gap-2"><ClientLogo name={client.name} logoUrl={client.logoUrl} color={client.color} size={28} /> {client.name}</span>}
        description="Het financiële detail per maand: kostenopbouw, de shorts met editor en editkosten, de opnames en de ontwikkeling over de maanden."
      />

      {/* Maandkiezer */}
      <div className="mb-4 flex items-center gap-2">
        <Link href={`/winstgevendheid/${slug}?maand=${prevPeriod(period)}`} className="inline-flex size-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"><ChevronLeft className="size-4" /></Link>
        <span className="min-w-[9rem] text-center text-sm font-semibold capitalize">{monthLabel(period)}</span>
        <Link href={`/winstgevendheid/${slug}?maand=${nextPeriod(period)}`} className="inline-flex size-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"><ChevronRight className="size-4" /></Link>
      </div>

      {!month ? (
        <Card><EmptyState title="Geen maandcijfers voor deze maand" description="Voor deze klant staat er voor deze maand nog geen financiële staat." /></Card>
      ) : (
        <>
          {/* Kostenopbouw van de maand */}
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Omzet" value={eur(month.omzet)} hint={`${month.shorts} shorts`} />
            <Stat label="Editingkosten" value={eur(month.editCost)} />
            <Stat label="Videograafkosten" value={eur(month.videographerCost)} />
            <Stat label="Scriptingkosten" value={month.internRateMissing ? "nog instellen" : eur(month.scriptingCost)} tone={month.internRateMissing ? "warn" : "neutral"} hint={month.internRateMissing ? undefined : `${settings.internUrenPerKlant}u × €${settings.internUurtarief}`} />
            <Stat label="Overige directe kosten" value={eur(month.overigeKosten)} />
            <Stat label="Totale directe kosten" value={eur(month.directeKosten)} />
            <Stat label="Brutowinst" value={eur(month.brutowinst)} tone={month.brutowinst >= 0 ? "good" : "bad"} hint={month.brutomarge != null ? `marge ${month.brutomarge}%` : undefined} />
            <Stat label="Nettowinst (geschat)" value={overheadOn ? eur(month.nettoGeschat) : "—"} tone={!overheadOn ? "neutral" : month.nettoGeschat >= 0 ? "good" : "bad"} hint={overheadOn ? "na overhead" : "overhead nog instellen"} />
          </div>

          {/* Shorts met editor en editkosten */}
          <Card padded={false} className="mb-5">
            <CardHeader title={`Shorts in ${monthLabel(period)}`} subtitle={`${shorts.length} opgeleverd · editingkosten per short uit het toegewezen editortarief`} className="p-5 pb-2" />
            {shorts.length === 0 ? (
              <EmptyState title="Geen opgeleverde shorts deze maand" description="" />
            ) : (
              <Table head={<><th className="sc-th">Short</th><th className="sc-th">Editor</th><th className="sc-th text-right">Editkosten</th><th className="sc-th text-right">Datum</th></>}>
                {shorts.map((s) => (
                  <tr key={s.id}>
                    <td className="sc-td"><span className="line-clamp-1 max-w-[420px] font-medium">{s.title}</span></td>
                    <td className="sc-td text-[var(--color-ink-muted)]">{s.editor ?? <span className="text-[var(--color-warn)]" title="Geen editor toegewezen">niet toegewezen</span>}</td>
                    <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{s.editCost > 0 ? eur(s.editCost) : <span className="text-[var(--color-warn)]" title="Geen editkosten/tarief vastgelegd">—</span>}</td>
                    <td className="sc-td text-right tabular-nums text-[var(--color-ink-faint)]">{dag(s.datum)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          {/* Opnames */}
          <Card padded={false} className="mb-5">
            <CardHeader title={`Opnames in ${monthLabel(period)}`} subtitle="Videograafkosten = gefilmde uren × het ingestelde uurtarief." className="p-5 pb-2" />
            {opnames.length === 0 ? (
              <EmptyState title="Geen opnames deze maand" description="" />
            ) : (
              <Table head={<><th className="sc-th">Opnamedag</th><th className="sc-th">Videograaf</th><th className="sc-th text-right">Uren</th><th className="sc-th text-right">Datum</th></>}>
                {opnames.map((o, i) => (
                  <tr key={i}>
                    <td className="sc-td"><span className="line-clamp-1 max-w-[420px] font-medium">{o.title}</span></td>
                    <td className="sc-td text-[var(--color-ink-muted)]">{o.videograaf ?? <span className="text-[var(--color-ink-faint)]">—</span>}</td>
                    <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{Math.round(o.uren * 10) / 10}u</td>
                    <td className="sc-td text-right tabular-nums text-[var(--color-ink-faint)]">{dag(o.datum)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          {/* Ontwikkeling over de maanden */}
          <Card padded={false}>
            <CardHeader title="Ontwikkeling over de maanden" subtitle="Omzet, directe kosten, brutowinst en marge per maand voor deze klant." className="p-5 pb-2" />
            {history.length === 0 ? (
              <EmptyState title="Nog geen maandhistorie" description="" />
            ) : (
              <Table head={<><th className="sc-th">Maand</th><th className="sc-th text-right">Omzet</th><th className="sc-th text-right">Directe kosten</th><th className="sc-th text-right">Brutowinst</th><th className="sc-th text-right">Marge</th></>}>
                {[...history].reverse().map((h) => (
                  <tr key={h.period} className={h.period === period ? "bg-[var(--color-surface-sunken)]" : undefined}>
                    <td className="sc-td font-medium capitalize">{monthLabel(h.period)}</td>
                    <td className="sc-td text-right tabular-nums">{eur(h.omzet)}</td>
                    <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{eur(h.directeKosten)}</td>
                    <td className="sc-td text-right font-semibold tabular-nums" style={{ color: h.brutowinst >= 0 ? "var(--color-ink)" : "var(--color-bad)" }}>{eur(h.brutowinst)}</td>
                    <td className="sc-td text-right tabular-nums">{h.brutomarge != null ? `${h.brutomarge}%` : "—"}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
