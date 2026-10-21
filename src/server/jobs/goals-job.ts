import "server-only";
import { runJob } from "./runner";
import { recomputeAllGoals } from "@/server/goals/recompute";
import { seedGoals } from "@/server/goals/seed";

/** Nachtelijke herberekening: stand + status + snapshot, meldingen bij een wissel. */
export async function runGoalsRecompute() {
  return runJob("monday", "goals.recompute", {}, async (ctx) => {
    const r = await recomputeAllGoals();
    ctx.counters.processed = r.processed;
    ctx.counters.updated = r.changed;
    ctx.log(`${r.processed} doelen herberekend, ${r.changed} statuswissels`);
  });
}

/** Eenmalig de 22 Q4-doelen seeden (idempotent). */
export async function runGoalsSeed() {
  return runJob("monday", "goals.seed", {}, async (ctx) => {
    const r = await seedGoals();
    ctx.counters.updated = r.inserted;
    ctx.log(`${r.inserted} doelen geseed`);
  });
}
