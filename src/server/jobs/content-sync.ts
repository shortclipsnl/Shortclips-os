import "server-only";
import { reconcileContentFromVideos } from "@/server/content-sync";
import { runJob } from "./runner";

/** Reconciliatie: publiceerbare video's als één gekoppeld record in de
 *  contentplanning zetten en statussen/datums gelijkhouden. */
export async function runContentSync() {
  return runJob("monday", "content.sync_from_videos", {}, async (ctx) => {
    const r = await reconcileContentFromVideos();
    ctx.counters.processed += r.checked;
    ctx.counters.created += r.created;
    ctx.counters.updated += r.updated;
    ctx.log(`${r.checked} video's gecontroleerd: ${r.created} nieuw in planning, ${r.updated} bijgewerkt.`);
  });
}
