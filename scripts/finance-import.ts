/**
 * Financiële exports in één keer verwerken (zelfde logica als de uploads in het portaal).
 *
 *   npm run finance:import -- --camt a.xml [b.xml] --digiboox Mutaties.xlsx Balans.xlsx --revolut-json rev.json
 *
 * Volgorde: Knab-transacties (en Kostenmonitor uit de bank) → Revolut-software
 * → DigiBoox-omzet en balans. Alles is idempotent: opnieuw draaien geeft dezelfde stand.
 * Met --dry wordt alleen gelezen en gecontroleerd.
 */
import fs from "node:fs";
import path from "node:path";
import { db, rawClient } from "../src/db/client";
import { importCamtBestand } from "../src/server/bank/import";
import { revolutNaarKosten, parseRevolutCsv, type RevolutTx } from "../src/server/bank/revolut";
import { importDigibooxSheets } from "../src/server/bank/digiboox-core";
import { readXlsx } from "../src/lib/xlsx";

function args(flag: string): string[] {
  const i = process.argv.indexOf(flag);
  if (i < 0) return [];
  const out: string[] = [];
  for (const a of process.argv.slice(i + 1)) {
    if (a.startsWith("--")) break;
    out.push(a);
  }
  return out;
}

async function main() {
  for (const f of args("--camt")) {
    const r = await importCamtBestand(db, path.basename(f), fs.readFileSync(f, "utf8"));
    for (const a of r.afschriften) console.log(`[knab] ${a.iban} ${a.van}..${a.tot}: ${a.nieuw} nieuw, ${a.alAanwezig} al aanwezig | ${a.controle}`);
    for (const k of r.kosten) console.log(`[kosten] ${k.maand}: ${k.status}${k.regels ? ` (${k.regels} regels)` : ""}`);
  }
  const rev: RevolutTx[] = [
    ...args("--revolut-json").flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")) as RevolutTx[]),
    ...args("--revolut-csv").flatMap((f) => parseRevolutCsv(fs.readFileSync(f, "utf8"))),
  ];
  if (rev.length) {
    const maanden = args("--revolut-maanden");
    for (const r of await revolutNaarKosten(db, rev, maanden.length ? maanden : undefined)) console.log(`[revolut] ${r.maand}: ${r.regels} zakelijke posten, ${r.totaal} euro`);
  }
  const dg = args("--digiboox");
  if (dg.length) {
    const res = await importDigibooxSheets(db, dg.map((f) => ({ name: path.basename(f), sheets: readXlsx(fs.readFileSync(f)) })), null);
    for (const m of res.months) console.log(`[digiboox] ${m.period}: omzet ${m.revenue.toFixed(2)}`);
    console.log(`[digiboox] balans ${res.balans ? "opgeslagen" : "niet gevonden"}`);
    for (const f of res.files) if (f.warnings.length) console.log(`[digiboox] ${f.name}: ${f.warnings.join(" ")}`);
  }
}

main()
  .then(async () => {
    const c = rawClient() as { end?: () => Promise<void>; close?: () => Promise<void> };
    await (c.end?.() ?? c.close?.());
  })
  .catch((e) => {
    console.error("[finance-import] mislukt:", e?.cause?.message ?? (e instanceof Error ? e.message : e));
    process.exit(1);
  });
