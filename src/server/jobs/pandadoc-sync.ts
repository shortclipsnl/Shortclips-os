import "server-only";
import { pandadocConfigured } from "@/server/quotes/pandadoc-client";
import { syncAllPandaDoc } from "@/server/quotes/pandadoc-sync";
import { runJob } from "./runner";

/**
 * Periodieke PandaDoc-synchronisatie (aanvulling op de webhook). Elke 10 minuten alleen
 * de gewijzigde documenten; 's nachts (of met `full`) alles, zodat een gemiste
 * webhook nooit blijft hangen. Fouten staan in het logboek en als melding op de
 * Offertepagina.
 */
export async function runPandaDocSync(params: { full?: boolean; triggeredById?: string } = {}) {
  return runJob("system", "pandadoc.sync", { full: !!params.full }, async (ctx) => {
    if (!pandadocConfigured()) {
      // Niet ingesteld is geen storing: overslaan zonder elk uur een fout te
      // loggen. De Koppelingsbewaking toont PandaDoc dan als "Niet ingesteld".
      ctx.log("PANDADOC_API_KEY ontbreekt: synchronisatie overgeslagen.", "warn");
      return;
    }
    // Elke 10 minuten de wijzigingen (PandaDoc-webhooks vragen het Business-plan);
    // één keer per nacht (03:00-03:09) alles als vangnet.
    const parts = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: "Europe/Amsterdam" }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    const full = params.full || (hour === 3 && minute < 10);
    const r = await syncAllPandaDoc({ full, log: (m) => ctx.log(m) });
    ctx.counters.processed = r.seen;
    ctx.counters.created = r.created;
    ctx.counters.updated = r.synced - r.created;
    ctx.counters.failed = r.failed + (r.complete ? 0 : 1);
    ctx.log(`${r.seen} documenten gezien, ${r.synced} bijgewerkt (${r.created} nieuw), ${r.skipped} ongewijzigd, ${r.failed} mislukt.`);
    if (r.failed > 0 && r.synced === 0) throw new Error(r.errors[0] ?? "Synchronisatie met PandaDoc mislukt.");
  }, { triggeredById: params.triggeredById, notify: false });
}
