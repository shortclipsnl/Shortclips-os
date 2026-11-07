import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { bankAfschriften, bankTransacties, companyFinanceMonths, kostenOmzet, kostenRegels } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { deelIn, isBedrijfskostGroep, norm, type Indeling, type LeverancierIndex } from "./categorie";

/**
 * Maandcontrole: alles wat nodig is om één maand financieel te controleren,
 * met per cijfer de bron en of die bron de maand volledig dekt.
 * Omzet, kosten, resultaat, cashflow en banksaldo blijven strikt gescheiden.
 */

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const r2 = (n: number) => Math.round(n * 100) / 100;

export function lastDay(maand: string): string {
  const [y, m] = maand.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}
export function prevMonth(maand: string, n = 1): string {
  const [y, m] = maand.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}

export type Dekking = "compleet" | "voorlopig" | "ontbreekt";

export type MaandTransactie = {
  id: string;
  datum: string;
  rekening: string;
  bedrag: number;
  tegenpartij: string;
  omschrijving: string;
  tegenrekening: string;
} & Indeling;

async function leveranciersIndex(): Promise<LeverancierIndex> {
  // Meest recente indeling per leverancier uit de Kostenmonitor.
  const res = await db.execute(sql`
    select distinct on (lower(leverancier)) leverancier, subcategorie, groep, soort
    from kosten_regels order by lower(leverancier), maand desc`);
  const idx: LeverancierIndex = new Map();
  for (const r of rows<{ leverancier: string; subcategorie: string; groep: string; soort: string }>(res)) {
    if (["prive", "belasting"].includes(r.groep) && r.subcategorie !== "Privé en reserveringen") continue;
    idx.set(norm(r.leverancier), { categorie: r.subcategorie, groep: r.groep, soort: r.soort as Indeling["soort"] });
  }
  return idx;
}

export async function getSyncStatus() {
  await requirePermission("finance:read");
  const [afschriften, book, kosten, omzet] = await Promise.all([
    db.select().from(bankAfschriften).orderBy(desc(bankAfschriften.tot)),
    db
      .select({ period: companyFinanceMonths.period, at: companyFinanceMonths.bookImportedAt })
      .from(companyFinanceMonths)
      .where(sql`${companyFinanceMonths.bookSource} is not null`)
      .orderBy(desc(companyFinanceMonths.bookImportedAt))
      .limit(1),
    db.select({ maand: sql<string>`max(${kostenRegels.maand})`, bijgewerkt: sql<string | null>`max(${kostenRegels.bijgewerkt})::text`, at: sql<Date | null>`max(${kostenRegels.updatedAt})` }).from(kostenRegels),
    db.select({ maand: sql<string>`max(${kostenOmzet.maand})` }).from(kostenOmzet),
  ]);

  // Per rekening: de meest recente periode en de laatste aansluitcontrole.
  const perRekening = new Map<string, (typeof afschriften)[number]>();
  for (const a of afschriften) if (!perRekening.has(a.iban)) perRekening.set(a.iban, a);
  const [txMax] = await db
    .select({ at: sql<Date | null>`max(${bankTransacties.importedAt})`, datum: sql<string | null>`max(${bankTransacties.boekdatum})::text` })
    .from(bankTransacties);

  const vandaag = new Date();
  const dagenOud = (d: string | Date | null | undefined) =>
    d ? Math.floor((vandaag.getTime() - new Date(d).getTime()) / 86_400_000) : null;

  const bronnen = [
    {
      key: "knab",
      naam: "Knab bankmutaties (CAMT.053)",
      laatsteSync: txMax?.at ?? null,
      dataTot: txMax?.datum ?? null,
      dagenOud: dagenOud(txMax?.datum),
    },
    {
      key: "digiboox",
      naam: "DigiBoox boekhouding (omzet)",
      laatsteSync: book[0]?.at ?? null,
      dataTot: book[0]?.at ? new Date(book[0].at).toISOString().slice(0, 10) : null,
      dagenOud: dagenOud(book[0]?.at),
    },
    {
      key: "kostenmonitor",
      naam: "Kostenmonitor (kosten per leverancier)",
      laatsteSync: kosten[0]?.at ?? null,
      dataTot: kosten[0]?.bijgewerkt ?? null,
      dagenOud: dagenOud(kosten[0]?.bijgewerkt),
    },
  ].map((b) => ({
    ...b,
    status: b.dagenOud == null ? ("ontbreekt" as const) : b.dagenOud > 7 ? ("verouderd" as const) : ("actueel" as const),
  }));

  return {
    bronnen,
    rekeningen: [...perRekening.values()].map((a) => ({
      iban: a.iban,
      naam: a.rekeningNaam,
      tot: a.tot,
      eindsaldo: a.eindsaldo == null ? null : Number(a.eindsaldo),
      controle: a.controle,
      importedAt: a.importedAt,
    })),
    laatsteOmzetMaand: omzet[0]?.maand ?? null,
  };
}

