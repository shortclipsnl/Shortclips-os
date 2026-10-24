import "server-only";
import { notify } from "@/server/notifications";
import { computeProfitabilitySignals, currentPeriod, getClientProfitability } from "@/server/profitability";
import { runJob } from "./runner";

/** Maandag van de huidige week (YYYY-MM-DD) — voor wekelijkse dedupe. */
function mondayIso(): string {
  const d = new Date();
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - dow);
  return utc.toISOString().slice(0, 10);
}

/**
 * Financiële winstgevendheid-signalen: waarschuwt de eigenaar bij verliesgevende
 * klanten, structureel lage marges, dalende marge bij omzetgroei en opvallend
 * stijgende editkosten — met oorzaak én een concreet verbetervoorstel. Eén melding
 * per klant per signaaltype per week (dedupe). Alleen de eigenaar ontvangt dit.
 */
export async function runProfitabilitySignals() {
  return runJob("monday", "profit.signals", {}, async (ctx) => {
    const overview = await getClientProfitability(currentPeriod(), true);
    const signals = computeProfitabilitySignals(overview, mondayIso());
    ctx.counters.processed = overview.rows.length;
    for (const s of signals) {
      const sent = await notify({
        roles: ["owner"],
        level: s.level,
        type: "profit_signal",
        title: s.title,
        body: `${s.oorzaak} Voorstel: ${s.voorstel}`.slice(0, 300),
        href: "/winstgevendheid",
        entityType: "sales_client",
        entityId: s.clientId,
        dedupeKey: s.dedupeKey,
      });
      if (sent > 0) ctx.counters.updated++;
    }
    ctx.log(`${overview.rows.length} klanten beoordeeld, ${signals.length} signaal/signalen, ${ctx.counters.updated} melding(en) verstuurd.`);
  });
}
