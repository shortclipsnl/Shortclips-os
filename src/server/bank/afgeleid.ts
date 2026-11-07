import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { vermogenDocs } from "../../db/schema";

/**
 * Houdt na elke import alles wat van de financiële bronnen afhangt actueel:
 *  - vermogensdashboard: nieuwste saldo per zakelijke Knab-rekening (uit CAMT.053)
 *    en het Revolut-saldo (uit het afschrift);
 *  - omzetprognose (v/prognose): omzet uit DigiBoox, bedrijfskosten uit de Kostenmonitor,
 *    voor alle afgesloten maanden.
 * Bestaande standen blijven bewaard (historie); er komt alleen een nieuwe stand bij.
 * Geen `server-only`.
 */

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

async function put(db: Db, path: string, data: unknown) {
  await db
    .insert(vermogenDocs)
    .values({ path, data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: vermogenDocs.path, set: { data, updatedAt: new Date() } });
}

export async function werkAfgeleideCijfersBij(db: Db, opts: { revolut?: { bedrag: number; datum: string } | null } = {}) {
  const log: string[] = [];
  const [cfgRow] = await db.select({ data: vermogenDocs.data }).from(vermogenDocs).where(eq(vermogenDocs.path, "v/cfg"));
  type Rek = { id: string; iban?: string; instelling?: string };
  const rekeningen = ((cfgRow?.data as { rekeningen?: Rek[] } | undefined)?.rekeningen ?? []) as Rek[];

  // 1. Knab-saldi uit de nieuwste afschriften.
  for (const r of rekeningen.filter((x) => x.iban)) {
    const iban = r.iban!.replace(/\s/g, "").toUpperCase();
    const [a] = rows<{ tot: string; eindsaldo: string | null }>(
      await db.execute(sql`select tot::text, eindsaldo from bank_afschriften where iban = ${iban} and eindsaldo is not null order by tot desc limit 1`),
    );
    if (!a?.eindsaldo) continue;
    const bedrag = Number(a.eindsaldo);
    await put(db, `v/cfg/saldi/${r.id}_${a.tot}`, { eur: bedrag, rek: r.id, bron: `Knab CAMT.053 t/m ${a.tot}`, datum: a.tot, koers: 1, bedrag, valuta: "EUR", koersdatum: a.tot });
    log.push(`Vermogen: ${r.id} ${bedrag.toFixed(2)} per ${a.tot}`);
  }

  // 2. Revolut-saldo.
  const rev = rekeningen.find((x) => (x.instelling ?? "").toLowerCase() === "revolut");
  if (rev && opts.revolut) {
    const { bedrag, datum } = opts.revolut;
    await put(db, `v/cfg/saldi/${rev.id}_${datum}`, { eur: bedrag, rek: rev.id, bron: `Revolut afschrift t/m ${datum}`, datum, koers: 1, bedrag, valuta: "EUR", koersdatum: datum });
    log.push(`Vermogen: ${rev.id} ${bedrag.toFixed(2)} per ${datum}`);
  }

  // 3. Omzetprognose: afgesloten maanden uit dezelfde bronnen als de dashboards.
  const [pRow] = await db.select({ data: vermogenDocs.data }).from(vermogenDocs).where(eq(vermogenDocs.path, "v/prognose"));
  if (pRow) {
    const p = structuredClone(pRow.data) as { maanden?: Record<string, { omzet?: number; kosten?: number }>; bron?: string; bijgewerkt?: string };
    p.maanden ??= {};
    const huidig = new Date().toISOString().slice(0, 7);
    const om = rows<{ m: string; v: number }>(await db.execute(sql`select period m, book_revenue::float v from company_finance_months where book_source is not null and period < ${huidig}`));
    const ko = rows<{ m: string; v: number }>(
      await db.execute(sql`select maand m, sum(zonder_btw)::float v from kosten_regels where maand < ${huidig} and groep in ('personeel','editors','freelancers','marketing','vast','operationeel') group by 1`),
    );
    for (const r of om) (p.maanden[r.m] ??= {}).omzet = Math.round(r.v);
    for (const r of ko) (p.maanden[r.m] ??= {}).kosten = Math.round(r.v);
    p.bron = "Shortclips OS: omzet DigiBoox, kosten Kostenmonitor (Knab + Revolut-software)";
    p.bijgewerkt = new Date().toISOString().slice(0, 10);
    await put(db, "v/prognose", p);
    log.push(`Omzetprognose bijgewerkt (${om.length} maanden omzet, ${ko.length} maanden kosten)`);
  }
  return log;
}
