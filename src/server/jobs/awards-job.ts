import "server-only";
import { runJob } from "./runner";
import { recomputeAllAwards } from "@/server/awards/service";

/** Nachtelijk vangnet (en eenmalige backfill): awards per editor herberekenen. */
export async function runAwardsRecompute() {
  return runJob("monday", "awards.recompute", {}, async (ctx) => {
    const r = await recomputeAllAwards();
    ctx.counters.processed = r.editors;
    ctx.counters.updated = r.newAwards;
    ctx.log(`${r.editors} editors gecontroleerd, ${r.newAwards} nieuwe award(s) toegekend`);
  });
}
