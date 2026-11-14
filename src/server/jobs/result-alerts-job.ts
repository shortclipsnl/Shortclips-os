import "server-only";
import { runResultAlerts } from "@/server/result-alerts";
import { runJob } from "./runner";

/**
 * Dagelijks (na de Metricool-metingen en de Contentgeheugen-update): alle
 * actieve klanten analyseren voor "Klanten die aandacht nodig hebben", alerts
 * bijwerken, effect van verbeteracties meten en rode alerts gebundeld melden.
 */
export async function runResultAlertsJob() {
  return runJob("system", "result_alerts.detect", {}, async (ctx) => {
    const r = await runResultAlerts({ budgetMs: 240_000 });
    ctx.counters.processed = r.analyzed;
    ctx.counters.created = r.created;
    ctx.counters.updated = r.updated + r.expired + r.effects;
    ctx.log(
      `${r.analyzed} klanten geanalyseerd: ${r.created} nieuwe alert(s), ${r.updated} bijgewerkt, ${r.expired} vervallen, ` +
        `${r.insufficient} met onvoldoende data, ${r.effects} effectmeting(en), ${r.notified} melding(en).`,
    );
  });
}
