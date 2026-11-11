/**
 * Volledige PandaDoc-import: haalt alle offertes (ook historische) op, met
 * status, ontvangers, activiteit, PDF en bedrag, en koppelt ze aan leads.
 * Vereist PANDADOC_API_KEY. In PandaDoc wordt niets gewijzigd.
 *
 *   npm run quotes:import-pandadoc
 */
import { importPandaDoc, pandadocConfigured } from "@/server/quotes/pandadoc";

async function main() {
  if (!pandadocConfigured()) {
    console.error("✗ PANDADOC_API_KEY ontbreekt. Zet 'm in de omgeving en probeer opnieuw.");
    process.exit(1);
  }
  console.log("→ PandaDoc-import (alle documenten)…");
  const r = await importPandaDoc();
  console.log(`\n${r.seen} gezien · ${r.synced} bijgewerkt (${r.created} nieuw) · ${r.skipped} ongewijzigd · ${r.failed} mislukt`);
  for (const e of r.errors) console.log(`  ✗ ${e}`);
  process.exit(r.failed && !r.synced ? 1 : 0);
}

main().catch((e) => {
  console.error("✗ Import mislukt:", e instanceof Error ? e.message : e);
  process.exit(1);
});
