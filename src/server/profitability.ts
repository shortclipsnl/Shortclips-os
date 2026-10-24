import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientFinanceMonths, clients, companyFinanceMonths, fixedCosts } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { getProfitSettings, marginColor, type ProfitSettings } from "@/server/profit-settings";

/**
 * Winstgevendheid per klant. Bouwt voort op de bestaande per-klant maandstaten
 * (client_finance_months, nachtelijk gevuld). Directe kosten zijn GEREGISTREERD;
 * de toegerekende overhead en de nettowinst daarna zijn GESCHAT — dat wordt overal
 * expliciet gemarkeerd (nooit geschatte winst als definitieve nettowinst tonen).
 *
 * Uitsluitend voor de eigenaar (finance:read ⇔ owner).
 */

const n = (v: unknown) => Number(v ?? 0);
const pct = (num: number, den: number): number | null => (den !== 0 ? Math.round((num / den) * 1000) / 10 : null);

export function currentPeriod(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
}
export function prevPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export type ClientProfit = {
  clientId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  color: string | null;
  omzet: number;
  editCost: number;
  shootCost: number;
  strategyCost: number;
  otherCost: number;
  directeKosten: number;
  brutowinst: number;
  brutomarge: number | null;
  shorts: number;
  gemOmzetPerShort: number | null;
  overhead: number; // geschat (toegerekend)
  nettoGeschat: number; // brutowinst - overhead (geschat)
  nettoMarge: number | null;
  kleur: "good" | "warn" | "bad";
  /** Vorige maand (voor trend/signalen). */
  prevOmzet: number | null;
  prevBrutomarge: number | null;
  prevEditCost: number | null;
};

export type ProfitabilityOverview = {
  period: string;
  settings: ProfitSettings;
  rows: ClientProfit[];
  totals: { omzet: number; directeKosten: number; brutowinst: number; overhead: number; nettoGeschat: number; brutomarge: number | null; shorts: number };
  overhead: { pool: number; heeftData: boolean; methode: string };
};

/** Haalt de maandstaten + klantinfo op voor één periode. */
async function loadMonth(period: string) {
  const rows = await db
    .select({
      clientId: clientFinanceMonths.clientId,
      name: clients.name,
      slug: clients.slug,
      logoUrl: clients.logoUrl,
      color: clients.color,
      quota: clients.monthlyVideoQuota,
      revenue: clientFinanceMonths.revenue,
      extraRevenue: clientFinanceMonths.extraRevenue,
      editCost: clientFinanceMonths.editCost,
      shootCost: clientFinanceMonths.shootCost,
      strategyCost: clientFinanceMonths.strategyCost,
      otherCost: clientFinanceMonths.otherCost,
    })
    .from(clientFinanceMonths)
    .innerJoin(clients, eq(clients.id, clientFinanceMonths.clientId))
    .where(and(eq(clientFinanceMonths.period, period), isNull(clients.deletedAt), sql`${clients.status} <> 'churned'`));
  return rows;
}

/** Bedrijfsbrede overhead-pool voor een maand (vaste lasten + personeel + overig). */
async function overheadPool(period: string): Promise<{ pool: number; heeftData: boolean }> {
  const [fixedRow] = await db
    .select({ total: sql<string>`coalesce(sum(${fixedCosts.monthlyAmount}),0)` })
    .from(fixedCosts)
    .where(and(eq(fixedCosts.isActive, true), isNull(fixedCosts.deletedAt)));
  const [company] = await db
    .select({ staff: companyFinanceMonths.staffCost, other: companyFinanceMonths.otherCost })
    .from(companyFinanceMonths)
    .where(eq(companyFinanceMonths.period, period))
    .limit(1);
  const fixedTotal = n(fixedRow?.total);
  const staff = n(company?.staff);
  const other = n(company?.other);
  const pool = fixedTotal + staff + other;
  return { pool, heeftData: fixedTotal > 0 || staff > 0 || other > 0 };
}

