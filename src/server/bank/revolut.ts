import { and, eq, like, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { kostenRegels } from "../../db/schema";

/**
 * Revolut is Jarno's privérekening waarmee ook zakelijke abonnementen worden
 * betaald. Alleen herkenbare zakelijke software telt als Shortclips-kosten;
 * de rest is privé en blijft buiten de bedrijfscijfers.
 *
 * Buitenlandse SaaS rekent geen Nederlandse btw (verlegd), dus zonder btw =
 * met btw. Regels krijgen de suffix " (Revolut)" zodat ze herkenbaar zijn en
 * bij opnieuw inlezen per maand worden vervangen (idempotent).
 * Geen `server-only`.
 */

export type RevolutTx = { datum: string; oms: string; aan?: string; bedrag: number };

const ZAKELIJK = /\b(claude|anthropic|framer|monday\.com|adobe|frame\.io|metricool|pandadoc|tactiq|atlassian|openai|chatgpt|heygen|microsoft|msft|vimeo|skool|calendly|canva)\b/i;
export const SUFFIX = " (Revolut)";

export function isZakelijkRevolut(t: RevolutTx) {
  return t.bedrag < 0 && ZAKELIJK.test(`${t.oms} ${t.aan ?? ""}`);
}

const NAAM: [RegExp, string][] = [
  [/claude|anthropic/i, "Anthropic (Claude)"], [/framer/i, "Framer"], [/monday/i, "monday.com"], [/adobe/i, "Adobe"],
  [/frame\.io/i, "Frame.io"], [/metricool/i, "Metricool"], [/pandadoc/i, "PandaDoc"], [/tactiq/i, "Tactiq"],
  [/atlassian/i, "Atlassian"], [/openai|chatgpt/i, "OpenAI"], [/heygen/i, "HeyGen"], [/microsoft|msft/i, "Microsoft"],
  [/vimeo/i, "Vimeo"], [/skool/i, "Skool"], [/calendly/i, "Calendly"], [/canva/i, "Canva"],
];

export async function revolutNaarKosten(db: Db, tx: RevolutTx[], alleenMaanden?: string[]) {
  const perMaand = new Map<string, Map<string, { met: number; n: number }>>();
  for (const t of tx) {
    if (!isZakelijkRevolut(t)) continue;
    const maand = t.datum.slice(0, 7);
    if (alleenMaanden && !alleenMaanden.includes(maand)) continue;
    const naam = (NAAM.find(([re]) => re.test(`${t.oms} ${t.aan ?? ""}`))?.[1] ?? t.oms) + SUFFIX;
    const m = perMaand.get(maand) ?? new Map();
    const e = m.get(naam) ?? { met: 0, n: 0 };
    e.met += -t.bedrag;
    e.n += 1;
    m.set(naam, e);
    perMaand.set(maand, m);
  }
  const out: { maand: string; regels: number; totaal: number }[] = [];
  for (const [maand, m] of [...perMaand].sort()) {
    // Behoud de bestaande uitleesdatum van de maand, zodat de status (voorlopig/definitief) niet verandert.
    const [b] = await db.select({ bijgewerkt: sql<string | null>`max(${kostenRegels.bijgewerkt})::text` }).from(kostenRegels).where(eq(kostenRegels.maand, maand));
    const bijgewerkt = b?.bijgewerkt ?? new Date().toISOString().slice(0, 10);
    const values = [...m].map(([leverancier, e]) => ({
      maand, leverancier, subcategorie: "Software en tools", groep: "vast", soort: "vast",
      metBtw: String(Math.round(e.met)), zonderBtw: String(Math.round(e.met)), aantal: e.n, bijgewerkt,
    }));
    await db.transaction(async (trx) => {
      await trx.delete(kostenRegels).where(and(eq(kostenRegels.maand, maand), like(kostenRegels.leverancier, `%${SUFFIX}`)));
      if (values.length) await trx.insert(kostenRegels).values(values);
    });
    out.push({ maand, regels: values.length, totaal: Math.round([...m.values()].reduce((a, e) => a + e.met, 0)) });
  }
  return out;
}

/** Revolut CSV-export (Afschrift, formaat Excel/CSV). Alleen voltooide transacties. */
export function parseRevolutCsv(content: string): RevolutTx[] {
  const lines = content.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l: string) => {
    const out: string[] = [];
    let cur = "", q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const head = split(lines[0]!).map((h) => h.toLowerCase());
  // Eerste naam in de lijst heeft voorrang (voltooiingsdatum boven startdatum).
  const col = (...names: string[]) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
  const iDate = col("completed date", "voltooid op", "datum voltooid", "started date", "begindatum");
  const iDesc = col("description", "beschrijving", "omschrijving");
  const iAmt = col("amount", "bedrag");
  const iFee = col("fee", "kosten");
  const iState = col("state", "status");
  const iCur = col("currency", "valuta");
  if (iDate < 0 || iDesc < 0 || iAmt < 0) throw new Error("Onbekend Revolut-formaat: kolommen datum, omschrijving en bedrag niet gevonden.");
  const tx: RevolutTx[] = [];
  for (const l of lines.slice(1)) {
    const c = split(l);
    const state = iState >= 0 ? (c[iState] ?? "").toUpperCase() : "COMPLETED";
    if (state && !["COMPLETED", "VOLTOOID"].includes(state)) continue;
    if (iCur >= 0 && c[iCur] && c[iCur] !== "EUR") continue;
    const amount = Number((c[iAmt] ?? "").replace(",", "."));
    const fee = iFee >= 0 ? Number((c[iFee] ?? "0").replace(",", ".")) || 0 : 0;
    const datum = (c[iDate] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !Number.isFinite(amount)) continue;
    tx.push({ datum, oms: c[iDesc] ?? "", bedrag: Math.round((amount - fee) * 100) / 100 });
  }
  return tx;
}

const MND: Record<string, number> = { jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };
const eur = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/**
 * Revolut PDF-afschrift (Nederlands), als tekst met kolommen (zie pdf-lines).
 * Het teken van elk bedrag volgt uit het lopende saldo; de keten moet sluiten
 * op het eindsaldo, anders volgt een waarschuwing. Teruggedraaide posten tellen niet mee.
 */
export function parseRevolutAfschriftTekst(text: string): { tx: RevolutTx[]; opening: number | null; eindsaldo: number | null; einddatum: string | null; waarschuwingen: string[] } {
  const lines = text.split("\n");
  const waarschuwingen: string[] = [];
  let opening: number | null = null;
  const ruw: { datum: string; oms: string; aan: string; bedrag: number; saldo: number }[] = [];
  let cur: (typeof ruw)[number] | null = null;
  for (const l of lines) {
    if (/^\s*Teruggedraaid van/i.test(l)) break;
    if (opening == null && /^\s*Rekening \(/.test(l)) {
      const m = /€([\d.]+,\d\d)/.exec(l);
      if (m) opening = eur(m[1]!);
      continue;
    }
    // Datum, omschrijving, daarna de bedragen (eerste = transactie, laatste = saldo).
    const m = /^\s*(\d{1,2}) (\w{3}) (\d{4})\s+(.+?)\s+(€[\d.]+,\d\d.*)$/.exec(l);
    if (m && MND[m[2]!.toLowerCase()]) {
      const amts = [...m[5]!.matchAll(/€([\d.]+,\d\d)/g)].map((x) => eur(x[1]!));
      if (!amts.length) continue;
      cur = { datum: `${m[3]}-${String(MND[m[2]!.toLowerCase()]).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`, oms: m[4]!.trim(), aan: "", bedrag: amts[0]!, saldo: amts.at(-1)! };
      ruw.push(cur);
      continue;
    }
    const a = /^\s*(?:Aan|Van|Naar):\s*(.+)$/.exec(l);
    if (cur && a && !cur.aan) cur.aan = a[1]!.trim();
  }
  if (opening == null) throw new Error("Geen Revolut-afschrift herkend (openingsbalans ontbreekt).");
  let prev = opening;
  const tx: RevolutTx[] = ruw.map((r) => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    let bedrag: number;
    if (Math.abs(r2(prev + r.bedrag) - r.saldo) < 0.011) bedrag = r.bedrag;
    else if (Math.abs(r2(prev - r.bedrag) - r.saldo) < 0.011) bedrag = -r.bedrag;
    else bedrag = r2(r.saldo - prev);
    prev = r.saldo;
    return { datum: r.datum, oms: r.oms, aan: r.aan, bedrag };
  });
  if (!tx.length) waarschuwingen.push("Geen transacties gevonden in het Revolut-afschrift.");
  return { tx, opening, eindsaldo: ruw.at(-1)?.saldo ?? opening, einddatum: ruw.at(-1)?.datum ?? null, waarschuwingen };
}
