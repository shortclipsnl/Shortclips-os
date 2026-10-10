import type { Metadata } from "next";
import { getManagementFinance } from "@/server/management-finance";
import { Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { compact, euro } from "@/lib/format";
import { CompanyMonthRow, FixedCostManager, SalesLeadManager, type CompanyMonth } from "./financien-ui";

export const metadata: Metadata = { title: "Financiën" };
export const dynamic = "force-dynamic";

export default async function FinancienPage() {
  // getManagementFinance checkt finance:read — feitelijk alleen de eigenaar.
  const d = await getManagementFinance();
  const companyByPeriod = new Map(d.companyRows.map((c) => [c.period, c as unknown as CompanyMonth]));
  const monthsDesc = [...d.months].reverse();
  const fixedByCat = new Map<string, number>();
  for (const f of d.fixedCosts) if (f.isActive) fixedByCat.set(f.category, (fixedByCat.get(f.category) ?? 0) + Number(f.monthlyAmount));

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader title="Financiën" description="Managementoverzicht — uitsluitend voor de eigenaar. Omzet uit de contracten en maandstaten; kosten deels automatisch, deels handmatig tot de boekhoudkoppeling (digibtw) live is." />

      {/* Kerncijfers */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Terugkerende omzet (MRR)" value={euro(d.mrr)} hint="actieve contracten/maand" />
        <Stat label="Verwacht volgende maand" value={euro(d.expectedNextMonth)} hint={`incl. ${euro(d.pipeline.monthly)} pipeline`} />
        <Stat label={`Gerealiseerd ${new Date().getFullYear()}`} value={euro(d.yearRealized)} />
        <Stat label="Vaste lasten / maand" value={euro(d.fixedTotal)} />
      </div>

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
                <span key={c} className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-2xs text-[var(--color-ink-muted)]">{c}: <strong className="text-[var(--color-ink)]">{euro(v)}</strong></span>
              ))}
            </div>
          ) : null}
          <FixedCostManager items={d.fixedCosts.map((f) => ({ id: f.id, category: f.category, name: f.name, monthlyAmount: f.monthlyAmount, isActive: f.isActive }))} />
        </Card>

        {/* Offertes & pipeline */}
        <Card padded={false}>
          <CardHeader title="Offertes & verwachte omzet" subtitle={`${d.pipeline.count} open · ${euro(d.pipeline.monthly)}/maand verwacht · ${compact(d.pipeline.value)} contractwaarde`} className="p-5 pb-2" />
          <div className="mx-5 mb-1 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-1.5 text-2xs text-[#8a5300]">Verwachte omzet staat los van de gerealiseerde omzet hierboven.</div>
          <SalesLeadManager items={d.leads.map((l) => ({ id: l.id, company: l.company, contactName: l.contactName, expectedMonthly: l.expectedMonthly, expectedValue: l.expectedValue, startOn: l.startOn, status: l.status, note: l.note }))} />
        </Card>
      </div>
    </div>
  );
}