/** Werkelijk opgeleverde shorts per klant in een maand. */
async function shortsByClient(period: string): Promise<Map<string, number>> {
  const res = await db.execute(sql`
    select client_id as "clientId", count(*)::int as n
    from deliverables
    where deleted_at is null
      and status in ('published','approved','scheduled','ready_to_publish','analysis_available')
      and to_char((coalesce(published_at, status_changed_at)) at time zone 'Europe/Amsterdam', 'YYYY-MM') = ${period}
    group by client_id
  `);
  const rows = ((res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<{ clientId: string; n: number }>;
  return new Map(rows.map((r) => [r.clientId, Number(r.n)]));
}

export async function getClientProfitability(period: string, trusted = false): Promise<ProfitabilityOverview> {
  // `trusted` = aangeroepen vanuit een vertrouwde server-job (cron) zonder sessie.
  if (!trusted) await requirePermission("finance:read");
  const settings = await getProfitSettings();
  const prev = prevPeriod(period);

  const [cur, prevRows, oh, shorts] = await Promise.all([loadMonth(period), loadMonth(prev), overheadPool(period), shortsByClient(period)]);

  const prevByClient = new Map(prevRows.map((r) => [r.clientId, r]));
  const totalOmzet = cur.reduce((s, r) => s + n(r.revenue) + n(r.extraRevenue), 0);
  const overheadIncluded = settings.includeOverhead && oh.heeftData;

  const rows: ClientProfit[] = cur.map((r) => {
    const omzet = n(r.revenue) + n(r.extraRevenue);
    const editCost = n(r.editCost);
    const shootCost = n(r.shootCost);
    const strategyCost = n(r.strategyCost);
    const otherCost = n(r.otherCost);
    const directeKosten = editCost + shootCost + strategyCost + otherCost;
    const brutowinst = omzet - directeKosten;
    const brutomarge = pct(brutowinst, omzet);
    // Overhead naar rato van omzetaandeel (geschat).
    const overhead = overheadIncluded && totalOmzet > 0 ? Math.round((omzet / totalOmzet) * oh.pool) : 0;
    const nettoGeschat = brutowinst - overhead;
    const sh = shorts.get(r.clientId) ?? 0;

    const p = prevByClient.get(r.clientId);
    const prevOmzet = p ? n(p.revenue) + n(p.extraRevenue) : null;
    const prevBruto = p ? (n(p.revenue) + n(p.extraRevenue)) - (n(p.editCost) + n(p.shootCost) + n(p.strategyCost) + n(p.otherCost)) : null;

    return {
      clientId: r.clientId, name: r.name, slug: r.slug, logoUrl: r.logoUrl, color: r.color,
      omzet, editCost, shootCost, strategyCost, otherCost, directeKosten, brutowinst, brutomarge,
      shorts: sh, gemOmzetPerShort: sh > 0 ? Math.round(omzet / sh) : null,
      overhead, nettoGeschat, nettoMarge: pct(nettoGeschat, omzet),
      kleur: marginColor(brutomarge, settings),
      prevOmzet,
      prevBrutomarge: prevOmzet != null && prevOmzet !== 0 && prevBruto != null ? pct(prevBruto, prevOmzet) : null,
      prevEditCost: p ? n(p.editCost) : null,
    };
  });

  rows.sort((a, b) => b.brutowinst - a.brutowinst);

  const totals = rows.reduce(
    (acc, r) => {
      acc.omzet += r.omzet; acc.directeKosten += r.directeKosten; acc.brutowinst += r.brutowinst;
      acc.overhead += r.overhead; acc.nettoGeschat += r.nettoGeschat; acc.shorts += r.shorts;
      return acc;
    },
    { omzet: 0, directeKosten: 0, brutowinst: 0, overhead: 0, nettoGeschat: 0, brutomarge: null as number | null, shorts: 0 },
  );
  totals.brutomarge = pct(totals.brutowinst, totals.omzet);

  return { period, settings, rows, totals, overhead: { pool: oh.pool, heeftData: oh.heeftData, methode: "naar rato van omzet" } };
}

/** Maandoverzicht (bedrijfsbreed) voor de ontwikkeling t.o.v. vorige maanden. */
export async function getProfitabilityMonthly(months = 6): Promise<Array<{ period: string; omzet: number; directeKosten: number; brutowinst: number; brutomarge: number | null }>> {
  await requirePermission("finance:read");
  const res = await db.execute(sql`
    select cfm.period as period,
           coalesce(sum(cfm.revenue + cfm.extra_revenue),0)::numeric as omzet,
           coalesce(sum(cfm.edit_cost + cfm.shoot_cost + cfm.strategy_cost + cfm.other_cost),0)::numeric as kosten
    from client_finance_months cfm
    join clients c on c.id = cfm.client_id and c.deleted_at is null and c.status <> 'churned'
    group by cfm.period
    order by cfm.period desc
    limit ${months}
  `);
  const rows = ((res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<{ period: string; omzet: string; kosten: string }>;
  return rows
    .map((r) => {
      const omzet = n(r.omzet);
      const directeKosten = n(r.kosten);
      const brutowinst = omzet - directeKosten;
      return { period: r.period, omzet, directeKosten, brutowinst, brutomarge: pct(brutowinst, omzet) };
    })
    .reverse();
}

/* ------------------------------------------------------------- signalen */

export type ProfitSignal = {
  clientId: string;
  clientName: string;
  level: "warning" | "critical";
  title: string;
  oorzaak: string;
  voorstel: string;
  dedupeKey: string;
};

/**
 * Leidt financiële waarschuwingen af uit de winstgevendheidsdata. Gedeeld door de
 * pagina (weergave) en de nachtelijke job (melding), zodat de logica identiek is.
 */
export function computeProfitabilitySignals(overview: ProfitabilityOverview, dedupeSuffix: string): ProfitSignal[] {
  const out: ProfitSignal[] = [];
  const s = overview.settings;
  for (const r of overview.rows) {
    if (r.omzet <= 0 && r.directeKosten <= 0) continue; // geen activiteit → geen melding
    const key = (kind: string) => `profit_${kind}:${r.clientId}:${dedupeSuffix}`;

    // Verliesgevend
    if (r.brutowinst < 0) {
      out.push({
        clientId: r.clientId, clientName: r.name, level: "critical",
        title: `${r.name} is verliesgevend`,
        oorzaak: `De directe kosten (€${Math.round(r.directeKosten)}) zijn hoger dan de omzet (€${Math.round(r.omzet)}).`,
        voorstel: "Herzie het tarief of beperk de directe kosten (edit/opname). Overweeg een hoger maandbedrag of minder shorts.",
        dedupeKey: key("loss"),
      });
      continue;
    }
    // Structureel lage marge
    if (r.brutomarge != null && r.brutomarge < s.marginOrangePct) {
      out.push({
        clientId: r.clientId, clientName: r.name, level: "warning",
        title: `${r.name} heeft een lage marge (${r.brutomarge}%)`,
        oorzaak: `De brutomarge ligt onder de grens van ${s.marginOrangePct}%.`,
        voorstel: "Bekijk of het tarief omhoog kan of de edit-/opnamekosten omlaag. Vergelijk met vergelijkbare klanten.",
        dedupeKey: key("lowmargin"),
      });
    }
    // Marge daalt terwijl omzet groeit
    if (r.prevOmzet != null && r.prevBrutomarge != null && r.brutomarge != null && r.omzet > r.prevOmzet && r.brutomarge < r.prevBrutomarge - 5) {
      out.push({
        clientId: r.clientId, clientName: r.name, level: "warning",
        title: `${r.name}: omzet groeit maar marge daalt`,
        oorzaak: `Omzet steeg t.o.v. vorige maand, maar de brutomarge daalde van ${r.prevBrutomarge}% naar ${r.brutomarge}%.`,
        voorstel: "Controleer of de kosten sneller stijgen dan de omzet (bv. meer revisies of extra opnames).",
        dedupeKey: key("margindrop"),
      });
    }
    // Editkosten stijgen opvallend
    if (r.prevEditCost != null && r.prevEditCost > 0 && r.editCost > r.prevEditCost * 1.25 && r.editCost - r.prevEditCost >= 50) {
      const stijging = Math.round(((r.editCost - r.prevEditCost) / r.prevEditCost) * 100);
      out.push({
        clientId: r.clientId, clientName: r.name, level: "warning",
        title: `${r.name}: editkosten stijgen (+${stijging}%)`,
        oorzaak: `De editkosten gingen van €${Math.round(r.prevEditCost)} naar €${Math.round(r.editCost)}.`,
        voorstel: "Check het aantal revisierondes en of het editortarief klopt met de afspraak.",
        dedupeKey: key("editcost"),
      });
    }
  }
  return out;
}
