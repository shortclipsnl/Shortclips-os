/**
 * PandaDoc-import: neemt de bestaande sjablonen en historische offertes over in
 * de Offertes-module. Vereist PANDADOC_API_KEY in de omgeving.
 *
 *   npm run quotes:import-pandadoc -- --dry-run   # alleen rapporteren
 *   npm run quotes:import-pandadoc                # daadwerkelijk importeren
 *
 * LET OP: nog niet tegen een echt PandaDoc-account getest; draai eerst --dry-run
 * en controleer het rapport.
 */
import { importPandaDoc, pandadocConfigured } from "@/server/quotes/pandadoc";

async function main() {
  if (!pandadocConfigured()) {
    console.error("✗ PANDADOC_API_KEY ontbreekt. Zet 'm in de omgeving en probeer opnieuw.");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  console.log(`→ PandaDoc-import ${dryRun ? "(dry-run, schrijft niets weg)" : "(schrijft weg)"}…`);
  const report = await importPandaDoc({ dryRun });
  console.log("\n=== Rapport ===");
  console.log(`Sjablonen:  ${report.templates.imported} geïmporteerd, ${report.templates.skipped} overgeslagen (bestonden al)`);
  console.log(`Offertes:   ${report.documents.imported} geïmporteerd, ${report.documents.skipped} overgeslagen, ${report.documents.pdfMissing} zonder PDF`);
  if (report.notes.length) {
    console.log("\nLet op / niet beschikbaar:");
    for (const n of report.notes) console.log(`  · ${n}`);
  }
  console.log("\n✓ Klaar. Vergelijk een paar offertes visueel + inhoudelijk vóór je PandaDoc opzegt.");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ Import mislukt:", e instanceof Error ? e.message : e);
  process.exit(1);
});
