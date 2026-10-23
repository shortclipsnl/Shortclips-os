/**
 * Vermogen-seed: leest data/vermogen/vermogen_data.json en zet het in de
 * database (tabel vermogen_docs, upsert per pad).
 *
 * Gebruik:
 *   npm run vermogen:seed            → alleen als de tabel nog leeg is
 *                                       (veilig om bij elke deploy te draaien;
 *                                        overschrijft latere wijzigingen niet)
 *   npm run vermogen:seed -- --fresh → upsert álle paden uit het bestand
 *
 * Draait op de actieve driver (PGlite lokaal, Postgres/Supabase in productie).
 */
import fs from "node:fs";
import path from "node:path";
import { db, rawClient } from "../src/db/client";
import { countVermogenDocs, upsertVermogenDocs } from "../src/server/vermogen/store";

const FILE = path.resolve(process.cwd(), "data/vermogen/vermogen_data.json");
const FRESH = process.argv.includes("--fresh") || process.argv.includes("--force");

async function main() {
  if (!fs.existsSync(FILE)) {
    console.log(`[vermogen-seed] ${FILE} niet gevonden — overgeslagen.`);
    return;
  }

  if (!FRESH) {
    const existing = await countVermogenDocs(db);
    if (existing > 0) {
      console.log(`[vermogen-seed] Niets te doen: ${existing} document(en) al aanwezig. Gebruik --fresh om opnieuw in te voeren.`);
      return;
    }
  }

  const docs = JSON.parse(fs.readFileSync(FILE, "utf8")) as Record<string, unknown>;
  const count = await upsertVermogenDocs(docs, db);
  console.log(`[vermogen-seed] ✓ ${count} document(en) ingevoerd.`);
}

main()
  .catch((error) => {
    console.error("[vermogen-seed] ✗ mislukt:", error);
    process.exit(1);
  })
  .finally(async () => {
    const raw = rawClient();
    if ("end" in raw && typeof raw.end === "function") await raw.end();
    else if ("close" in raw && typeof raw.close === "function") await raw.close();
  });
