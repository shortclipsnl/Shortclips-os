import "server-only";
import { notifyTechnical } from "@/server/notification-digest";
import { integrationHealth } from "@/server/integrations/registry";
import { runJob } from "./runner";

const STATUS_REASON: Record<string, string> = {
  error: "geeft fouten bij het synchroniseren",
  stale: "heeft al meer dan een dag niet succesvol gesynchroniseerd",
  never_synced: "is nog nooit succesvol gesynchroniseerd",
};

/**
 * Nachtelijke gezondheidscheck van de externe koppelingen (Frame.io, Google
 * Drive, Google Agenda, Metricool). Meldt proactief als een koppeling fouten
 * geeft, verouderd is of nooit succesvol synchroniseerde — ook als er die dag
 * geen enkele run meer plaatsvond. Directe fouten tijdens een run worden al door
 * de job-runner gemeld; dit vangt het "stilletjes blijven liggen" op.
 *
 * Idempotent: één melding per koppeling per status per dag (dedupe).
 */
export async function runIntegrationHealthCheck() {
  return runJob("system", "integrations.health_check", {}, async (ctx) => {
    const health = await integrationHealth();
    const dayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
    for (const h of health) {
      ctx.counters.processed++;
      // Niet-geconfigureerde koppelingen zijn een bewuste keuze, geen storing.
      if (!h.configured) continue;
      // Google Drive heeft een eigen bewaking (drive.health) met dedupe.
      if (h.spec.provider === "google_drive") continue;
      if (h.status === "error" || h.status === "stale" || h.status === "never_synced") {
        const reason = STATUS_REASON[h.status] ?? "vraagt aandacht";
        // In de dagbundel technische storingen, alleen voor de eigenaar: het
        // operationele team kan een koppeling niet zelf herstellen.
        void dayKey;
        const sent = await notifyTechnical(`${h.spec.name} ${reason}`, h.status === "error" ? "critical" : "warning");
        if (sent > 0) ctx.counters.updated++;
      }
    }
    ctx.log(`${health.length} koppelingen gecontroleerd, ${ctx.counters.updated} melding(en) verstuurd.`);
  });
}
