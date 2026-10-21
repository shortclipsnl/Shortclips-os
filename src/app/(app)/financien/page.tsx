import type { Metadata } from "next";
import { Repeat, CalendarClock, Wallet, Receipt } from "lucide-react";
import { requireOwner } from "@/server/auth/context";
import { getManagementFinance } from "@/server/management-finance";
import { getCapacityOverview } from "@/server/capacity";
import { Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { compact, euro, formatDate } from "@/lib/format";
import { CompanyMonthRow, DigibooxImport, FixedCostManager, SalesLeadManager, type CompanyMonth } from "./financien-ui";
import { GrowthSimulator } from "../capaciteit/simulator";

function monthLabel(p: string) {
  const [y, m] = p.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "short", year: "numeric" });
}

const MN_SHORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
function shortMonth(p: string) {
  const [y, m] = p.split("-").map(Number);
  return `${MN_SHORT[(m ?? 1) - 1]} '${String(y).slice(2)}`;
}

export const metadata: Metadata = { title: "Financiën" };
export const dynamic = "force-dynamic";

export default async function FinancienPage() {
  // Financiën is uitsluitend voor de eigenaar — hard afgedwongen op paginaniveau
  // (defense-in-depth), náást de finance:read-check in getManagementFinance.
  await requireOwner();
  const [d, capacity] = await Promise.all([getManagementFinance(), getCapacityOverview()]);
  const companyByPeriod = new Map(d.companyRows.map((c) => [c.period, c as unknown as CompanyMonth]));
  const monthsDesc = [...d.months].reverse();
  // Omzetgrafiek: laatste 12 maanden, in volgorde.
  const chartMonths = d.months.slice(-12);
  const maxOmzet = Math.max(1, ...chartMonths.map((m) => m.income));
  // Parameters voor de groeisimulator (verplaatst vanaf Teamcapaciteit).
  const capParam = new Map(capacity.params.map((p) => [p.key, p.value ?? 0]));
  const fixedByCat = new Map<string, number>();
  for (const f of d.fixedCosts) if (f.isActive) fixedByCat.set(f.category, (fixedByCat.get(f.category) ?? 0) + Number(f.monthlyAmount));

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader title="Financiën" description="Managementoverzicht — uitsluitend voor de eigenaar. Omzet uit de contracten en maandstaten; kosten deels automatisch, deels handmatig tot de boekhoudkoppeling (digibtw) live is." />

      {/* Kerncijfers */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Terugkerende omzet (MRR)" value={euro(d.mrr)} hint="actieve contracten/maand" tone="good" icon={<Repeat />} />
        <Stat label="Verwacht volgende maand" value={euro(d.expectedNextMonth)} hint={`incl. ${euro(d.pipeline.monthly)} pipeline`} tone="info" icon={<CalendarClock />} />
        <Stat label={`Gerealiseerd ${new Date().getFullYear()}`} value={euro(d.yearRealized)} tone="good" icon={<Wallet />} />
        <Stat label="Vaste lasten / maand" value={euro(d.fixedTotal)} tone="warn" icon={<Receipt />} />
      </div>

      {/* Omzet per maand — als grafiek, zodat de trend in één oogopslag scanbaar is. */}
      {chartMonths.length > 0 ? (
        <Card className="mb-6">
          <CardHeader title="Omzet per maand" subtitle={`Gefactureerde omzet per maand — de laatste ${chartMonths.length} maanden in één oogopslag.`} />
          <div className="mt-4 flex h-44 items-end gap-1.5 sm:gap-2">
            {chartMonths.map((m) => {
              const h = Math.max(2, Math.round((m.income / maxOmzet) * 92));
              return (
                <div key={m.period} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-2xs font-semibold tabular-nums text-[var(--color-ink-muted)]">{m.income > 0 ? compact(m.income) : ""}</span>
                  <div
                    className="w-full rounded-t-[4px]"
                    style={{ height: `${h}%`, background: "linear-gradient(180deg, var(--color-brand-400), var(--color-brand-700))" }}
                    title={`${monthLabel(m.period)}: ${euro(m.income)}`}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-1.5 sm:gap-2">
            {chartMonths.map((m) => (
              <span key={m.period} className="min-w-0 flex-1 truncate text-center text-2xs text-[var(--color-ink-faint)]">{shortMonth(m.period)}</span>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Boekhouding (Digiboox) — officiële cijfers */}
      <Card padded={false} className="mb-6 overflow-hidden ring-1 ring-[var(--color-brand-600)]/15">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--color-brand-700,#00003b)] px-5 py-3 text-white">
          <div>
            <h2 className="text-base font-bold tracking-tight">Boekhouding · Digiboox</h2>
            <p className="text-xs text-white/70">
              Officiële omzet, kosten en resultaat uit de boekhouding.
              {d.book.lastImportedAt ? ` Laatst ingelezen ${formatDate(d.book.lastImportedAt)}.` : " Nog niet ingelezen — upload hieronder je export."}
            </p>
          </div>
          {d.book.hasData ? (
            <div className="flex gap-4 text-right">
              <div><div className="text-2xs uppercase tracking-wide text-white/60">Omzet {new Date().getFullYear()}</div><div className="text-lg font-bold tabular-nums">{euro(d.book.yearRevenue)}</div></div>
              <div><div className="text-2xs uppercase tracking-wide text-white/60">Kosten</div><div className="text-lg font-bold tabular-nums">{euro(d.book.yearCost)}</div></div>
              <div><div className="text-2xs uppercase tracking-wide text-white/60">Resultaat</div><div className="text-lg font-bold tabular-nums">{euro(d.book.yearResult)}</div></div>
            </div>
          ) : null}
        </div>

        {d.book.hasData ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-faint)]">
                  <th className="px-4 py-2 font-medium">Maand</th>
                  <th className="px-3 py-2 text-right font-medium">Omzet</th>
                  <th className="px-3 py-2 text-right font-medium">Financiële baten</th>
                  <th className="px-3 py-2 text-right font-medium">Kosten</th>
                  <th className="px-3 py-2 text-right font-medium">Resultaat</th>
                </tr>
              </thead>
              <tbody>
                {[...d.book.months].reverse().map((m) => (
                  <tr key={m.period} className="border-b border-[var(--color-line)]">
                    <td className="px-4 py-2 font-medium">{monthLabel(m.period)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{euro(m.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">{m.financeIncome ? euro(m.financeIncome) : "–"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">{euro(m.cost)}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${m.result >= 0 ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{euro(m.result)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Nog geen boekhoudcijfers" description="Upload je Digiboox-export om omzet, kosten en resultaat per maand automatisch te vullen." />
        )}

        <DigibooxImport />
      </Card>

      {/* Winstoverzicht per maand */}
      <Card padded={false} className="mb-6 overflow-hidden ring-1 ring-[var(--color-indigo-ink)]/15">
        <div className="bg-[var(--color-indigo-ink)] px-5 py-3 text-white">
          <h2 className="text-base font-bold tracking-tight">Winstoverzicht per maand</h2>
          <p className="text-xs text-white/70">Omzet en directe kosten komen automatisch uit de maandstaten; vul freelance-, personeels- en overige kosten + het omzetdoel in. Vaste lasten worden automatisch meegeteld.</p>
        </div>
        {d.months.length === 0 ? (
          <EmptyState title="Nog geen maanden" description="Zodra de maandstaten gevuld zijn, verschijnt hier de winst per maand." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-faint)]">
                  <th className="px-4 py-2 font-medium">Maand</th>
                  <th className="px-2 py-2 text-right font-medium">Omzet</th>
                  <th className="px-2 py-2 text-right font-medium">Doel</th>
                  <th className="px-2 py-2 text-right font-medium">Direct</th>
                  <th className="px-2 py-2 text-right font-medium">Freelance</th>
                  <th className="px-2 py-2 text-right font-medium">Personeel</th>
                  <th className="px-2 py-2 text-right font-medium">Vaste lasten</th>
                  <th className="px-2 py-2 text-right font-medium">Overig</th>
                  <th className="px-2 py-2 text-right font-medium">Resultaat</th>
                  <th className="px-2 py-2 text-right font-medium">Marge</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {monthsDesc.map((m) => (
                  <CompanyMonthRow key={m.period} period={m.period} income={m.income} directCost={m.directCost} fixedTotal={d.fixedTotal} company={companyByPeriod.get(m.period)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-5 py-3 text-xs text-[var(--color-ink-muted)]">Resultaat = omzet − directe productiekosten − freelance − personeel − vaste lasten − overig. Zodra de digibtw-koppeling live is, worden deze kostenvelden automatisch gevuld.</p>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Vaste lasten */}
        <Card padded={false}>
          <CardHeader title={`Vaste lasten · ${euro(d.fixedTotal)}/maand`} subtitle="Terugkerende maandelijkse kosten per categorie." className="p-5 pb-2" />
          {fixedByCat.size > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-5 pb-2">
              {[...fixedByCat.entries()].map(([c, v]) => (
                <span key={c} className="rounded-full bg-[var(--color-neutral-soft)] px-2.5 py-1 text-2xs text-[var(--color-ink-muted)]">{c}: <strong className="text-[var(--color-ink)]">{euro(v)}</strong></span>
              ))}
            </div>
          ) : null}
          <FixedCostManager items={d.fixedCosts.map((f) => ({ id: f.id, category: f.category, name: f.name, monthlyAmount: f.monthlyAmount, isActive: f.isActive }))} />
        </Card>

        {/* Offertes & pipeline */}
        <Card padded={false}>
          <CardHeader title="Offertes & verwachte omzet" subtitle={`${d.pipeline.count} open · ${euro(d.pipeline.monthly)}/maand verwacht · ${compact(d.pipeline.value)} contractwaarde`} className="p-5 pb-2" />
          <div className="mx-5 mb-1 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-1.5 text-2xs text-[#8a5300]">
            <span>Verwachte omzet staat los van de gerealiseerde omzet hierboven.</span>
            <a href="/leads" className="font-semibold underline">Alle leads →</a>
          </div>
          <SalesLeadManager items={d.leads.map((l) => ({ id: l.id, company: l.company, contactName: l.contactName, expectedMonthly: l.expectedMonthly, expectedValue: l.expectedValue, startOn: l.startOn, status: l.status, note: l.note }))} />
        </Card>
      </div>

      {/* Groeisimulator — verplaatst vanaf Teamcapaciteit; staat nu uitsluitend bij de eigenaar. */}
      <div className="mt-6">
        <GrowthSimulator
          currentClients={capacity.summary.activeClients}
          canSeeFinance
          p={{
            shortsPerClient: capParam.get("shorts_klant_contract") ?? 5.56,
            opnPerClient: capParam.get("opn_klant_contract") ?? 1,
            editPerEditor: capParam.get("edit_cap_editor") ?? 24,
            ccClientsHigh: capParam.get("cc_klanten_hoog") ?? 26,
            vgCapacity: capParam.get("vg_hoog_4w") ?? 16,
            revenuePerClient: capParam.get("omzet_klant") ?? 1978,
            costStaff: capParam.get("kosten_medewerker") ?? 2775,
            editCostShort: capParam.get("edit_kosten_short") ?? 48,
            costOverig: capParam.get("kosten_overig") ?? 480,
          }}
        />
      </div>
    </div>
  );
}
