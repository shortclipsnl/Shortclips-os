import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { bankAfschriften, bankTransacties, kostenRegels } from "../../db/schema";
import { deelIn, norm, type Indeling, type LeverancierIndex } from "./categorie";

/**
 * Vult de Kostenmonitor (kosten_regels) voor een maand uit de Knab-transacties,
 * zodra de zakelijke betaalrekening die maand volledig dekt.
 *
 * Alleen voor maanden die nog NIET definitief zijn (geen kostenregels, of de
 * laatste uitlezing lag vóór het einde van de maand). Een afgesloten maand wordt
 * nooit overschreven. Interne overboekingen tellen niet mee.
 *
 * Bedrag zonder btw: per leverancier dezelfde verhouding als in de bestaande
 * Kostenmonitor; voor nieuwe leveranciers 21% btw, behalve bij posten zonder btw
 * (lonen, loonheffing, verzekeringen, bankkosten, privé, belasting).
 *
 * Geen `server-only`: draait ook vanuit het importscript.
 */

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const ZONDER_BTW = new Set(["Lonen", "Loonheffing", "Verzekeringen", "Boekhouding en bank", "Privé en reserveringen", "Btw en inkomstenbelasting"]);

function lastDay(maand: string) {
  const [y, m] = maand.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

/** De rekening met de meeste boekingen is de zakelijke betaalrekening. */
async function betaalrekening(db: Db): Promise<string | null> {
  const r = rows<{ iban: string }>(await db.execute(sql`select iban from bank_transacties group by iban order by count(*) desc limit 1`));
  return r[0]?.iban ?? null;
}

export async function kostenUitBank(db: Db, maanden: string[]): Promise<{ maand: string; regels: number; status: string }[]> {
  const iban = await betaalrekening(db);
  if (!iban) return [];
  const vandaag = new Date().toISOString().slice(0, 10);
  const out: { maand: string; regels: number; status: string }[] = [];

  // Bekende leveranciers + hun btw-verhouding uit de bestaande Kostenmonitor.
  const hist = rows<{ naam: string; leverancier: string; subcategorie: string; groep: string; soort: string; ratio: number | null }>(
    await db.execute(sql`
      select lower(leverancier) naam,
        (array_agg(leverancier order by maand desc))[1] leverancier,
        (array_agg(subcategorie order by maand desc))[1] subcategorie,
        (array_agg(groep order by maand desc))[1] groep,
        (array_agg(soort order by maand desc))[1] soort,
        case when sum(met_btw) > 0 then (sum(zonder_btw) / sum(met_btw))::float end ratio
      from kosten_regels group by lower(leverancier)`),
  );
  const idx: LeverancierIndex = new Map();
  const info = new Map<string, { naam: string; ratio: number | null }>();
  for (const h of hist) {
    idx.set(norm(h.naam), { categorie: h.subcategorie, groep: h.groep, soort: h.soort as Indeling["soort"] });
    info.set(norm(h.naam), { naam: h.leverancier, ratio: h.ratio });
  }

  for (const maand of [...new Set(maanden)].sort()) {
    const eind = lastDay(maand);
    const [dekt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(bankAfschriften)
      .where(and(eq(bankAfschriften.iban, iban), sql`${bankAfschriften.van} <= ${maand + "-01"}`, sql`${bankAfschriften.tot} >= ${eind}`));
    if (!dekt?.n) {
      out.push({ maand, regels: 0, status: "betaalrekening dekt de maand nog niet volledig" });
      continue;
    }
    const [bestaand] = await db
      .select({ n: sql<number>`count(*)::int`, bijgewerkt: sql<string | null>`max(${kostenRegels.bijgewerkt})::text` })
      .from(kostenRegels)
      .where(eq(kostenRegels.maand, maand));
    if (bestaand?.n && bestaand.bijgewerkt && bestaand.bijgewerkt > eind) {
      out.push({ maand, regels: 0, status: "al definitief in de Kostenmonitor, niet gewijzigd" });
      continue;
    }

    const tx = await db.select().from(bankTransacties).where(and(eq(bankTransacties.iban, iban), eq(bankTransacties.maand, maand)));
    const groepen = new Map<string, { leverancier: string; sub: string; groep: string; soort: string; met: number; ex: number; n: number }>();
    for (const t of tx) {
      const bedrag = Number(t.bedrag);
      if (bedrag >= 0) continue;
      const ind = deelIn({ bedrag, tegenpartij: t.tegenpartij, omschrijving: t.omschrijving }, idx);
      if (ind.groep === "intern") continue;
      const key = norm(t.tegenpartij);
      const bekend = info.get(key);
      const leverancier = (bekend?.naam ?? t.tegenpartij) || "Onbekend";
      const ratio = bekend?.ratio ?? (ZONDER_BTW.has(ind.categorie) ? 1 : 1 / 1.21);
      const k = `${leverancier}|${ind.categorie}`;
      const g = groepen.get(k) ?? { leverancier, sub: ind.categorie, groep: ind.groep, soort: ind.soort, met: 0, ex: 0, n: 0 };
      g.met += -bedrag;
      g.ex += -bedrag * ratio;
      g.n += 1;
      groepen.set(k, g);
    }
    const values = [...groepen.values()].map((g) => ({
      maand,
      leverancier: g.leverancier.slice(0, 200),
      subcategorie: g.sub.slice(0, 80),
      groep: g.groep.slice(0, 24),
      soort: g.soort.slice(0, 16),
      metBtw: String(Math.round(g.met)),
      zonderBtw: String(Math.round(g.ex)),
      aantal: g.n,
      bijgewerkt: vandaag,
    }));
    await db.transaction(async (trx) => {
      await trx.delete(kostenRegels).where(eq(kostenRegels.maand, maand));
      if (values.length) await trx.insert(kostenRegels).values(values);
    });
    out.push({ maand, regels: values.length, status: "Kostenmonitor bijgewerkt uit Knab-transacties" });
  }
  return out;
}
