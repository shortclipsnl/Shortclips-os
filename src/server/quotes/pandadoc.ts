import "server-only";
import { syncAllPandaDoc, type SyncAllReport } from "@/server/quotes/pandadoc-sync";

export { pandadocConfigured } from "@/server/quotes/pandadoc-client";

/**
 * Volledige import van alle PandaDoc-offertes (ook historische). PandaDoc is
 * het leidende offertesysteem; dit is dezelfde synchronisatie als de webhook en
 * de periodieke job, alleen over alle documenten. In PandaDoc wordt niets
 * gewijzigd of verwijderd.
 */
export async function importPandaDoc(opts: { budgetMs?: number } = {}): Promise<SyncAllReport> {
  return syncAllPandaDoc({ full: true, budgetMs: opts.budgetMs ?? 60 * 60 * 1000, log: (m) => console.log(`  · ${m}`) });
}
