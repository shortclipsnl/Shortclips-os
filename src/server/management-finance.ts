import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, companyFinanceMonths, fixedCosts, salesLeads } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

/** Managementcijfers voor de eigenaar. Omzet uit actieve contracten +
 *  gerealiseerde maandstaten; kosten uit de maandstaten (direct) en de
 *  bedrijfsbrede invoer (freelance/personeel/overig/vaste lasten). */
export async function getManagementFinance() {
  // RBAC: uitsluitend met finance:read (feitelijk alleen de eigenaar).
  await requirePermission("finance:read");

  const [activeClients, perMonthRes, companyRows, fixed, leads] = await Promise.all([
    db.select({ revenue: clients.monthlyRevenue, extra: clients.extraRevenue }).from(clients).where(and(isNull(clients.deletedAt), eq(clients.status, "active"))),
    db.execute(sql`
      select period,
        coalesce(sum(revenue + extra_revenue),0)::float income,
        coalesce(sum(edit_cost + shoot_cost + strategy_cost + other_cost),0)::float direct_cost
      from client_finance_months group by period order by period
    `),
    db.select().from(companyFinanceMonths).orderBy(asc(companyFinanceMonths.period)),
    db.select().from(fixedCosts).where(isNull(fixedCosts.deletedAt)).orderBy(asc(fixedCosts.category), asc(fixedCosts.name)),
    db.select().from(salesLeads).where(isNull(salesLeads.deletedAt)).orderBy(desc(salesLeads.createdAt)),
  ]);

  const mrr = activeClients.reduce((a, c) => a + Number(c.revenue || 0) + Number(c.extra || 0), 0);
  const fixedTotal = fixed.filter((f) => f.isActive).reduce((a, f) => a + Number(f.monthlyAmount), 0);
  const companyByPeriod = new Map(companyRows.map((c) => [c.period, c]));

  type PM = { period: string; income: number; direct_cost: number };
  const months = rows<PM>(perMonthRes).map((m) => {
    const comp = companyByPeriod.get(m.period);
    const freelance = comp ? Number(comp.freelanceCost) : 0;
    const staff = comp ? Number(comp.staffCost) : 0;
    const other = comp ? Number(comp.otherCost) : 0;
    const target = comp ? Number(comp.revenueTarget) : 0;
    const totalCost = m.direct_cost + freelance + staff + other + fixedTotal;
    const result = m.income - totalCost;
    return {
      period: m.period,
      income: m.income,
      directCost: m.direct_cost,
      freelance, staff, other, fixed: fixedTotal, target,
      totalCost, result,
      margin: m.income > 0 ? Math.round((result / m.income) * 100) : 0,
    };
  });

  // Pipeline: verwachte omzet uit open offertes/leads.
  const openLeads = leads.filter((l) => ["lead", "offerte", "onderhandeling"].includes(l.status));
  const pipelineMonthly = openLeads.reduce((a, l) => a + Number(l.expectedMonthly), 0);
  const pipelineValue = openLeads.reduce((a, l) => a + Number(l.expectedValue), 0);

  const year = new Date().getFullYear().toString();
  const yearRealized = months.filter((m) => m.period.startsWith(year)).reduce((a, m) => a + m.income, 0);

  // Officiële boekhouding (geïmporteerd uit Digiboox): per maand + jaartotaal.
  const bookMonths = companyRows
    .filter((c) => c.bookSource && (Number(c.bookRevenue) || Number(c.bookCost) || Number(c.bookFinanceIncome)))
    .map((c) => {
      const revenue = Number(c.bookRevenue);
      const cost = Number(c.bookCost);
      const financeIncome = Number(c.bookFinanceIncome);
      return { period: c.period, revenue, cost, financeIncome, result: revenue + financeIncome - cost, importedAt: c.bookImportedAt };
    })
    .sort((a, b) => a.period.localeCompare(b.period));
  const bookThisYear = bookMonths.filter((m) => m.period.startsWith(year));
  const book = {
    hasData: bookMonths.length > 0,
    months: bookMonths,
    lastImportedAt: bookMonths.reduce<Date | null>((a, m) => (m.importedAt && (!a || m.importedAt > a) ? m.importedAt : a), null),
    yearRevenue: bookThisYear.reduce((a, m) => a + m.revenue, 0),
    yearCost: bookThisYear.reduce((a, m) => a + m.cost, 0),
    yearFinanceIncome: bookThisYear.reduce((a, m) => a + m.financeIncome, 0),
    yearResult: bookThisYear.reduce((a, m) => a + m.result, 0),
  };

  return {
    book,
    mrr,
    expectedNextMonth: mrr + pipelineMonthly,
    yearRealized,
    fixedTotal,
    months,
    fixedCosts: fixed,
    leads,
    pipeline: { monthly: pipelineMonthly, value: pipelineValue, count: openLeads.length },
    companyRows,
  };
}
