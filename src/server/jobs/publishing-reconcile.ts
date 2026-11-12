import "server-only";
import { runJob } from "./runner";
import { reconcilePublishing } from "@/server/publishing";

/** Elke 15 minuten: gewijzigde berichten uit Metricool halen en publicaties bevestigen. */
export async function runPublishingReconcile() {
  return runJob("metricool", "publications.metricool_reconcile", {}, async (ctx) => {
    const res = await reconcilePublishing();
    ctx.counters.updated += res.held + res.confirmed;
    ctx.log(`${res.held} in de wacht gezet, ${res.confirmed} publicaties bevestigd.`);
  });
}
