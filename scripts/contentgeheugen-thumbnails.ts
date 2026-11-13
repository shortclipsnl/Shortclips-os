/**
 * Omslagen van video's aanvullen uit Metricool (ontbrekend of te klein).
 * Gebruik: NODE_OPTIONS=--conditions=react-server tsx scripts/contentgeheugen-thumbnails.ts
 * Draait ook automatisch in de nachtelijke job content_memory.refresh.
 */
import { backfillThumbnails } from "@/server/content-memory/thumbnails";

async function main() {
  const res = await backfillThumbnails({ clientId: process.env.CLIENT_ID, budgetMs: Number(process.env.BUDGET_MS ?? 160_000) });
  console.log(JSON.stringify(res));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
