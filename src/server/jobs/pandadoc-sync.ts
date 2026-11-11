import "server-only";
import { pandadocConfigured } from "@/server/quotes/pandadoc-client";
import { syncAllPandaDoc } from "@/server/quotes/pandadoc-sync";
import { runJob } from "./runner";

/**
 * Periodieke PandaDoc-synchronisatie (aanvulling op de webhook). Elk uur alleen
 * de gewijzigde documenten; 's nachts (of met `full`) alles, zodat een gemiste
 * webhook nooit blijft hangen. Fouten staan in het logboek en als melding op de
 * Offertepagina.
 */
export async function runPandaDocSync(params: { full?: boolean; triggeredById?: string } = {}) {
  return runJob("system", "pandadoc.sync", { full: !!params.full }, async (ctx) => {
    if (!pandadocConfigured()) {
      ctx.log("PANDADOC_API_KEY ontbreekt: synchronisatie overgeslagen.", "warn");
      throw new Error("PandaDoc is nog niet gekoppeld: PANDADOC_API_KEY ontbreekt.");
    }
    const hour = Number(new Intl.DateTimeFormat("nl-NL", { hour: "numeric", timeZone: "Europe/Amsterdam" }).format(new Date()));
    const full = params.full || hour === 3;
    const r = await syncAllPandaDoc({ full, log: (m) => ctx.log(m) });
    ctx.counters.processed = r.seen;
    ctx.counters.created = r.created;
    ctx.counters.updated = r.synced - r.created;
    ctx.counters.failed = r.failed + (r.complete ? 0 : 1);
    ctx.log(`${r.seen} documenten gezien, ${r.synced} bijgewerkt (${r.created} nieuw), ${r.skipped} ongewijzigd, ${r.failed} mislukt.`);
    if (r.failed > 0 && r.synced === 0) throw new Error(r.errors[0] ?? "Synchronisatie met PandaDoc mislukt.");
  }, { triggeredById: params.triggeredById, notify: false });
}
