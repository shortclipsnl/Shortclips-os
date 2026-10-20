/**
 * Kosten-seed: leest data/kosten/kosten_data.json en zet het in de database.
 *
 * Gebruik:
 *   npm run kosten:seed            → vult alleen maanden die nog niet bestaan
 *                                     (veilig om bij elke deploy te draaien;
 *                                      overschrijft latere correcties niet)
 *   npm run kosten:seed -- --fresh → voert álle maanden opnieuw in (per maand
 *                                     eerst verwijderen, dan invoegen)
 *
 * Draait op de actieve driver (PGlite lokaal, Postgres/Supabase in productie).
 */
import fs from "node:fs";
import path from "node:path";
import { db, rawClient } from "../src/db/client";
import { importKostenData } from "../src/server/kosten/import-data";
import type { KostenPayload } from "../src/server/kosten/shared";

const FILE = path.resolve(process.cwd(), "data/kosten/kosten_data.json");
const FRESH = process.argv.includes("--fresh") || process.argv.includes("--force");

async function main() {
  if (!fs.existsSync(FILE)) {
    console.log(`[kosten-seed] ${FILE} niet gevonden — overgeslagen.`);
    return;
  }
  const payload = JSON.parse(fs.readFileSync(FILE, "utf8")) as KostenPayload;
  const result = await importKostenData(db, payload, { onlyNewMonths: !FRESH });

  if (result.months.length === 0 && result.skipped.length > 0) {
    console.log(`[kosten-seed] Niets te doen: ${result.skipped.length} maand(en) al aanwezig. Gebruik --fresh om opnieuw in te voeren.`);
  } else {
    console.log(`[kosten-seed] ✓ ${result.regels} regels in ${result.months.length} maand(en); omzet voor ${result.omzetMonths} maand(en).`);
    if (result.skipped.length) console.log(`[kosten-seed] Overgeslagen (al aanwezig): ${result.skipped.join(", ")}`);
  }
}

main()
  .catch((error) => {
    console.error("[kosten-seed] ✗ mislukt:", error);
    process.exit(1);
  })
  .finally(async () => {
    const raw = rawClient();
    if ("end" in raw && typeof raw.end === "function") await raw.end();
    else if ("close" in raw && typeof raw.close === "function") await raw.close();
  });
