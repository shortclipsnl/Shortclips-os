/**
 * Knab CAMT.053-exports inlezen in bank_transacties (idempotent).
 *
 * Gebruik:
 *   npm run bank:import -- "<pad>/Knab CAMT053 ....xml" [meer bestanden]
 *   npm run bank:import -- --check "<pad>.xml"   → alleen lezen en controleren, niets opslaan
 *
 * Bestaande boekingen worden overgeslagen (uniek op rekening + bankreferentie),
 * dus opnieuw draaien of overlappende periodes inlezen is veilig.
 */
import fs from "node:fs";
import path from "node:path";
import { db, rawClient } from "../src/db/client";
import { parseCamt053 } from "../src/server/bank/camt";
import { importCamtBestand } from "../src/server/bank/import";

async function main() {
  const check = process.argv.includes("--check");
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!files.length) throw new Error("Geef één of meer CAMT.053-bestanden mee.");
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8");
    const naam = path.basename(f);
    if (check) {
      for (const a of parseCamt053(content)) {
        console.log(`[check] ${naam} ${a.iban} ${a.van}..${a.tot}: ${a.transacties.length} boekingen, begin ${a.beginsaldo}, eind ${a.eindsaldo}${a.waarschuwingen.length ? " | " + a.waarschuwingen.join(" ") : " | sluit"}`);
      }
      continue;
    }
    const r = await importCamtBestand(db, naam, content);
    for (const a of r.afschriften) {
      console.log(`[bank-import] ${naam} ${a.iban} ${a.van}..${a.tot}: ${a.nieuw} nieuw, ${a.alAanwezig} al aanwezig | ${a.controle}`);
    }
    for (const k of r.kosten) console.log(`[bank-import] kosten ${k.maand}: ${k.status}${k.regels ? ` (${k.regels} regels)` : ""}`);
  }
}

main()
  .then(async () => {
    const c = rawClient() as { end?: () => Promise<void>; close?: () => Promise<void> };
    await (c.end?.() ?? c.close?.());
  })
  .catch((e) => {
    console.error("[bank-import] mislukt:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
