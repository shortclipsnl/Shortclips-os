/**
 * Handmatig de Frame.io-bibliotheek van het klantportaal verversen.
 * Gebruik: NODE_OPTIONS=--conditions=react-server tsx scripts/frame-library-sync.ts
 */
import { syncFrameLibrary } from "@/server/jobs/frameio-library";
import { db } from "@/db/client";
import { syncJobs } from "@/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const res = await syncFrameLibrary(undefined, undefined, { full: process.env.FULL === "1" });
  const [job] = await db.select({ log: syncJobs.log, processed: syncJobs.itemsProcessed, created: syncJobs.itemsCreated, updated: syncJobs.itemsUpdated, failed: syncJobs.itemsFailed, status: syncJobs.status }).from(syncJobs).where(eq(syncJobs.id, res.jobId));
  console.log(JSON.stringify({ ...res, ...job, log: undefined }, null, 1));
  for (const l of (job?.log as Array<{ level: string; message: string }>) ?? []) console.log(`[${l.level}] ${l.message}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