export async function getMaandControle(maand: string) {
  await requirePermission("finance:read");
  const eind = lastDay(maand);
  const start = `${maand}-01`;
  const vorige = [1, 2, 3].map((n) => prevMonth(maand, n));

  const [bekend, tx, afschriften, book, kostenRes, kostenHist, eerdereLev, sync] = await Promise.all([
    leveranciersIndex(),
    db.select().from(bankTransacties).where(eq(bankTransacties.maand, maand)).orderBy(asc(bankTransacties.boekdatum)),
    db.select().from(bankAfschriften).orderBy(asc(bankAfschriften.van)),
    db.select().from(companyFinanceMonths).where(eq(companyFinanceMonths.period, maand)).limit(1),
    db.execute(sql`
      select leverancier, subcategorie, groep, soort, sum(met_btw)::float met, sum(zonder_btw)::float ex, sum(aantal)::int n, max(bijgewerkt)::text bijgewerkt
      from kosten_regels where maand = ${maand} group by 1,2,3,4 order by ex desc`),
    db.execute(sql`
      select maand, subcategorie, sum(zonder_btw)::float ex from kosten_regels
      where maand in (${sql.join(vorige.map((v) => sql`${v}`), sql`, `)}) and groep in ('personeel','editors','freelancers','marketing','vast','operationeel')
      group by 1,2`),
    db.execute(sql`
      select distinct lower(tegenpartij) naam from bank_transacties where maand < ${maand} and bedrag < 0
      union select distinct lower(leverancier) from kosten_regels where maand < ${maand}`),
    getSyncStatus(),
  ]);

  /* ---------- Bank (cashflow) ---------- */
  const transacties: MaandTransactie[] = tx.map((t) => {
    const bedrag = Number(t.bedrag);
    return {
      id: t.id,
      datum: String(t.boekdatum),
      rekening: t.iban,
      bedrag,
      tegenpartij: t.tegenpartij || "(onbekend)",
      omschrijving: t.omschrijving,
      tegenrekening: t.tegenrekening,
      ...deelIn({ bedrag, tegenpartij: t.tegenpartij, omschrijving: t.omschrijving }, bekend),
    };
  });
  const dekkendeAfschriften = afschriften.filter((a) => String(a.van) <= start && String(a.tot) >= eind);
  const gedeeltelijk = afschriften.filter((a) => String(a.tot) >= start && String(a.van) <= eind);
  const bankDekking: Dekking = dekkendeAfschriften.length ? "compleet" : gedeeltelijk.length ? "voorlopig" : "ontbreekt";
  const extern = transacties.filter((t) => t.groep !== "intern");
  const bankIn = r2(extern.filter((t) => t.bedrag > 0).reduce((a, t) => a + t.bedrag, 0));
  const bankUit = r2(-extern.filter((t) => t.bedrag < 0).reduce((a, t) => a + t.bedrag, 0));
  const intern = r2(transacties.filter((t) => t.groep === "intern").reduce((a, t) => a + t.bedrag, 0));

  // Saldi aan het einde van de maand per rekening (alleen als een afschrift tot ná/op die dag loopt).
  const saldi = [...new Set(afschriften.map((a) => a.iban))].map((iban) => {
    const a = afschriften.filter((x) => x.iban === iban && String(x.tot) === eind).at(-1);
    return { iban, naam: afschriften.find((x) => x.iban === iban)?.rekeningNaam ?? "", eindsaldo: a?.eindsaldo != null ? Number(a.eindsaldo) : null };
  });

  /* ---------- Omzet (boekhouding) ---------- */
  const b = book[0];
  const omzet = b && b.bookSource ? Number(b.bookRevenue) : null;
  const omzetIngelezen = b?.bookImportedAt ?? null;
  const omzetDekking: Dekking =
    omzet == null ? "ontbreekt" : omzetIngelezen && new Date(omzetIngelezen).toISOString().slice(0, 10) > eind ? "compleet" : "voorlopig";

  /* ---------- Kosten (Kostenmonitor, ex btw) ---------- */
  type KR = { leverancier: string; subcategorie: string; groep: string; soort: string; met: number; ex: number; n: number; bijgewerkt: string | null };
  const kostenRegelsMaand = rows<KR>(kostenRes);
  const bedrijf = kostenRegelsMaand.filter((k) => isBedrijfskostGroep(k.groep));
  const kostenEx = r2(bedrijf.reduce((a, k) => a + k.ex, 0));
  const kostenMet = r2(bedrijf.reduce((a, k) => a + k.met, 0));
  const kostenBijgewerkt = kostenRegelsMaand.reduce<string | null>((a, k) => (k.bijgewerkt && (!a || k.bijgewerkt > a) ? k.bijgewerkt : a), null);
  const kostenDekking: Dekking = !kostenRegelsMaand.length ? "ontbreekt" : kostenBijgewerkt && kostenBijgewerkt > eind ? "compleet" : "voorlopig";

  const perCategorie = new Map<string, { categorie: string; groep: string; ex: number; met: number }>();
  for (const k of bedrijf) {
    const e = perCategorie.get(k.subcategorie) ?? { categorie: k.subcategorie, groep: k.groep, ex: 0, met: 0 };
    e.ex += k.ex;
    e.met += k.met;
    perCategorie.set(k.subcategorie, e);
  }
  const hist = rows<{ maand: string; subcategorie: string; ex: number }>(kostenHist);
  const categorieen = [...perCategorie.values()]
    .map((c) => {
      const vals = vorige.map((v) => hist.filter((h) => h.maand === v && h.subcategorie === c.categorie).reduce((a, h) => a + h.ex, 0));
      const gem = vals.reduce((a, v) => a + v, 0) / vorige.length;
      return { ...c, ex: r2(c.ex), met: r2(c.met), gemVorige3: r2(gem), verschil: r2(c.ex - gem) };
    })
    .sort((a, b) => b.ex - a.ex);

  const vast = r2(bedrijf.filter((k) => k.soort === "vast").reduce((a, k) => a + k.ex, 0));
  const variabel = r2(bedrijf.filter((k) => k.soort !== "vast").reduce((a, k) => a + k.ex, 0));

  /* ---------- Opvallend ---------- */
  // Namen verschillen tussen bank en Kostenmonitor ("CCV*LUKOIL ..." vs "Lukoil"),
  // dus vergelijken we op het eerste betekenisvolle woord.
  const sleutel = (n: string) =>
    n.toLowerCase().replace(/^[a-z]{2,4}\*/, "").replace(/\b(b\.?v\.?|bv|lim|ltd|vof|n\.?v\.?)\b/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 4)[0] ?? n.toLowerCase().trim();
  const bekendeNamen = new Set(rows<{ naam: string }>(eerdereLev).map((r) => sleutel(r.naam ?? "")));
  const opvallend = [
    ...transacties
      .filter((t) => t.bedrag < 0 && t.groep !== "intern" && -t.bedrag >= 1000)
      .map((t) => ({ soort: "groot", tekst: `${t.tegenpartij}: ${Math.round(-t.bedrag)} euro op ${t.datum} (${t.categorie})` })),
    ...[...new Set(transacties.filter((t) => t.bedrag < 0 && t.groep !== "intern" && -t.bedrag >= 50 && !bekendeNamen.has(sleutel(t.tegenpartij))).map((t) => t.tegenpartij))]
      .slice(0, 15)
      .map((n) => ({ soort: "nieuw", tekst: `Nieuwe leverancier: ${n}` })),
    ...categorieen.filter((c) => c.gemVorige3 > 0 && c.verschil > Math.max(250, c.gemVorige3 * 0.25)).map((c) => ({ soort: "stijging", tekst: `${c.categorie} ${Math.round(c.verschil)} euro hoger dan gemiddeld (3 mnd)` })),
    ...transacties.filter((t) => t.groep === "controle").slice(0, 20).map((t) => ({ soort: "controle", tekst: `Nog in te delen: ${t.tegenpartij} ${Math.round(-t.bedrag)} euro op ${t.datum}` })),
  ];

  /* ---------- Ontbrekende gegevens ---------- */
  const ontbreekt: string[] = [];
  if (bankDekking !== "compleet")
    ontbreekt.push(
      bankDekking === "ontbreekt"
        ? `Geen Knab-transacties voor ${maand}. Nodig: CAMT.053-export van de zakelijke betaalrekening over deze maand.`
        : `Knab-transacties dekken ${maand} niet volledig. Nodig: CAMT.053-export t/m ${eind}.`,
    );
  if (omzetDekking !== "compleet")
    ontbreekt.push(
      omzetDekking === "ontbreekt"
        ? `Geen omzet uit DigiBoox voor ${maand}. Nodig: DigiBoox-export Mutaties.`
        : `Omzet ${maand} is voorlopig (DigiBoox ingelezen vóór het einde van de maand). Nodig: nieuwe export Mutaties.`,
    );
  if (kostenDekking !== "compleet")
    ontbreekt.push(
      kostenDekking === "ontbreekt"
        ? `Geen Kostenmonitor-regels voor ${maand}.`
        : `Kosten ${maand} zijn voorlopig (laatste uitlezing ${kostenBijgewerkt}). Wordt compleet zodra het Knab-afschrift van deze maand is verwerkt.`,
    );
  ontbreekt.push("Openstaande facturen: nog geen bron gekoppeld. Nodig: DigiBoox-export van verkoopfacturen met status.");

  const resultaat = omzet != null && kostenRegelsMaand.length ? r2(omzet - kostenEx) : null;

  return {
    maand,
    sync,
    omzet: { bedrag: omzet, dekking: omzetDekking, ingelezen: omzetIngelezen, bron: "DigiBoox boekhouding (Opbrengsten, ex btw)" },
    kosten: { ex: kostenEx, met: kostenMet, vast, variabel, dekking: kostenDekking, bijgewerkt: kostenBijgewerkt, bron: "Kostenmonitor (Knab-afschrijvingen, bedrijfskosten)" },
    resultaat: { bedrag: resultaat, marge: resultaat != null && omzet ? Math.round((resultaat / omzet) * 1000) / 10 : null, definitief: omzetDekking === "compleet" && kostenDekking === "compleet" },
    bank: { in: bankIn, uit: bankUit, netto: r2(bankIn - bankUit), intern, dekking: bankDekking, saldi, aantal: transacties.length },
    categorieen,
    leveranciers: kostenRegelsMaand
      .filter((k) => isBedrijfskostGroep(k.groep))
      .map((k) => ({ leverancier: k.leverancier, categorie: k.subcategorie, soort: k.soort, ex: r2(k.ex), met: r2(k.met), n: k.n })),
    transacties,
    opvallend,
    ontbreekt,
  };
}

/** Maandoverzicht voor meerdere maanden: verdiend, uitgegeven, over, en bankstromen (excl. interne overboekingen). */
export async function getMaandReeks(aantal = 12) {
  await requirePermission("finance:read");
  const res = await db.execute(sql`
    with m as (
      select period maand from company_finance_months where book_source is not null
      union select maand from kosten_regels
      union select maand from bank_transacties
    )
    select m.maand,
      (select book_revenue::float from company_finance_months c where c.period = m.maand and c.book_source is not null) omzet,
      (select coalesce(sum(zonder_btw),0)::float from kosten_regels k where k.maand = m.maand and k.groep in ('personeel','editors','freelancers','marketing','vast','operationeel')) kosten
    from m order by m.maand desc limit ${aantal}`);
  const lijst = rows<{ maand: string; omzet: number | null; kosten: number }>(res);
  const oudste = lijst.at(-1)?.maand ?? "0000-00";
  const tx = await db
    .select({ maand: bankTransacties.maand, bedrag: bankTransacties.bedrag, tegenpartij: bankTransacties.tegenpartij, omschrijving: bankTransacties.omschrijving })
    .from(bankTransacties)
    .where(sql`${bankTransacties.maand} >= ${oudste}`);
  const bank = new Map<string, { in: number; uit: number }>();
  for (const t of tx) {
    const bedrag = Number(t.bedrag);
    if (deelIn({ bedrag, tegenpartij: t.tegenpartij, omschrijving: t.omschrijving }).groep === "intern") continue;
    const e = bank.get(t.maand) ?? { in: 0, uit: 0 };
    if (bedrag > 0) e.in += bedrag;
    else e.uit -= bedrag;
    bank.set(t.maand, e);
  }
  return lijst.map((r) => ({
    maand: r.maand,
    omzet: r.omzet,
    kosten: r2(r.kosten),
    resultaat: r.omzet != null ? r2(r.omzet - r.kosten) : null,
    bankIn: bank.has(r.maand) ? r2(bank.get(r.maand)!.in) : null,
    bankUit: bank.has(r.maand) ? r2(bank.get(r.maand)!.uit) : null,
  }));
}
